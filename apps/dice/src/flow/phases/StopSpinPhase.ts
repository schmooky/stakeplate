import type { Phase, PhaseContext } from '../Phase';

// StopSpinPhase: play back the server-resolved cascade — dice drop in, mystery
// faces spawn more, piling up. Resolves once everything has settled.

export class StopSpinPhase implements Phase {
  readonly name = 'stopSpin';

  async enter(ctx: PhaseContext): Promise<void> {
    await ctx.dice.play(ctx.stores.data.cascade);
    await ctx.fsm.transition('winShow');
  }
}
