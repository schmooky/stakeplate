// The default round phases (Idle → Spin → Present → Settle). The game writes Present
// (animate the round) and may override any of these. Balance/bet flow through the
// stores (createStakeGame reacts store→HUD); the phases call the HUD directly only for
// reportRound + errors.

import { API_AMOUNT_MULTIPLIER, type Round } from '../rgs/protocol';
import { roundInfo } from './round';
import type { Phase, PhaseContext } from './fsm';

/** Wait for the next spin (the HUD's `spinRequested` drives the transition to Spin). */
export class IdlePhase<T = unknown, V = unknown, E = unknown> implements Phase<T, V, E> {
  readonly name = 'idle';
  enter(ctx: PhaseContext<T, V, E>): void {
    ctx.stores.ui.setSpinning(false);
  }
}

/** Pick the mode, take the stake, ask the RGS, parse the round, hand off to Present. */
export class SpinPhase<T = unknown, V = unknown, E = unknown> implements Phase<T, V, E> {
  readonly name = 'spin';
  async enter(ctx: PhaseContext<T, V, E>): Promise<void> {
    const { stores, network, hud } = ctx;
    const mode = stores.ui.nextMode();
    const cost = ctx.modeCost(mode);
    const bet = stores.balance.bet;
    const stake = bet * cost;

    stores.ui.setSpinning(true);
    stores.balance.debitStake(stake); // stake leaves now; the win lands at Settle

    try {
      const play = await network.play({ bet, mode });
      // The transport is game-agnostic (events: unknown); the game declared `E`, so we
      // narrow here — the game owns the shape it parses in `interpretBook`.
      const raw = play.round as Round<E>;
      const info = roundInfo(raw, bet, cost);
      const data = ctx.interpretBook(raw, info);
      // DO NOT /wallet/end-round here. An ACTIVE round is left OPEN so a refresh DURING
      // Present (the game's reel/scene animation) can recover it — SettlePhase settles it
      // once the round has finished playing out. For an active round `play.balance` is
      // post-DEBIT (stake gone, win not yet credited), so the post-win balance the player
      // sees at Settle is play.balance + the (authoritative-from-book) win; SettlePhase then
      // reconciles to the server's own settled figure. A round that is already settled (a
      // loss, or an immediate-settle mock) reports its FINAL balance in play.balance — use
      // it verbatim, or the win would be double-counted.
      const settledMoney = play.balance.amount / API_AMOUNT_MULTIPLIER;
      ctx.round = {
        ...info,
        data,
        active: raw.active ?? false,
        balance: raw.active ? settledMoney + info.totalWin : settledMoney,
        raw,
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
export class PresentPhase<T = unknown, V = unknown, E = unknown> implements Phase<T, V, E> {
  readonly name = 'present';
  async enter(ctx: PhaseContext<T, V, E>): Promise<void> {
    await ctx.fsm.transition('settle');
  }
}

/** Apply the authoritative balance + win, settle the round for the HUD, then Idle. */
export class SettlePhase<T = unknown, V = unknown, E = unknown> implements Phase<T, V, E> {
  readonly name = 'settle';
  private roundStartedAt = 0;

  async enter(ctx: PhaseContext<T, V, E>): Promise<void> {
    const r = ctx.round;
    if (r) {
      ctx.stores.balance.settle(r.balance, r.totalWin);
      ctx.hud.reportRound(r.totalWin, r.bet);
      // minimumRoundDuration: pad to the jurisdiction minimum (best-effort; the boot
      // records the round start, so this covers the whole spin→settle span).
      const minMs = ctx.stores.session.jurisdiction.minimumRoundDuration ?? 0;
      const elapsed = (ctx.ticker.now() - this.roundStartedAt) * 1000;
      if (minMs > 0 && elapsed < minMs) await ctx.ticker.delay(minMs - elapsed);
      // The round has now finished playing out visually (Present + the min-duration pad).
      // ONLY NOW settle it on the server — SpinPhase deliberately left it OPEN so a refresh
      // mid-Present recovers the round instead of losing it. The win already shows (from the
      // book); this reconciles to the server's authoritative post-settlement balance.
      if (r.active) {
        try {
          const end = await ctx.network.endRound();
          ctx.stores.balance.setBalance(end.balance.amount / API_AMOUNT_MULTIPLIER);
        } catch (err) {
          // The win is already credited locally; a settle hiccup self-heals on the next
          // authenticate (the RGS reports the still-open round). Surface it, don't crash.
          console.warn('[settle] end-round failed; balance reconciles on next authenticate:', err);
        }
      }
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
export function defaultPhases<T = unknown, V = unknown, E = unknown>(): Phase<T, V, E>[] {
  return [new IdlePhase<T, V, E>(), new SpinPhase<T, V, E>(), new PresentPhase<T, V, E>(), new SettlePhase<T, V, E>()];
}
