/**
 * Stake Engine wire protocol — shared by the local RGS emulator and the client.
 *
 * Two money scales (Stake convention):
 *   - API units : value * 1_000_000 (six implied decimals). Used by every RGS
 *                 endpoint (balance, bet amount, win).
 *   - BOOK units: value * 100. Used inside a book's `payoutMultiplier` and the
 *                 amounts in its events.
 *
 * So: win_in_api_units = round(betAmount_api * payoutMultiplier_book / 100).
 */

export const API_AMOUNT_MULTIPLIER = 1_000_000;
export const BOOK_AMOUNT_MULTIPLIER = 100;

// ---- Book (a single pre-generated round, produced by the math-sdk) ----

export interface BoardCell {
  name: string; // "DOT" | "D0".."D9"
}

export interface CellPos {
  reel: number;
  row: number;
}

export interface RevealEvent {
  index: number;
  type: 'reveal';
  board: BoardCell[][]; // [reel][row]
  paddingPositions: number[];
  gameType: string;
  anticipation: number[];
}

export interface WinEntry {
  symbol: string;
  kind: 'line';
  win: number; // BOOK units
  positions: CellPos[];
  meta: {
    winWithoutMult: number;
    /** Which of the 5 lines (0-2 rows, 3-4 diagonals) this win is on. */
    lineIndex: number;
    /** The number the consecutive digits formed (e.g. 4·2·7 → 427). */
    number: number;
  };
}

export interface WinInfoEvent {
  index: number;
  type: 'winInfo';
  totalWin: number; // BOOK units
  wins: WinEntry[];
}

/**
 * The Vortex spawned a full column of digits this spin. `col` is the board
 * column / reel index (0-2) the vortex filled. Random (~base mode) or guaranteed
 * (vortex mode); the client plays the spawn flourish on that column.
 */
export interface VortexEvent {
  index: number;
  type: 'vortex';
  col: number;
}

export interface AmountEvent {
  index: number;
  type: 'setWin' | 'setTotalWin' | 'finalWin';
  amount: number; // BOOK units
  winLevel?: number;
}

export type BookEvent = RevealEvent | VortexEvent | WinInfoEvent | AmountEvent;

export interface Book {
  id: number;
  payoutMultiplier: number; // BOOK units
  events: BookEvent[];
  criteria?: string;
  baseGameWins?: number;
  freeGameWins?: number;
}

// ---- RGS API ----

export interface Balance {
  amount: number; // API units
  currency: string;
}

export interface RgsConfig {
  minBet: number; // API units
  maxBet: number; // API units
  stepBet: number; // API units
  betLevels: number[]; // API units
  defaultBetLevel: number; // API units
  /** Theoretical RTP as a percentage (e.g. 96.0) — shown by the RTP readout. */
  rtp?: number;
  /** Stake Engine per-player regulatory switchboard (see {@link JurisdictionConfig}). */
  jurisdiction?: JurisdictionConfig;
}

/**
 * Stake Engine's per-player jurisdiction config, delivered at
 * `/wallet/authenticate` as `config.jurisdiction`. Each `disabled*` flag limits a
 * feature, each `display*` flag mandates a compliance readout, and
 * `minimumRoundDuration` is a hint the game enforces. Mirrors the open-ui
 * `JurisdictionConfig` shape (structurally compatible).
 *
 * @see https://github.com/StakeEngine/web-sdk — packages/rgs-fetcher/src/schema.ts
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
  /** Minimum ms a round must take — enforced by the game, not the platform. */
  minimumRoundDuration?: number;
}

export interface Round {
  betID: string | number;
  mode: string;
  amount: number; // API units (stake)
  payout?: number; // API units (win) — present on the real RGS
  payoutMultiplier: number; // BOOK units
  /**
   * The book's event sequence. The real Stake RGS returns it under `state`;
   * some emulators/responses use `events`. Read it via `roundEvents()`.
   */
  state?: BookEvent[];
  events?: BookEvent[];
  /** True while a (winning) round still awaits /wallet/end-round. */
  active?: boolean;
}

/** The book events for a round, whichever field the RGS used (`state` or `events`). */
export function roundEvents(round: Round): BookEvent[] {
  if (Array.isArray(round.state)) return round.state;
  if (Array.isArray(round.events)) return round.events;
  return [];
}

export interface AuthenticateRequest {
  sessionID: string;
  language?: string;
}
export interface AuthenticateResponse {
  balance: Balance;
  config: RgsConfig;
  round: Round | null;
}

export interface PlayRequest {
  sessionID: string;
  amount: number; // API units
  mode: string;
  currency?: string;
}
export interface PlayResponse {
  round: Round;
  balance: Balance;
}

export interface EndRoundRequest {
  sessionID: string;
}
export interface EndRoundResponse {
  balance: Balance;
}

export interface BalanceResponse {
  balance: Balance;
}

export interface RgsError {
  error: string; // ERR_VAL | ERR_IPB | ERR_IS | ...
  message?: string;
}
