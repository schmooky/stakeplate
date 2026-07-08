// The default round phases (Idle → Spin → Present → Settle). The game writes Present
// (animate the round) and may override any of these. Balance/bet flow through the
// stores (createStakeGame reacts store→HUD); the phases call the HUD directly only for
// reportRound + errors.

import { API_AMOUNT_MULTIPLIER } from '../rgs/protocol';
import { roundInfo } from './round';
import type { Phase, PhaseContext } from './fsm';

/** Wait for the next spin (the HUD's `spinRequested` drives the transition to Spin). */
export class IdlePhase<T = unknown, V = unknown> implements Phase<T, V> {
  readonly name = 'idle';
  enter(ctx: PhaseContext<T, V>): void {
    ctx.stores.ui.setSpinning(false);
  }
}

/** Pick the mode, take the stake, ask the RGS, parse the round, hand off to Present. */
export class SpinPhase<T = unknown, V = unknown> implements Phase<T, V> {
  readonly name = 'spin';
  async enter(ctx: PhaseContext<T, V>): Promise<void> {
    const { stores, network, hud } = ctx;
    const mode = stores.ui.nextMode();
    const cost = ctx.modeCost(mode);
    const bet = stores.balance.bet;
    const stake = bet * cost;

    stores.ui.setSpinning(true);
    stores.balance.debitStake(stake); // stake leaves now; the win lands at Settle

    try {
      const play = await network.play({ bet, mode });
      let settledApi = play.balance.amount;
      if (play.round.active) settledApi = (await network.endRound()).balance.amount;
      const info = roundInfo(play.round, bet, cost);
      const data = ctx.interpretBook(play.round, info);
      ctx.round = {
        ...info,
        data,
        active: play.round.active ?? false,
        balance: settledApi / API_AMOUNT_MULTIPLIER,
        raw: play.round,
      };
    } catch (err) {
      stores.balance.refund(stake); // the round never happened
      stores.ui.setSpinning(false);
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.match(/ERR_[A-Z_]+/)?.[0];
      if (code) hud.showRgsError(code);
      else hud.showError(msg);
      await ctx.fsm.transition('idle');
      return;
    }

    await ctx.fsm.transition('present');
  }
}

/** DEFAULT Present — nothing to animate. The game overrides `present` to play its scene. */
export class PresentPhase<T = unknown, V = unknown> implements Phase<T, V> {
  readonly name = 'present';
  async enter(ctx: PhaseContext<T, V>): Promise<void> {
    await ctx.fsm.transition('settle');
  }
}

/** Apply the authoritative balance + win, settle the round for the HUD, then Idle. */
export class SettlePhase<T = unknown, V = unknown> implements Phase<T, V> {
  readonly name = 'settle';
  private roundStartedAt = 0;

  async enter(ctx: PhaseContext<T, V>): Promise<void> {
    const r = ctx.round;
    if (r) {
      ctx.stores.balance.settle(r.balance, r.totalWin);
      ctx.hud.reportRound(r.totalWin, r.bet);
      // minimumRoundDuration: pad to the jurisdiction minimum (best-effort; the boot
      // records the round start, so this covers the whole spin→settle span).
      const minMs = ctx.stores.session.jurisdiction.minimumRoundDuration ?? 0;
      const elapsed = (ctx.ticker.now() - this.roundStartedAt) * 1000;
      if (minMs > 0 && elapsed < minMs) await ctx.ticker.delay(minMs - elapsed);
    }
    ctx.stores.ui.setSpinning(false);
    await ctx.fsm.transition('idle');
  }

  /** Called by SpinPhase-adjacent boot wiring to timestamp the round start. */
  markStart(now: number): void {
    this.roundStartedAt = now;
  }
}

/** The default phase set (game phases are appended after → same-name overrides win). */
export function defaultPhases<T = unknown, V = unknown>(): Phase<T, V>[] {
  return [new IdlePhase<T, V>(), new SpinPhase<T, V>(), new PresentPhase<T, V>(), new SettlePhase<T, V>()];
}
