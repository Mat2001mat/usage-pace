import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { activeRows, describeCall, formatElapsed, modelLabel, rowText } from './agents'

test('row shows model, task and last tool', () => {
  expect(rowText({ model: 'Opus 5.5', description: 'scan auth', status: 'running', lastTool: 'Read a.ts' }, 80)).toBe(
    'Opus 5.5  scan auth → Read a.ts',
  )
  expect(rowText({ description: 'design cache', status: 'pending' }, 80)).toBe('design cache')
  expect(rowText({ elapsed: '2h03m', model: 'Opus 5.5', description: 'build', status: 'running' }, 80)).toBe(
    '2h03m  Opus 5.5  build',
  )
})

test('run time reads as hours and minutes', () => {
  expect(formatElapsed(20_000)).toBe('<1m')
  expect(formatElapsed(4 * 60_000 + 59_000)).toBe('4m')
  expect(formatElapsed(123 * 60_000)).toBe('2h03m')
  expect(formatElapsed(-5)).toBe('<1m')
})

test('model ids read as family and version', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
  expect(modelLabel('gpt-5')).toBe('gpt-5')
})

test('long rows are clipped to the width', () => {
  const s = rowText({ model: 'Opus 5.5', description: 'x'.repeat(200), status: 'running' }, 40)
  expect(s.length).toBe(40)
  expect(s.endsWith('…')).toBe(true)
})

test('a call reads as the tool and its most telling argument', () => {
  expect(describeCall({ tool: 'Read', file_path: '/repo/src/foo.ts' })).toBe('Read foo.ts')
  expect(describeCall({ tool: 'Bash', command: 'npm test\necho done' })).toBe('Bash npm test')
  expect(describeCall({ tool: 'Bash', command: 'cd /home/user/project && dotnet build' })).toBe('Bash dotnet build')
  expect(describeCall({ tool: 'Grep', pattern: 'src/.*\\.ts' })).toBe('Grep src/.*\\.ts')
  expect(describeCall({ tool: 'WebSearch', query: 'godot signals' })).toBe('WebSearch godot signals')
  expect(describeCall({ tool: 'WebFetch', url: 'https://example.com/a' })).toBe('WebFetch https://example.com/a')
  expect(describeCall({ tool: 'TodoWrite', todos: [] })).toBe('TodoWrite')
})

test('only pending, running and waiting agents become rows', () => {
  const agents = [
    { id: 'a', type: 'Explore', description: 'scan', status: 'running' },
    { id: 'b', type: 'Plan', description: 'plan', status: 'completed' },
    { id: 'c', type: 'general-purpose', description: '', name: 'helper', status: 'waiting' },
  ] as AgentInfo[]
  const spawned = { a: { startedAt: 0, model: 'claude-sonnet-5-5' }, c: { startedAt: 3_600_000 } }
  expect(activeRows(agents, new Map([['a', 'Read x.ts'], ['b', 'Bash ls']]), spawned, 4_000_000)).toEqual([
    { elapsed: '1h06m', model: 'Sonnet 5.5', description: 'scan', status: 'running', lastTool: 'Read x.ts' },
    { elapsed: '6m', description: 'helper', status: 'waiting' },
  ])
})
