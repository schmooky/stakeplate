import type { Phase, PhaseContext } from '../Phase';

export class StopSpinPhase implements Phase {
  readonly name = 'stopSpin';

  async enter(ctx: PhaseContext): Promise<void> {
    const { grid, teasingReels, vortex } = ctx.stores.data;

    // If the server told us which reels to tease, pass that to the engine.
    // The client does not decide teasers — it plays back what came over the wire.
    if (teasingReels?.length) {
      ctx.reels.setAnticipation(teasingReels);
    }

    await ctx.reels.stopWithResult(grid);

    // Vortex: the server spawned a full digit column this spin — play the swirl
    // flourish on that column before resolving wins. Never let a presentation
    // glitch hang the round.
    if (vortex) {
      try {
        await ctx.reels.vortexSpawn(vortex.col);
      } catch (err) {
        console.error('[stopSpin] vortex spawn failed:', err);
      }
    }

    await ctx.fsm.transition('winShow');
  }

  skip(ctx: PhaseContext): void {
    ctx.reels.forceStop();
  }
}
