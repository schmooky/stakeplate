// The subset of `@open-slot-ui`'s `BootedHud` the ENGINE calls. Declaring it here (as
// a structural interface with METHOD signatures — bivariant, so the real BootedHud
// satisfies it) keeps the FSM/phases decoupled from pixi + @open-slot-ui, so the whole
// round runs headless in a unit test. The BOOT layer (`createStakeGame`) owns the rich
// HUD config (currency/jurisdiction/rules) and hands the real BootedHud in here.

/** Facts shown at the start/end of a replay. Mirrors `@open-slot-ui`'s `ReplayInfo`
 *  (currency kept opaque so the engine needn't import the HUD's `CurrencySpec`). */
export interface ReplayInfo {
  baseBet: number;
  costMultiplier: number;
  payoutMultiplier: number;
  amount: number;
  currency?: unknown;
}

export interface HudPort {
  setBalance(major: number): void;
  setBet(major: number): void;
  setTotalWin(major: number): void;
  setFreeSpins(n: number): void;
  /** Settle one round — updates net position + autoplay limits. */
  reportRound(win: number, bet: number): void;
  showRgsError(code: string): void;
  showError(message: string): void;
  setReplay(on: boolean): void;
  replayStart(info: ReplayInfo, onPlay?: () => void): void;
  replayEnd(info: ReplayInfo, onReplay: () => void): void;
  lockInput(): void;
  unlockInput(): void;
  on(type: string, fn: (payload: unknown) => void): () => void;
}
