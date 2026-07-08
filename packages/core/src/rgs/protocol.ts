/**
 * Stake Engine wire protocol — the GAME-AGNOSTIC shapes every Stake RGS speaks.
 * (A game's own book/event types live in the game and are parsed by its
 * `interpretBook`; here a round's events are opaque `unknown[]`.)
 *
 * Two money scales (Stake convention):
 *   - API units : value × 1_000_000 (six implied decimals). Every RGS endpoint.
 *   - BOOK units: value × 100. A book's `payoutMultiplier` + its event amounts.
 * So: win_api = round(betAmount_api × payoutMultiplier_book / 100).
 *
 * @see https://github.com/StakeEngine/web-sdk — packages/rgs-requests, rgs-fetcher/schema
 */

export const API_AMOUNT_MULTIPLIER = 1_000_000;
export const BOOK_AMOUNT_MULTIPLIER = 100;

export interface Balance {
  amount: number; // API units
  currency: string;
}

/**
 * Stake Engine's per-player jurisdiction config, delivered at `/wallet/authenticate`
 * as `config.jurisdiction`. Structurally compatible with `@open-slot-ui`'s
 * `JurisdictionConfig`, so it feeds straight into `hud.applyJurisdiction`.
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
  /** Minimum ms a round must take — enforced by the core, not the platform. */
  minimumRoundDuration?: number;
  /** Buy-feature confirm threshold (× base bet) — fed to the HUD's confirm gate. */
  confirmBuyAboveCost?: number;
}

export interface RgsConfig {
  minBet: number; // API units
  maxBet: number; // API units
  stepBet: number; // API units
  betLevels: number[]; // API units
  defaultBetLevel: number; // API units
  /** Theoretical RTP percentage (e.g. 96.0) for the RTP readout. */
  rtp?: number;
  jurisdiction?: JurisdictionConfig;
}

/**
 * One RGS round. `E` is the game's book-event type (opaque to the core — the game's
 * `interpretBook` narrows it). The real Stake RGS returns the event list under
 * `state`; some emulators use `events`; read via {@link roundEvents}.
 */
export interface Round<E = unknown> {
  betID: string | number;
  mode: string;
  amount: number; // API units (stake)
  payout?: number; // API units (win)
  payoutMultiplier: number; // BOOK units
  state?: E[];
  events?: E[];
  /** True while a (winning) round still awaits `/wallet/end-round`. */
  active?: boolean;
}

/** The book events for a round, whichever field the RGS used (`state` or `events`). */
export function roundEvents<E>(round: Round<E>): E[] {
  if (Array.isArray(round.state)) return round.state;
  if (Array.isArray(round.events)) return round.events;
  return [];
}

export interface AuthenticateRequest {
  sessionID: string;
  /** REQUIRED by the real RGS — omitting it 400s `ERR_VAL "could not parse request json"`. */
  language: string;
}
export interface AuthenticateResponse {
  balance: Balance;
  config: RgsConfig;
  round: Round | null;
}

export interface PlayRequest {
  sessionID: string;
  amount: number; // API units (base bet)
  mode: string;
  currency: string;
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

/** `GET /bet/replay/{game}/{version}/{mode}/{event}` params (from `?replay=…` launch). */
export interface ReplayParams {
  game: string;
  version: string;
  mode: string;
  event: string;
  /** The bet amount for the replayed round (API units are NOT used here; major units). */
  amount: number;
}

/** RGS error body (`{ error: 'ERR_VAL', message }`) — codes map to `hud.showRgsError`. */
export interface RgsError {
  error: string;
  message?: string;
}
