// The round model the engine drives. The engine derives all MONEY (multiplier, win,
// stake) from the raw wire round + the bet; the game's `interpretBook` only parses the
// book EVENTS into its own model (`data`) — the one place a game touches a round.

import { API_AMOUNT_MULTIPLIER, BOOK_AMOUNT_MULTIPLIER, type Round } from '../rgs/protocol';

/** Money facts of a settled round (all MAJOR units except `multiplier`, a ratio). */
export interface RoundInfo {
  mode: string;
  /** Base bet (before the mode's cost multiplier). */
  bet: number;
  /** Mode cost multiplier (× base bet) — the stake charged. */
  cost: number;
  /** The amount staked = bet × cost. */
  stake: number;
  /** Round multiplier relative to the BASE bet (totalWin / bet). */
  multiplier: number;
  /** Total win credited this round (derived: multiplier × bet). */
  totalWin: number;
  /** The server's AUTHORITATIVE win (`raw.payout`, major units); falls back to totalWin
   *  when the round carries no explicit payout. Trust this over `totalWin` when they differ. */
  payout: number;
}

/**
 * A resolved round: money facts + the game's parsed model + the raw wire round. `E` is the
 * game's book-event type — declared once on `createStakeGame`, so `raw` (and `interpretBook`)
 * are TYPED rather than `unknown`.
 */
export interface GameRound<T = unknown, E = unknown> extends RoundInfo {
  /** The game's parsed model, from `interpretBook` — driven to the Present phase. */
  data: T;
  /** Whether the raw round still needs `/wallet/end-round` (the engine settles it). */
  active: boolean;
  /** Authoritative post-settlement balance (major units) — applied by the Settle phase. */
  balance: number;
  /** The raw, fully-typed wire round — the game's real server data. */
  raw: Round<E>;
}

/** The game's ONE money-logic seam: parse the raw round's (typed) events into your model. Pure. */
export type InterpretBook<T, E = unknown> = (raw: Round<E>, info: RoundInfo) => T;

/** Build the money facts from a raw wire round + the base bet + the mode cost. */
export function roundInfo<E = unknown>(raw: Round<E>, bet: number, cost: number): RoundInfo {
  // Stake wire convention: `payoutMultiplier` is a plain Payout/Amount ratio (1× → 1)
  // in BOOK units (×100). totalWin is relative to the BASE bet; `payout` is the server's
  // own win amount (API units → major) when the round carries one.
  const multiplier = raw.payoutMultiplier / BOOK_AMOUNT_MULTIPLIER;
  const totalWin = multiplier * bet;
  const payout = raw.payout != null ? raw.payout / API_AMOUNT_MULTIPLIER : totalWin;
  return { mode: raw.mode, bet, cost, stake: bet * cost, multiplier, totalWin, payout };
}
