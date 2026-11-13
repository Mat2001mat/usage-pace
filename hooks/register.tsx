import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Reading, Row, Spawned } from '../types'
import { activeRows, describeCall, rowText } from './agents'
import { NEWEST_LIMIT_SCRIPT, codexRow, lastStep, sessionJobs, startsCodexJob, weekLimit } from './codex'
import type { CodexJob } from './codex'
import { bar, color, formatLeft, pace } from './pace'

const reading = atom({ plugin: 'usage-pace', key: 'reading' } as const, null)
const now = atom({ plugin: 'usage-pace', key: 'now' } as const, 0)
const rows = atom({ plugin: 'usage-pace', key: 'rows' } as const, [] as Row[])
// Held by the host, so a reload keeps each agent's start time and model.
const spawned = atom({ plugin: 'usage-pace', key: 'spawned' } as const, {} as Record<string, Spawned>)
const codexRows = atom({ plugin: 'usage-pace', key: 'codexRows' } as const, [] as Row[])
const codexReading = atom({ plugin: 'usage-pace', key: 'codexReading' } as const, null)
const codexLabels = atom({ plugin: 'usage-pace', key: 'codexLabels' } as const, {} as Record<string, string>)

const TICK_MS = 5 * 60 * 1000
const AGENT_TICK_MS = 1000
const CODEX_TICK_MS = 5000
const CODEX_SCAN_MS = 30_000
const CODEX_LIMIT_MS = 60_000
// A job counts as started by a Claude agent's companion call made this close to it.
const CODEX_MATCH_MS = 20_000
const MAX_ROWS = 6
const STORE_KEY = 'lastReading'

const record = async ($: EngineInterface, limits: SessionRateLimit[]) => {
  const week = limits.find(l => l.kind === 'seven_day')
  if (!week?.resetsAt) {
    return
  }

  const next: Reading = { percentUsed: week.percentUsed, resetsAt: week.resetsAt, seenAt: await $.clock.now() }
  await update($, reading, () => next)
  await update($, now, () => next.seenAt)
  await $.store.set(STORE_KEY, next)
}

const run = async ($: EngineInterface, argv: string[]): Promise<string> => {
  try {
    const r = await $.process.run(argv, { timeoutMs: 10_000 })

    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

/** What the Codex tick carries from one run to the next. */
type CodexScan = {
  stateFiles: string[]
  scannedAt: number
  limitAt: number
  jobIds: string
  busy: boolean
  /** Companion calls made by Claude agents: when, and the agent's description. */
  calls: { at: number; label: string }[]
}

/** The label of the companion call made close to when the job was created, used up once matched. */
const matchCall = (calls: CodexScan['calls'], job: CodexJob): string | undefined => {
  const created = Date.parse(job.createdAt ?? job.startedAt ?? '')
  const i = calls.findIndex(c => Math.abs(created - c.at) <= CODEX_MATCH_MS)

  return i < 0 ? undefined : calls.splice(i, 1)[0]?.label
}

const codexTick = async ($: EngineInterface, scan: CodexScan) => {
  if (scan.busy) {
    return
  }
  scan.busy = true
  try {
    const t = await $.clock.now()
    const home = (await $.env.get('HOME')) ?? ''
    const claudeDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const codexDir = (await $.env.get('CODEX_HOME')) ?? `${home}/.codex`

    if (t - scan.scannedAt >= CODEX_SCAN_MS) {
      scan.scannedAt = t
      const root = `${claudeDir}/plugins/data/codex-openai-codex/state`
      const out = await run($, ['find', root, '-maxdepth', '2', '-name', 'state.json', '-mmin', '-1440'])
      scan.stateFiles = out.split('\n').filter(Boolean)
    }

    const states = await Promise.all(
      scan.stateFiles.map(f =>
        $.fs
          .read(f)
          .then(text => JSON.parse(String(text)) as unknown)
          .catch(() => null),
      ),
    )
    let jobs = sessionJobs(states, await $.session.id())

    // A job whose process has gone stays "running" in its file; leave it out.
    const pids = jobs.map(j => j.pid).filter((p): p is number => typeof p === 'number')
    if (pids.length > 0) {
      const alive = new Set((await run($, ['ps', '-o', 'pid=', '-p', pids.join(',')])).split(/\s+/).filter(Boolean))
      jobs = jobs.filter(j => typeof j.pid !== 'number' || alive.has(String(j.pid)))
    }

    const labels = await read($, codexLabels)
    const adopted: Record<string, string> = {}
    for (const job of jobs) {
      const label = labels[job.id] ?? matchCall(scan.calls, job)
      if (label) {
        adopted[job.id] = label
      }
    }
    if (JSON.stringify(adopted) !== JSON.stringify(labels)) {
      await update($, codexLabels, () => adopted)
    }

    const steps = await Promise.all(
      jobs.map(j => (j.logFile ? run($, ['tail', '-c', '4096', j.logFile]).then(lastStep) : undefined)),
    )
    const next = jobs.map((j, i) => codexRow(j, t, steps[i], adopted[j.id]))
    if (JSON.stringify(next) !== JSON.stringify(await read($, codexRows))) {
      await update($, codexRows, () => next)
    }

    const ids = jobs.map(j => j.id).join(',')
    if (ids !== scan.jobIds || t - scan.limitAt >= CODEX_LIMIT_MS) {
      scan.jobIds = ids
      scan.limitAt = t
      const line = (await run($, ['/bin/sh', '-c', NEWEST_LIMIT_SCRIPT, 'sh', `${codexDir}/sessions`])).trim()
      const limit = line ? weekLimit(line) : null
      if (limit && JSON.stringify(limit) !== JSON.stringify(await read($, codexReading))) {
        await update($, codexReading, () => limit)
      }
    }
  } finally {
    scan.busy = false
  }
}

export const register: Register = on => {
  const lastTool = new Map<string, string>()
  // Claude agents that started a Codex job, and when each call was made.
  const wrappers = new Set<string>()
  // What the Codex tick knows between runs; it starts over on a reload.
  const scan: CodexScan = { stateFiles: [], scannedAt: -Infinity, limitAt: -Infinity, jobIds: '', busy: false, calls: [] }
  let shownJson = '[]'
  let agentTimer: Timer | undefined
  let codexTimer: Timer | undefined

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if ('model' in result && result.agentId) {
      const id = result.agentId
      const entry: Spawned = { startedAt: await $.clock.now(), model: result.model }
      await update($, spawned, prev => ({ ...prev, [id]: entry }))
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const call = e as unknown as Record<string, unknown>
      lastTool.set(e.agentId, describeCall(call))

      // Noted before the call runs: a foreground Codex job holds it until the job ends.
      if (call.tool === 'Bash' && typeof call.command === 'string' && startsCodexJob(call.command)) {
        const agentId = e.agentId
        wrappers.add(agentId)
        const agent = (await $.agent.list()).find(a => a.id === agentId)
        scan.calls.push({ at: await $.clock.now(), label: agent?.description || 'Codex task' })
        scan.calls.splice(0, scan.calls.length - 10)
        scan.scannedAt = -Infinity
      }
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Reading | undefined
    if (saved) {
      await update($, reading, () => saved)
    }
    const startedAt = await $.clock.now()
    await update($, now, () => startedAt)
    await record($, (await $.session.usage()).rateLimits)

    // The target moves with time even when no turn runs.
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })

    agentTimer?.cancel()
    agentTimer = $.clock.every(AGENT_TICK_MS, () => {
      void Promise.all([$.agent.list(), $.clock.now(), read($, spawned), read($, codexRows)]).then(
        async ([all, t, known, codex]) => {
          for (const id of lastTool.keys()) {
            if (!all.some(a => a.id === id)) {
              lastTool.delete(id)
            }
          }

          // While Codex's own rows show, the Claude agent waiting on it adds nothing.
          const agents =
            codex.length > 0 ? all.filter(a => !wrappers.has(a.id) && !/codex-rescue/.test(a.type ?? '')) : all

          // Agents that started before the plugin loaded count from when they were first seen.
          const seen: Record<string, Spawned> = {}
          for (const a of all) {
            seen[a.id] = known[a.id] ?? { startedAt: t }
          }
          if (JSON.stringify(seen) !== JSON.stringify(known)) {
            await update($, spawned, () => seen)
          }

          const active = activeRows(agents, lastTool, seen, t)
          const json = JSON.stringify(active)
          // Only a changed list redraws the band.
          if (json !== shownJson) {
            shownJson = json
            await update($, rows, () => active)
          }
        },
      )
    })

    codexTimer?.cancel()
    void codexTick($, scan).catch(() => undefined)
    codexTimer = $.clock.every(CODEX_TICK_MS, () => {
      void codexTick($, scan).catch(() => undefined)
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await record($, e.rateLimits)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reading)
    const cr = await read($, codexReading)
    const t = await read($, now)
    const list = [...(await read($, codexRows)), ...(await read($, rows))]
    if (e.props.hasSurvey || (r === null && cr === null && list.length === 0)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const at = t || (await $.clock.now())
    // With both bars showing, each names whose week it is.
    const both = r !== null && cr !== null

    const week = (label: string, x: Reading | null) => {
      if (x === null) {
        return null
      }

      const p = pace(x.percentUsed, Date.parse(x.resetsAt), at)
      if (p === null) {
        return <Text dimColor>{label.trim()}: new week, waiting for first reading</Text>
      }

      const tone = color[p.status]

      return (
        <Text>
          <Text dimColor>{label}</Text>
          {bar(p.used, p.target).map((run, i) => (
            <Text key={String(i)} color={run.kind === 'empty' ? undefined : tone} dimColor={run.kind === 'empty'}>
              {run.text}
            </Text>
          ))}
          <Text> {Math.round(p.used)}%</Text>
          <Text dimColor>/{Math.round(p.target)}%</Text>
          <Text dimColor> · ↻{formatLeft(p.msLeft)}</Text>
        </Text>
      )
    }

    const agents = () => {
      if (list.length === 0) {
        return null
      }

      const width = (typeof e.props.bodyColumns === 'number' ? e.props.bodyColumns : 80) - 2
      const shown = list.slice(0, MAX_ROWS)
      const hidden = list.length - shown.length

      return (
        <Box flexDirection="column">
          <Text>
            <Text dimColor>Agents </Text>
            <Text>{list.length}</Text>
          </Text>
          {shown.map((row, i) => (
            <Text key={`agent-${i}`} dimColor>
              {'  '}
              {rowText(row, width)}
            </Text>
          ))}
          {hidden > 0 ? <Text dimColor>{`  +${hidden} more`}</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {agents()}
        {week(both ? 'Claude ' : 'Week ', r)}
        {week('Codex  ', cr)}
      </Box>
    )
  })
}
