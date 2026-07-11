// A blocking "announcement beat" — the pattern behind moments like a bonus trigger or a
// "… ELIMINATED!" banner: pause so the reveal settles, SHOW the announcement, HOLD it
// alone on screen, HIDE it, then a trailing pause before play resumes. The point is that
// the round never plays UNDER the announcement — everything waits for the beat.
//
// The game owns the visuals (`show`/`hide` — mount a banner, toggle a class, play an sfx);
// the core owns the timing + sequencing so every game's beats feel consistent.

import type { Ticker } from './ticker';
import type { TurboState } from './turbo';

export interface BeatOptions {
  /** Pause before the announcement shows — lets the reveal settle. Default 0. */
  leadMs?: number;
  /** How long the announcement holds alone on screen. */
  holdMs: number;
  /** Pause after hiding, before play resumes. Default 0. */
  trailMs?: number;
  /** Reveal the announcement (banner/sfx). Called after the lead pause. */
  show: () => void;
  /** Hide it. Called after the hold, before the trailing pause. Optional (some banners
   *  self-dismiss). */
  hide?: () => void;
  /**
   * Timing source. `'real'` (default) is a fixed, unskippable beat via the ticker — an
   * announcement is a deliberate moment that a slam-stop shouldn't blow past. `'turbo'`
   * makes the pauses turbo-/autoplay-/slam-stop-aware (shorter under turbo, skippable).
   */
  timing?: 'real' | 'turbo';
}

/** Timing surface the beat needs — a `PhaseContext` satisfies it (`ctx.ticker`/`ctx.turbo`). */
export interface BeatClock {
  ticker: Ticker;
  turbo: TurboState;
}

/**
 * Run a blocking announcement beat: lead → show → hold → hide → trail. Awaitable, so a
 * Present phase just `await blockingBeat(ctx, { … })` and the round pauses for the whole
 * thing. Returns when the beat (including the trailing pause) is over.
 */
export async function blockingBeat(ctx: BeatClock, opts: BeatOptions): Promise<void> {
  const wait = opts.timing === 'turbo' ? (ms: number) => ctx.turbo.delay(ms) : (ms: number) => ctx.ticker.delay(ms);
  if (opts.leadMs && opts.leadMs > 0) await wait(opts.leadMs);
  opts.show();
  await wait(opts.holdMs);
  opts.hide?.();
  if (opts.trailMs && opts.trailMs > 0) await wait(opts.trailMs);
}
