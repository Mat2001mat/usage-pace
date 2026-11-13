import { expect, test } from 'claude-code/testing'

import { codexRow, jobLabel, lastStep, sessionJobs, startsCodexJob, weekLimit } from './codex'

const job = (over: Record<string, unknown> = {}) => ({
  id: 'task-1',
  status: 'running',
  phase: 'verifying',
  title: 'Codex Task',
  summary: 'Fix the **ore seam** build. Then run the tests.',
  sessionId: 's1',
  createdAt: '2026-11-12T13:25:10.064Z',
  startedAt: '2026-11-12T13:25:10.086Z',
  ...over,
})

test("only this session's queued and running jobs count", () => {
  const states = [
    { jobs: [job(), job({ id: 'done', status: 'completed' }), job({ id: 'other', sessionId: 's2' })] },
    { jobs: [job({ id: 'queued', status: 'queued', startedAt: undefined, createdAt: '2026-11-12T10:00:00Z' })] },
    null,
    { nonsense: true },
  ]
  expect(sessionJobs(states, 's1').map(j => j.id)).toEqual(['queued', 'task-1'])
})

test('the last log line reads as the command Codex ran', () => {
  const log = [
    'Some markdown the job wrote',
    '[2026-11-12T14:14:51.590Z] Running command: /bin/zsh -lc "npm test -- --watch=false"',
    '[2026-11-12T14:14:52.724Z] Command completed: /bin/zsh -lc "npm test -- --watch=false" (exit 0)',
    '',
  ].join('\n')
  expect(lastStep(log)).toBe('npm test -- --watch=false')
  expect(lastStep('[2026-11-12T14:00:00.000Z] Applying 3 file change(s).')).toBe('Applying 3 file change(s).')
  expect(lastStep('no stamped lines')).toBeUndefined()
})

test("a job is named by Claude's label, else the opening of its request", () => {
  expect(jobLabel(job() as never, 'Codex writes ore seam build script')).toBe('writes ore seam build script')
  expect(jobLabel(job() as never, 'ore seam')).toBe('ore seam')
  expect(jobLabel(job() as never)).toBe('Fix the ore seam build.')
  expect(jobLabel(job({ summary: '' }) as never)).toBe('Codex Task')
})

test('a job row carries its run time, Codex, the task and its phase', () => {
  const now = Date.parse('2026-11-12T14:12:10.086Z')
  expect(codexRow(job() as never, now, 'npm test')).toEqual({
    elapsed: '47m',
    model: 'Codex',
    description: 'Fix the ore seam build.',
    status: 'running',
    lastTool: 'verifying · npm test',
  })
})

test('the weekly window is read from a token_count line', () => {
  const line = JSON.stringify({
    timestamp: '2026-11-11T21:56:22.608Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        primary: { used_percent: 30, window_minutes: 300, resets_at: 1794500000 },
        secondary: { used_percent: 9, window_minutes: 10080, resets_at: 1794607746 },
      },
    },
  })
  expect(weekLimit(line)).toEqual({
    percentUsed: 9,
    resetsAt: new Date(1794607746 * 1000).toISOString(),
    seenAt: Date.parse('2026-11-11T21:56:22.608Z'),
  })
  expect(weekLimit('{"payload":{"rate_limits":{"primary":null,"secondary":null}}}')).toBeNull()
  expect(weekLimit('not json')).toBeNull()
})

test('a companion task call is told from its other commands', () => {
  expect(startsCodexJob('node "/x/codex/1.0.6/scripts/codex-companion.mjs" task --write "fix it"')).toBe(true)
  expect(startsCodexJob('node "/x/scripts/codex-companion.mjs" status')).toBe(false)
  expect(startsCodexJob('npm test')).toBe(false)
})
