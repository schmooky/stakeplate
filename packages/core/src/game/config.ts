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
  /** Bet levels in MAJOR units. */
  bets: number[];
  /** Default bet (major); defaults to the middle of `bets`. Overridden by the session. */
  defaultBet?: number;
  /** Fallback currency code; the session/`?currency=` wins. */
  currency?: string;
  /** Theoretical RTP percentage for the readout (session `rtp` wins). */
  rtp?: number;
  /** Mode key → cost multiplier (a number) or a `ModeConfig`. `base` defaults to 1. */
  modes?: Record<string, ModeConfig | number>;
  /** Rules blocks for the HUD menu (`@open-slot-ui` `BlockSpec[]` / `MenuSpec`) — opaque here. */
  rules?: unknown;
  /** Confirm buys/activations costing MORE than this (× base bet). Stake requires 2. */
  confirmBuyAboveCost?: number;
  /** Extra `@open-slot-ui` `UISpec` fields merged into the built spec (escape hatch). */
  spec?: Record<string, unknown>;
}

/** The cost multiplier for a mode key (default 1 for `base` / unknown modes). */
export function modeCostOf(config: GameConfig, mode: string): number {
  const m = config.modes?.[mode];
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') return m.cost;
  return 1;
}
