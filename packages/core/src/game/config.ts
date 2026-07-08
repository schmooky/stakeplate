// The per-game configuration passed to `createStakeGame`. Everything the core needs to
// stand up the HUD + drive the round; the game's mechanics live in its scene + phases.

export interface ModeConfig {
  /** Cost multiplier (× base bet). `base` is 1. */
  cost: number;
  /** A one-shot bought bonus (vs a toggled boost) — informs the buy-confirm flow. */
  buy?: boolean;
}

export interface GameConfig {
  title: string;
  version?: string;
  /** Fallback currency code; the session/`?currency=` wins. */
  currency?: string;
  /**
   * Theoretical RTP percentage — DISPLAY ONLY (the RTP readout + rules). NOT authoritative:
   * the server (`auth.config.rtp`) wins, and the certified math report is the source of
   * truth. This is only a last-resort fallback; prefer never hand-typing it (drift risk).
   */
  rtp?: number;
  /** Mode key → cost multiplier (a number) or a `ModeConfig`. `base` defaults to 1. */
  modes?: Record<string, ModeConfig | number>;
  /** Rules blocks for the HUD menu (`@open-slot-ui` `BlockSpec[]` / `MenuSpec`) — opaque here. */
  rules?: unknown;
  /** Extra `@open-slot-ui` `UISpec` fields merged into the built spec (escape hatch). */
  spec?: Record<string, unknown>;
}

// NOTE (server-authoritative): the bet ladder (`betLevels` + `defaultBetLevel`) and the
// buy-feature confirm threshold are NOT game config — the RGS `authenticate` response owns
// the ladder (per currency/jurisdiction) and the jurisdiction owns the confirm policy. The
// core reads them from `auth.config`; a game only declares that a mode is a buy (`modes`).

/** The cost multiplier for a mode key (default 1 for `base` / unknown modes). */
export function modeCostOf(config: GameConfig, mode: string): number {
  const m = config.modes?.[mode];
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') return m.cost;
  return 1;
}
