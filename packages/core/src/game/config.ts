// The per-game configuration passed to `createStakeGame`. Everything the core needs to
// stand up the HUD + drive the round; the game's mechanics live in its scene + phases.

export interface ModeConfig {
  /** Cost multiplier (× base bet). `base` is 1. */
  cost: number;
  /** A one-shot bought bonus — shown as a `Buy` card in the buy-feature modal (opened by the
   *  bonus button). Buying it spins this mode once (through the jurisdiction confirm gate). */
  buy?: boolean;
  /** An activatable per-spin bet surcharge — shown as an `Activate` card (vs a one-tap `Buy`). */
  boost?: boolean;
  /** Display name for the feature card (defaults to the capitalized mode key). */
  name?: string;
  /** Card art (URL or data URI) for the feature card. A neutral gradient is used when absent. */
  image?: string;
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
  /** Rules/info menu for the HUD (`@open-slot-ui` `MenuSpec`) — build it with `@stakeplate/core/rules` `buildRules`. */
  rules?: unknown;
  /** i18n messages per locale (`{ en: { key: text }, es: {…} }`) for the HUD + rules text. */
  messages?: Record<string, Record<string, string>>;
  /** SOCIAL/sweepstakes wording per locale — swapped in when social mode is on. Merge in
   *  `buildRules().socialEn` so the core's disclaimer/guide are social-safe. */
  socialMessages?: Record<string, Record<string, string>>;
  /** Delay multipliers per turbo level (off / turbo / super). Default `[1, 0.4, 0.12]`. */
  turboSpeeds?: number[];
  /** Pause (ms) between autoplay/hold spins. Default 250. Scales with turbo. */
  autoplayGapMs?: number;
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
