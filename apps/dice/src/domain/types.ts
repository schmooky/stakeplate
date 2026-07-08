// Wire types — shapes that cross the network and layer boundaries.
//
// Dice Cascade: the server resolves the whole cascade (which dice drop, their
// colors, their up-faces, and how mysteries spawn more) and the final payout.
// The client pre-simulates each drop and plays it back deterministically.

/** A single die face outcome. */
export type Face =
  | { kind: 'blank' }
  | { kind: 'pay'; v: number }
  | { kind: 'mult'; k: number }
  | { kind: 'mystery' };

/** One die in the resolved cascade, in drop order. */
export interface CascadeDie {
  /** Color id (white|green|blue|purple|gold). Picks the face set + tint. */
  color: string;
  /** The face that lands up (server-decided). */
  face: Face;
  /** Index of the mystery die that spawned this one, or -1 for the seed. */
  parent: number;
}

export interface SpinRequest {
  bet: number;
  sessionId?: string;
  /** Seed color for the first die. */
  seed?: string;
  mode?: 'base';
}

export interface SpinResponse {
  /** The resolved cascade, in drop order (seed first). */
  cascade: CascadeDie[];
  /** Final round multiplier (winSum × multProduct, capped). */
  multiplier: number;
  /** Total credit to the player this round (multiplier × bet). */
  totalWin: number;
  /** Authoritative POST-WIN balance. */
  balance: number;
}

export interface SessionRequest {
  token?: string;
}

export interface SessionResponse {
  sessionId: string;
  balance: number;
  currency: string;
  availableBets: number[];
  defaultBet: number;
  rtp?: number;
  jurisdiction?: JurisdictionConfig;
}

export interface JurisdictionConfig {
  socialCasino?: boolean;
  disabledFullscreen?: boolean;
  disabledTurbo?: boolean;
  disabledSuperTurbo?: boolean;
  disabledAutoplay?: boolean;
  disabledSlamstop?: boolean;
  disabledSpacebar?: boolean;
  disabledBuyFeature?: boolean;
  displayNetPosition?: boolean;
  displayRTP?: boolean;
  displaySessionTimer?: boolean;
  minimumRoundDuration?: number;
}
