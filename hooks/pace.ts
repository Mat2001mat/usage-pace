const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const ON_TRACK_PTS = 5
const FAR_OFF_PTS = 15

export type Status = 'under' | 'on-track' | 'over' | 'way-over'

export type Pace = {
  used: number
  target: number
  gap: number
  status: Status
  perDay: number
  msLeft: number
}

export const pace = (percentUsed: number, resetsAtMs: number, now: number): Pace | null => {
  const msLeft = resetsAtMs - now
  if (msLeft <= 0 || msLeft > WEEK_MS) {
    return null
  }

  const target = ((WEEK_MS - msLeft) / WEEK_MS) * 100
  const gap = percentUsed - target
  const status: Status =
    gap > FAR_OFF_PTS ? 'way-over' : gap > ON_TRACK_PTS ? 'over' : gap < -ON_TRACK_PTS ? 'under' : 'on-track'
  const perDay = Math.max(0, 100 - percentUsed) / Math.max(msLeft / DAY_MS, 1 / 24)

  return { used: percentUsed, target, gap, status, perDay, msLeft }
}

export const formatLeft = (ms: number): string => {
  const hours = Math.floor(ms / (60 * 60 * 1000))
  const days = Math.floor(hours / 24)

  return days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`
}

export const color: Record<Status, string> = {
  'under': 'suggestion',
  'on-track': 'success',
  'over': 'warning',
  'way-over': 'error',
}

export type Run = { kind: 'fill' | 'empty' | 'mark'; text: string }

// A bar of `cells` cells: used filled, the rest empty, the target a marker.
export const bar = (used: number, target: number, cells = 12): Run[] => {
  const filled = Math.round((Math.min(100, Math.max(0, used)) / 100) * cells)
  const markAt = Math.min(cells - 1, Math.max(0, Math.round((target / 100) * cells)))
  const runs: Run[] = []

  for (let i = 0; i < cells; i++) {
    const kind = i === markAt ? 'mark' : i < filled ? 'fill' : 'empty'
    const char = kind === 'mark' ? '│' : kind === 'fill' ? '━' : '─'
    const last = runs[runs.length - 1]
    if (last?.kind === kind) {
      last.text += char
    } else {
      runs.push({ kind, text: char })
    }
  }

  return runs
}
