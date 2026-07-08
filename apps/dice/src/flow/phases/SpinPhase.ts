import { GAME } from '@/config/gameConfig';
import { sfx } from '@/infrastructure/audio/Sfx';
import type { Phase, PhaseContext } from '../Phase';

// SpinPhase: poof the old dice off the table, ask the server to resolve the
// cascade, then move on to play it back.

export class SpinPhase implements Phase {
  readonly name = 'spin';

  async enter(ctx: PhaseContext): Promise<void> {
    ctx.stores.balance.debitBet(); // optimistic; server balance is authoritative
    ctx.stores.ui.recordStake(ctx.stores.balance.bet);
    ctx.stores.ui.setSpinning(true);
    ctx.stores.data.clear();

    sfx.play('spin');
    await ctx.dice.clear(); // press spin → current dice poof first

    const response = await ctx.network.spin({ bet: ctx.stores.balance.bet, seed: GAME.defaultSeed, mode: 'base' });
    ctx.stores.data.setResponse(response);
    ctx.stores.balance.setBalance(response.balance);

    await ctx.fsm.transition('stopSpin');
  }
}
