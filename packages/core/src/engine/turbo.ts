// Turbo speed + slam-stop, owned by the core. The HUD's turbo control (a 2- or 3-mode cycler)
// drives a speed multiplier; the game's Present phase awaits `ctx.turbo.delay(ms)` for its
// spin/anim durations, so turbo shortens them and a slam-stop (`skipRequested`) resolves them
// instantly — with ZERO game logic. Compliance waits (minimumRoundDuration) use `ctx.ticker`,
// NOT this, so they're never sped up or skipped.

/** Delay multipliers per turbo level: off (1×) / turbo (0.4×) / super (0.12×). */
export const DEFAULT_TURBO_SPEEDS = [1, 0.4, 0.12];

export interface TurboState {
  /** 0 = off, 1 = turbo, 2 = super — the HUD turbo cycler's index. */
  readonly level: number;
  /** The delay multiplier for the current level (`ctx.turbo.delay` already applies it). */
  readonly speed: number;
  /** True once the player slam-stopped this round (delays resolve instantly). */
  readonly skipped: boolean;
  /** A turbo- + slam-stop-aware delay for GAME animations. NOT for compliance waits. */
  delay(ms: number): Promise<void>;
}

export class TurboClock implements TurboState {
  private readonly speeds: number[];
  private _level = 0;
  private _skipped = false;
  private readonly pending = new Set<() => void>();

  constructor(speeds?: number[]) {
    this.speeds = speeds && speeds.length ? speeds : DEFAULT_TURBO_SPEEDS;
  }

  get level(): number {
    return this._level;
  }
  get speed(): number {
    return this.speeds[this._level] ?? this.speeds[this.speeds.length - 1] ?? 1;
  }
  get skipped(): boolean {
    return this._skipped;
  }

  /** Set the turbo level (clamped to the configured speeds). */
  setLevel(index: number): void {
    const i = Number.isFinite(index) ? Math.trunc(index) : 0;
    this._level = Math.max(0, Math.min(i, this.speeds.length - 1));
  }

  /** Slam-stop: resolve every in-flight delay + make the rest of the round instant. */
  skip(): void {
    this._skipped = true;
    const cbs = [...this.pending];
    this.pending.clear();
    for (const cb of cbs) cb();
  }

  /** Clear the slam-stop flag — the core calls this at the start of each spin. */
  resetSkip(): void {
    this._skipped = false;
  }

  delay(ms: number): Promise<void> {
    if (this._skipped || ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, ms * this.speed);
      this.pending.add(finish);
    });
  }
}
