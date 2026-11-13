export type Reading = { percentUsed: number; resetsAt: string; seenAt: number }

export type Row = { model?: string; elapsed?: string; description: string; status: string; lastTool?: string }

/** What the plugin noted about an agent: when it started (or was first seen) and its model. */
export type Spawned = { startedAt: number; model?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': {
      reading: Reading | null
      now: number
      rows: Row[]
      spawned: Record<string, Spawned>
      /** Codex jobs this session started that are still at work, as rows. */
      codexRows: Row[]
      /** Codex's weekly limit as its newest rollout last reported it. */
      codexReading: Reading | null
      /** The description of the Claude agent that started each Codex job, by job id. */
      codexLabels: Record<string, string>
    }
  }
}
