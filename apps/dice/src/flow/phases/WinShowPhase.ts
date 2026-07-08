import { sfx } from '@/infrastructure/audio/Sfx';
import type { Phase, PhaseContext } from '../Phase';

const WIN_HOLD_MS = 1100;
const NOWIN_DELAY_MS = 450;

// WinShowPhase shows the server-resolved win, holds, then returns to idle. It
// does not evaluate dice — totalWin/combo arrived in the SpinResponse. The dice
// stay on the table; they poof on the next spin.

export class WinShowPhase implements Phase {
  readonly name = 'winShow';
  private cancel: { dispose(): void } | null = null;

  async enter(ctx: PhaseContext): Promise<void> {
    const { totalWin } = ctx.stores.data;
    const isWin = totalWin > 0;

    if (isWin) {
      // Server returns the POST-WIN balance (already reconciled in SpinPhase);
      // we only update the win counter — crediting here would double-count.
      ctx.stores.balance.setLastWin(totalWin);
      ctx.stores.ui.recordWin(totalWin);
      sfx.play(totalWin >= ctx.stores.balance.bet * 20 ? 'bigWin' : 'win');
    }

    this.cancel = ctx.ticker.schedule(isWin ? WIN_HOLD_MS : NOWIN_DELAY_MS, () => this.advance(ctx));
  }

  private advance(ctx: PhaseContext): void {
    const { ui } = ctx.stores;
    if (ui.isAutospinning) {
      ui.tickAutospin();
      if (ui.isAutospinning) {
        void ctx.fsm.transition('spin');
        return;
      }
    }
    void ctx.fsm.transition('idle');
  }

  skip(ctx: PhaseContext): void {
    this.cancel?.dispose();
    this.cancel = null;
    void ctx.fsm.transition('idle');
  }

  exit(): void {
    this.cancel?.dispose();
    this.cancel = null;
  }
}
