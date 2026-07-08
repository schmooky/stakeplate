// interpretBook — translate a Stake "book" (a round's ordered events) into
// slotplate's resolved SpinResponse. Pure and transport-agnostic so both the
// live play path (StakeNetworkManager) and the read-only replay path
// (ReplayNetworkManager) render an identical book identically — which is exactly
// what the Stake replay requirement guarantees (same events → same render).

import type { RevealEvent, Round, VortexEvent, WinInfoEvent } from '@lucky-magnet/stake-protocol';
import { BOOK_AMOUNT_MULTIPLIER, roundEvents } from '@lucky-magnet/stake-protocol';
import type { Grid, SpinResponse, Winline } from '@/domain/types';

/**
 * @param round        the RGS round (book events under `round.state`/`events`).
 * @param stake        the staked amount this round, in major currency units.
 * @param balanceMoney the post-round wallet balance, in major currency units.
 */
export function interpretBook(round: Round, stake: number, balanceMoney: number): SpinResponse {
  const events = roundEvents(round);
  const reveal = events.find((e): e is RevealEvent => e.type === 'reveal');
  if (!reveal) throw new Error('[interpretBook] book has no reveal event');

  // reveal.board is [reel][row] of { name } — exactly slotplate's Grid shape.
  const grid: Grid = reveal.board.map((reel) => reel.map((cell) => cell.name));

  const vortexEvent = events.find((e): e is VortexEvent => e.type === 'vortex');
  const vortex = vortexEvent ? { col: vortexEvent.col } : undefined;

  const winInfo = events.find((e): e is WinInfoEvent => e.type === 'winInfo');
  const winlines: Winline[] = [];
  if (winInfo) {
    for (const w of winInfo.wins) {
      winlines.push({
        lineId: w.meta.lineIndex,
        symbolId: w.symbol,
        matchCount: w.positions.length,
        amount: (w.win / BOOK_AMOUNT_MULTIPLIER) * stake,
        positions: w.positions,
      });
    }
  }

  const totalWin = (round.payoutMultiplier / BOOK_AMOUNT_MULTIPLIER) * stake;
  return {
    grid,
    totalWin,
    winlines,
    balance: balanceMoney,
    ...(vortex ? { vortex } : {}),
  };
}
