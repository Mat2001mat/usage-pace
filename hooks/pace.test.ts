import { expect, test } from 'claude-code/testing'

import { bar, formatLeft, pace } from './pace'

const DAY = 24 * 60 * 60 * 1000
const reset = Date.parse('2026-10-12T09:00:00Z')

test('halfway through the week the target is 50%', () => {
  const p = pace(50, reset, reset - 3.5 * DAY)
  expect(p?.target).toBe(50)
  expect(p?.status).toBe('on-track')
})

test('well behind pace says use more', () => {
  const p = pace(30, reset, reset - 3.5 * DAY)
  expect(p?.status).toBe('under')
  expect(Math.round(p!.gap)).toBe(-20)
  expect(p?.perDay).toBe(20)
})

test('ahead of pace says ease off', () => {
  expect(pace(60, reset, reset - 3.5 * DAY)?.status).toBe('over')
  expect(pace(75, reset, reset - 3.5 * DAY)?.status).toBe('way-over')
})

test('a reading past its reset is stale', () => {
  expect(pace(80, reset, reset + 1000)).toBe(null)
})

test('time left reads as days and hours', () => {
  expect(formatLeft(3 * DAY + 4 * 60 * 60 * 1000)).toBe('3d 4h')
  expect(formatLeft(5 * 60 * 60 * 1000)).toBe('5h')
})

test('the bar fills to usage and marks the target', () => {
  const text = (runs: ReturnType<typeof bar>) => runs.map(r => r.text).join('')
  expect(text(bar(25, 50, 8))).toBe('━━──│───')
  expect(text(bar(75, 50, 8))).toBe('━━━━│━──')
  expect(text(bar(100, 100, 8))).toBe('━━━━━━━│')
})
