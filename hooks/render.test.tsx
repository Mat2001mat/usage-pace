import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const DAY = 24 * 60 * 60 * 1000
const RESET = '2026-10-12T09:00:00Z'
const HALFWAY = Date.parse(RESET) - 3.5 * DAY
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 100 } } as const

test('the row shows usage against the straight-line target', async ($, on) => {
  mock.clock(on, { now: HALFWAY })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: HALFWAY, context: {}, rateLimits: [] } }) as never)
  on('session.start', () => ({ cwd: '/' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await $.session.measure({
    context: {},
    rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: RESET }],
    changed: ['rateLimits'],
  } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /use more|on track|ease off/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /30%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻3d 12h/ })).toBeDefined()
    await ui.unmount()
  }
})

test('nothing is drawn before any reading', async ($, on) => {
  mock.clock(on, { now: HALFWAY })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: HALFWAY, context: {}, rateLimits: [] } }) as never)
  on('session.start', () => ({ cwd: '/' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let passedOn = false
  on('ui.render', ($, e) => { passedOn = true; const { Text } = $.ui.resolve(e); return h(Text, {}, 'engine') as never })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /Week/ })).toBeUndefined()
  expect(passedOn).toBe(true)
  await ui.unmount()
})

const AGENTS = [
  { id: 'a1', type: 'Explore', description: 'scan auth', status: 'running' },
  { id: 'a2', type: 'Plan', description: 'design cache', status: 'pending' },
  { id: 'a3', type: 'general-purpose', description: 'old job', status: 'completed' },
]

const setUp = async (
  $: Parameters<TestBody>[0],
  on: Parameters<TestBody>[1],
  agents: unknown[],
  percentUsed: number | null = 30,
) => {
  const clock = mock.clock(on, { now: HALFWAY })
  mock.store(on)
  on('session.usage', () => ({ value: { startedAt: HALFWAY, context: {}, rateLimits: [] } }) as never)
  on('session.start', () => ({ cwd: '/' }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('agent.list', () => ({ value: agents }) as never)
  on('tool.call', () => ({ result: {}, text: '' }) as never)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'a1' }) as never)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  if (percentUsed !== null) {
    await $.session.measure({
      context: {},
      rateLimits: [{ kind: 'seven_day', percentUsed, resetsAt: RESET }],
      changed: ['rateLimits'],
    } as never)
  }

  return clock
}

test('active agents show beside the Week bar, each with its last tool', async ($, on) => {
  const clock = await setUp($, on, AGENTS)
  await $.agent.spawn({ prompt: 'scan auth' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/auth.ts', agentId: 'a1' } as never)
  await clock.advance(1000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /Agents 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ *<1m {2}Haiku 4\.5 {2}scan auth → Read auth\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ *<1m {2}design cache$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /old job/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Explore|Plan/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /↻3d 12h/ })).toBeDefined()
    await ui.unmount()
  }
})

test('with no agents at work only the Week bar shows', async ($, on) => {
  const clock = await setUp($, on, [AGENTS[2]])
  await clock.advance(1000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /Agents/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↻3d 12h/ })).toBeDefined()
  await ui.unmount()
})

test('agents show even before any usage reading', async ($, on) => {
  const clock = await setUp($, on, AGENTS, null)
  await clock.advance(1000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /Agents 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Week/ })).toBeUndefined()
  await ui.unmount()
})

test('more than six agents collapse into +N more', async ($, on) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, type: 'Explore', description: `task ${i}`, status: 'running' }))
  const clock = await setUp($, on, many)
  await clock.advance(1000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /Agents 8/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /task 5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /task 6/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\+2 more/ })).toBeDefined()
  await ui.unmount()
})

test('the run timer counts up and survives a reload of the plugin', async ($, on) => {
  const clock = await setUp($, on, AGENTS)
  await $.agent.spawn({ prompt: 'scan auth' } as never)
  await clock.advance(123 * 60_000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /^ *2h03m {2}Haiku 4\.5 {2}scan auth/ })).toBeDefined()
  await ui.unmount()

  // A reload runs session.start again; the start time is the host's, so it stays.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true } as never)
  await clock.advance(2 * 60_000)
  const again = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await again.find({ type: 'Text', text: /^ *2h05m {2}Haiku 4\.5 {2}scan auth/ })).toBeDefined()
  await again.unmount()
})

const CODEX_LINE = JSON.stringify({
  timestamp: new Date(HALFWAY).toISOString(),
  payload: {
    type: 'token_count',
    rate_limits: { primary: { used_percent: 12, window_minutes: 10080, resets_at: Date.parse(RESET) / 1000 }, secondary: null },
  },
})

const codexHost = (on: Parameters<TestBody>[1], jobs: unknown[]) => {
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'HOME' ? '/home/me' : undefined }) as never)
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('fs.read', () => ({ value: JSON.stringify({ jobs }) }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as { argv: string[] }).argv
    const out =
      argv[0] === 'find'
        ? '/home/me/.claude/plugins/data/codex-openai-codex/state/w-1/state.json\n'
        : argv[0] === 'ps'
          ? '  4242\n'
          : argv[0] === 'tail'
            ? '[2026-10-08T21:00:00.000Z] Running command: /bin/zsh -lc "dotnet test"\n'
            : argv[0] === '/bin/sh'
              ? `${CODEX_LINE}\n`
              : ''

    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
}

const CODEX_JOB = {
  id: 'task-1',
  status: 'running',
  phase: 'verifying',
  summary: 'Fix the ore seam build. Then test it.',
  sessionId: 'sess-1',
  startedAt: new Date(HALFWAY - 47 * 60_000).toISOString(),
  pid: 4242,
  logFile: '/tmp/job.log',
}

test("this session's Codex jobs show as rows, with Codex's week under Claude's", async ($, on) => {
  codexHost(on, [CODEX_JOB, { ...CODEX_JOB, id: 'gone', pid: 999 }, { ...CODEX_JOB, id: 'theirs', sessionId: 'other' }])
  const clock = await setUp($, on, [])
  await clock.advance(5000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-pace', surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: /Agents 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ *47m {2}Codex {2}Fix the ore seam build\. → verifying · dotnet test$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Claude $/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Codex {2}$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 12%/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the Claude agent waiting on a Codex job gives way to the job', async ($, on) => {
  codexHost(on, [CODEX_JOB])
  const clock = await setUp($, on, [
    { id: 'w1', type: 'codex:codex-rescue', description: 'Codex fixes ore seam', status: 'running' },
    AGENTS[0],
  ])
  await clock.advance(6000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /Agents 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Codex fixes ore seam/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /scan auth/ })).toBeDefined()
  await ui.unmount()
})

test('with no Codex reading the Claude bar keeps its Week label', async ($, on) => {
  const clock = await setUp($, on, [])
  await clock.advance(5000)

  const ui = await $.ui.mount({ plugin: 'usage-pace', surface: 'terminal', ...BAND } as never)
  expect(await ui.find({ type: 'Text', text: /^Week $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Codex/ })).toBeUndefined()
  await ui.unmount()
})
