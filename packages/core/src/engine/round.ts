// The round model the engine drives. The engine derives all MONEY (multiplier, win,
// stake) from the raw wire round + the bet; the game's `interpretBook` only parses the
// book EVENTS into its own model (`data`) — the one place a game touches a round.

import { BOOK_AMOUNT_MULTIPLIER, type Round } from '../rgs/protocol';

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
  /** Total win credited this round. */
  totalWin: number;
}

/** A resolved round: money facts + the game's parsed model + the raw wire round. */
export interface GameRound<T = unknown> extends RoundInfo {
  /** The game's parsed model, from `interpretBook` — driven to the Present phase. */
  data: T;
  /** Whether the raw round still needs `/wallet/end-round` (the engine settles it). */
  active: boolean;
  /** Authoritative post-settlement balance (major units) — applied by the Settle phase. */
  balance: number;
  /** The raw wire round, for advanced uses. */
  raw: Round;
}

/** The game's ONE money-logic seam: parse the raw round's events into your model. Pure. */
export type InterpretBook<T> = (raw: Round, info: RoundInfo) => T;

/** Build the money facts from a raw wire round + the base bet + the mode cost. */
export function roundInfo(raw: Round, bet: number, cost: number): RoundInfo {
  // Stake wire convention: `payoutMultiplier` is a plain Payout/Amount ratio (1× → 1)
  // in BOOK units (×100). totalWin is relative to the BASE bet.
  const multiplier = raw.payoutMultiplier / BOOK_AMOUNT_MULTIPLIER;
  return { mode: raw.mode, bet, cost, stake: bet * cost, multiplier, totalWin: multiplier * bet };
}
