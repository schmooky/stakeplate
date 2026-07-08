// interpretBook — translate a Stake "book" (a round's ordered events) into the
// resolved SpinResponse. The dice game's book carries a single `cascade` event
// (the resolved dice list + multiplier).

import type { Round } from '@lucky-magnet/stake-protocol';
import { BOOK_AMOUNT_MULTIPLIER } from '@lucky-magnet/stake-protocol';
import type { CascadeDie, SpinResponse } from '@/domain/types';

interface CascadeEvent { type: 'cascade'; dice: CascadeDie[]; multiplier: number }

function events(round: Round): Array<{ type: string } & Record<string, unknown>> {
  const state = (round as { state?: unknown; events?: unknown }).state ?? (round as { events?: unknown }).events;
  return Array.isArray(state) ? (state as Array<{ type: string } & Record<string, unknown>>) : [];
}

export function interpretBook(round: Round, stake: number, balanceMoney: number): SpinResponse {
  const ev = events(round).find((e): e is CascadeEvent & Record<string, unknown> => e.type === 'cascade');
  if (!ev) throw new Error('[interpretBook] book has no cascade event');
  const totalWin = (round.payoutMultiplier / BOOK_AMOUNT_MULTIPLIER) * stake;
  return { cascade: ev.dice, multiplier: ev.multiplier, totalWin, balance: balanceMoney };
}
