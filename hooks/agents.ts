import type { AgentInfo } from 'claude-code'

import type { Row, Spawned } from '../types'

const ACTIVE = new Set(['pending', 'running', 'waiting'])

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)

/** "claude-opus-5-5" → "Opus 5.5"; an id it does not know stays as given. */
export const modelLabel = (id: string): string => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id)
  if (!m) {
    return id
  }
  const [, family = '', major, minor] = m

  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** How long an agent has run: "<1m", "4m", "2h03m". */
export const formatElapsed = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) {
    return '<1m'
  }
  const hours = Math.floor(minutes / 60)

  return hours > 0 ? `${hours}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`
}

/** One line per agent: "2h03m  Opus 5.5  scan auth → Read middleware.ts". */
export const rowText = (r: Row, width: number): string =>
  clip(
    `${r.elapsed ? `${r.elapsed}  ` : ''}${r.model ? `${r.model}  ` : ''}${r.description}${r.lastTool ? ` → ${r.lastTool}` : ''}`,
    width,
  )

/** "Read foo.ts", "Bash npm test": the tool plus its most telling argument. */
export const describeCall = (e: Record<string, unknown>): string => {
  const tool = String(e.tool)
  const pick = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : undefined)

  const file = pick('file_path')
  const arg =
    (file && (file.split('/').pop() || file)) ??
    pick('command')?.split('\n')[0]?.replace(/^(cd\s+\S+\s*&&\s*)+/, '') ??
    pick('pattern') ??
    pick('query') ??
    pick('url')

  return arg ? `${tool} ${clip(arg, 40)}` : tool
}

/** The agents still at work, each with how long it has run, its model and the last tool its loop called. */
export const activeRows = (
  agents: AgentInfo[],
  lastTool: ReadonlyMap<string, string>,
  spawned: Readonly<Record<string, Spawned>> = {},
  now = 0,
): Row[] =>
  agents
    .filter(a => ACTIVE.has(a.status))
    .map(a => {
      const tool = lastTool.get(a.id)
      const seen = spawned[a.id]
      const row: Row = { description: a.description || a.name || a.id, status: a.status }

      return {
        ...(seen ? { elapsed: formatElapsed(now - seen.startedAt) } : {}),
        ...(seen?.model ? { model: modelLabel(seen.model) } : {}),
        ...row,
        ...(tool ? { lastTool: tool } : {}),
      }
    })
