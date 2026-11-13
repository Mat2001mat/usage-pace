import type { Reading, Row } from '../types'
import { clip, formatElapsed } from './agents'

/** One job as the Codex plugin's companion records it in its `state.json`. */
export type CodexJob = {
  id: string
  status: string
  phase?: string | null
  title?: string
  summary?: string
  sessionId?: string
  createdAt?: string
  startedAt?: string
  pid?: number
  logFile?: string
}

const ACTIVE = new Set(['queued', 'running'])
const WEEK_MINUTES = 7 * 24 * 60

/** The jobs this Claude session started that are still queued or running, oldest first. */
export const sessionJobs = (states: readonly unknown[], sessionId: string): CodexJob[] =>
  states
    .flatMap(s => {
      const jobs = (s as { jobs?: unknown } | null)?.jobs

      return Array.isArray(jobs) ? (jobs as CodexJob[]) : []
    })
    .filter(j => typeof j?.id === 'string' && j.sessionId === sessionId && ACTIVE.has(j.status))
    .sort((a, b) => String(a.startedAt ?? a.createdAt).localeCompare(String(b.startedAt ?? b.createdAt)))

/** "Running command: /bin/zsh -lc \"npm test\"" → "npm test"; other log lines stay as written. */
export const lastStep = (logTail: string): string | undefined => {
  const lines = logTail.split('\n').filter(l => /^\[\d{4}-\d\d-\d\dT[^\]]+\] /.test(l))
  const line = lines[lines.length - 1]?.replace(/^\[[^\]]+\] /, '')
  if (!line) {
    return undefined
  }
  const command = /^(?:Running command|Command completed): (.*?)(?: \(exit \d+\))?$/.exec(line)?.[1]
  const text = command ? command.replace(/^\/bin\/(?:ba|z)?sh -l?c "?/, '').replace(/"$/, '') : line

  return clip(text.replace(/\s+/g, ' ').trim(), 40)
}

/** What the job is about: the label Claude gave the task, else the opening of its request. */
export const jobLabel = (job: CodexJob, label?: string): string => {
  // The row already says Codex.
  const named = label?.replace(/^codex\b[\s:–-]*/i, '').trim()
  if (named) {
    return named
  }
  const summary = (job.summary ?? '')
    .replace(/[*`#_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const first = /^(.{8,}?[.!?:])(?:\s|$)/.exec(summary)?.[1] ?? summary

  return first || job.title || job.id
}

/** A Codex job as a row of the Agents list: its run time, "Codex", what it is about and its phase. */
export const codexRow = (job: CodexJob, now: number, step?: string, label?: string): Row => {
  const started = Date.parse(job.startedAt ?? job.createdAt ?? '')
  const doing = [job.phase ?? job.status, step].filter(Boolean).join(' · ')

  return {
    ...(Number.isFinite(started) ? { elapsed: formatElapsed(now - started) } : {}),
    model: 'Codex',
    description: jobLabel(job, label),
    status: job.status,
    ...(doing ? { lastTool: doing } : {}),
  }
}

type Window = { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown } | null | undefined

/** The weekly window from one `token_count` line of a Codex rollout, or null when it has none. */
export const weekLimit = (line: string): Reading | null => {
  let parsed: { timestamp?: string; payload?: { rate_limits?: { primary?: Window; secondary?: Window } } }
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const limits = parsed.payload?.rate_limits
  const week = [limits?.primary, limits?.secondary].find(w => w?.window_minutes === WEEK_MINUTES)
  if (!week || typeof week.used_percent !== 'number' || typeof week.resets_at !== 'number') {
    return null
  }
  const seenAt = Date.parse(parsed.timestamp ?? '')

  return {
    percentUsed: week.used_percent,
    resetsAt: new Date(week.resets_at * 1000).toISOString(),
    seenAt: Number.isFinite(seenAt) ? seenAt : 0,
  }
}

/** Whether a Bash command starts a Codex companion job. */
export const startsCodexJob = (command: string): boolean => /codex-companion\.mjs"?\s+task\b/.test(command)

/**
 * Prints the last weekly `token_count` line of the newest Codex rollouts. Codex keeps
 * one rollout per thread, and every turn writes the account's limits into its own.
 */
export const NEWEST_LIMIT_SCRIPT = `
find "$1" -name 'rollout-*.jsonl' -mmin -${WEEK_MINUTES} -exec ls -t {} + 2>/dev/null | head -5 | while IFS= read -r f; do
  line=$(grep '"window_minutes":${WEEK_MINUTES}' "$f" | tail -1)
  if [ -n "$line" ]; then printf '%s\\n' "$line"; exit 0; fi
done
`
