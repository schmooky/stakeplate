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
  /** The EFFECTIVE delay multiplier right now — the turbo level, floored by the autoplay
   *  speed while autoplay is running (`ctx.turbo.delay` already applies it). */
  readonly speed: number;
  /** True while autoplay/hold is running — game animations are shortened even at turbo off. */
  readonly autoplay: boolean;
  /** True once the player slam-stopped this round (delays resolve instantly). */
  readonly skipped: boolean;
  /** A turbo- + autoplay- + slam-stop-aware delay for GAME animations. NOT for compliance waits. */
  delay(ms: number): Promise<void>;
}

export class TurboClock implements TurboState {
  private readonly speeds: number[];
  /** Delay multiplier applied while autoplay/hold runs (the floor for `speed`). Defaults to
   *  the turbo (level-1) speed, so autoplay plays at least at turbo pace even at turbo off. */
  private readonly autoplaySpeed: number;
  private _level = 0;
  private _autoplay = false;
  private _skipped = false;
  private readonly pending = new Set<() => void>();

  constructor(speeds?: number[], autoplaySpeed?: number) {
    this.speeds = speeds && speeds.length ? speeds : DEFAULT_TURBO_SPEEDS;
    this.autoplaySpeed = autoplaySpeed ?? this.speeds[1] ?? 0.5;
  }

  get level(): number {
    return this._level;
  }
  get speed(): number {
    const levelSpeed = this.speeds[this._level] ?? this.speeds[this.speeds.length - 1] ?? 1;
    // Autoplay shortens animations even at turbo off — but never SLOWS a faster turbo level.
    return this._autoplay ? Math.min(levelSpeed, this.autoplaySpeed) : levelSpeed;
  }
  get autoplay(): boolean {
    return this._autoplay;
  }
  get skipped(): boolean {
    return this._skipped;
  }

  /** Set the turbo level (clamped to the configured speeds). */
  setLevel(index: number): void {
    const i = Number.isFinite(index) ? Math.trunc(index) : 0;
    this._level = Math.max(0, Math.min(i, this.speeds.length - 1));
  }

  /** Mark autoplay/hold as running so `delay()` shortens game animations. The core sets
   *  this on autoplayStarted/holdSpinStarted and clears it when they stop. */
  setAutoplay(active: boolean): void {
    this._autoplay = active;
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
