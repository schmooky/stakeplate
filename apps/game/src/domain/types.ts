// Wire types — shapes that cross the network and layer boundaries.
//
// Rule: the client does NOT compute wins, does NOT know the paytable, does
// NOT evaluate anything. The server returns a fully resolved SpinResponse;
// the client plays it back. Anything the view needs to render the round
// must come over the wire.

export type SymbolId = string;
export type Grid = SymbolId[][]; // [reel][row]

/** A board cell coordinate. */
export interface GridCell {
  reel: number;
  row: number;
}

export interface SpinRequest {
  bet: number;
  sessionId?: string;
  /** Bet mode. 'vortex' is the paid ante that guarantees a vortex every spin. */
  mode?: 'base' | 'vortex';
}

export interface Winline {
  lineId: number;
  symbolId: SymbolId;
  matchCount: number;
  amount: number;
  // Server-provided cell positions — client renders, does not compute.
  positions: GridCell[];
}

export interface SpinResponse {
  /** Final grid of symbols to show. */
  grid: Grid;
  /** Total credit to the player this round. */
  totalWin: number;
  /** Winning lines as the server resolved them. */
  winlines: Winline[];
  /** Optional: reels the view should visually tease. Server-directed. */
  teasingReels?: number[];
  /** Optional: the Vortex spawned a full digit column this spin (reel 0-2). */
  vortex?: { col: number };
  /**
   * Authoritative POST-WIN balance — the wallet figure the player will see
   * once the round resolves, with the bet already debited and the win
   * already credited. The client does NOT add `totalWin` on top of this.
   *
   * If your server returns a pre-win figure, wrap it in your custom
   * NetworkManager so it returns post-win to the client.
   */
  balance: number;
}

export interface SessionRequest {
  /** Opaque token from the lobby (query param, postMessage, etc.). Optional for dev. */
  token?: string;
}

export interface SessionResponse {
  sessionId: string;
  /** Authoritative opening balance. */
  balance: number;
  /** ISO currency code — shown in the HUD. */
  currency: string;
  /** Bets the player is allowed to set. */
  availableBets: number[];
  /** Default bet for this session. */
  defaultBet: number;
  /** Grid dimensions — server may override client config. */
  columns: number;
  rows: number;
  /** Theoretical RTP as a percentage (e.g. 96.0), for the compliance readout. */
  rtp?: number;
  /** Stake Engine regulatory switchboard from `/wallet/authenticate`. */
  jurisdiction?: JurisdictionConfig;
}

/**
 * Stake Engine per-player jurisdiction config (the compliance switchboard the RGS
 * returns at authenticate). Structurally compatible with open-ui's
 * `JurisdictionConfig`, so it can be passed straight to `hud.applyJurisdiction`.
 */
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
