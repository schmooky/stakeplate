// The timing seam. Prod uses real wall-clock delays; tests use an INSTANT ticker so
// a whole round runs headless with no rAF/setTimeout. Phases `await ctx.ticker.delay(ms)`
// for beats + `minimumRoundDuration`; game scenes drive their own animation ticker.

export interface Ticker {
  /** Seconds since some epoch (monotonic-ish). */
  now(): number;
  /** Resolve after `ms` milliseconds. */
  delay(ms: number): Promise<void>;
}

/** Real timer — `setTimeout`-backed, `performance.now()` clock. */
export class RealTicker implements Ticker {
  now(): number {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  }
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}

/** Instant ticker for tests — every delay resolves immediately; the clock advances by
 *  the requested amount so `now()` deltas + `minimumRoundDuration` maths stay sane. */
export class InstantTicker implements Ticker {
  private t = 0;
  now(): number {
    return this.t;
  }
  delay(ms: number): Promise<void> {
    this.t += Math.max(0, ms) / 1000;
    return Promise.resolve();
  }
}
