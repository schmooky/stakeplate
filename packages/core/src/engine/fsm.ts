// The round state machine. A round is an explicit sequence of awaited phases
// (Idle → Spin → Present → Settle); each `enter` does its work + transitions on. The
// core ships Idle/Spin/Settle; the game writes Present (and may override any). The FSM
// + context are pure — the HUD/view/audio arrive via ports, so a whole round runs
// headless (see the InstantTicker + MockNetworkManager).

import type { NetworkManager } from '../rgs/network';
import type { RootStore } from '../stores/index';
import type { Ticker } from './ticker';
import type { TurboState } from './turbo';
import type { HudPort } from './hud-port';
import type { GameRound, InterpretBook } from './round';
import type { GameConfig } from '../game/config';

/** A fixed value or a per-voice random spread (`{ base, jitter }`) — structurally matches
 *  zvuk's `VoiceJitter` without importing it, so the engine stays zvuk-free. */
export type AudioValue = number | { base?: number; jitter?: number };

/** The minimal audio surface a game's phases call (satisfied by `@stakeplate/core/audio`). */
export interface AudioPort {
  /** Fire a one-shot. `volume`/`pitch` accept jitter so repeated cues vary per voice. */
  play(name: string, opts?: { bus?: string; volume?: AudioValue; pitch?: AudioValue }): void;
  music(name: string, opts?: { fadeIn?: number }): void;
  stopMusic(opts?: { fade?: number }): void;
}

/** Handed to every phase. `round` is set by SpinPhase and read by Present/Settle. `E` is
 *  the game's book-event type, so `interpretBook`/`round.raw` are typed. */
export interface PhaseContext<T = unknown, V = unknown, E = unknown> {
  readonly config: GameConfig;
  readonly stores: RootStore;
  readonly network: NetworkManager;
  readonly hud: HudPort;
  readonly ticker: Ticker;
  /** The game's mounted view (scene/presenter/stores) — whatever `mountView` returned. */
  readonly view: V;
  readonly audio: AudioPort | null;
  /** Turbo speed + slam-stop (core-owned). Use `ctx.turbo.delay(ms)` for spin/anim timing. */
  readonly turbo: TurboState;
  readonly interpretBook: InterpretBook<T, E>;
  readonly fsm: FSM<T, V, E>;
  round: GameRound<T, E> | null;
  /** Cost multiplier for a mode key (from `config.modes`, default 1). */
  modeCost(mode: string): number;
}

export interface Phase<T = unknown, V = unknown, E = unknown> {
  readonly name: string;
  enter(ctx: PhaseContext<T, V, E>): Promise<void> | void;
  exit?(ctx: PhaseContext<T, V, E>): void;
}

export class FSM<T = unknown, V = unknown, E = unknown> {
  private ctx: PhaseContext<T, V, E> | null = null;
  private readonly byName = new Map<string, Phase<T, V, E>>();
  private _current = '';

  /** Later phases with the same `name` win — so a game's Present overrides the default. */
  constructor(phases: Phase<T, V, E>[]) {
    for (const p of phases) this.byName.set(p.name, p);
  }

  bind(ctx: PhaseContext<T, V, E>): void {
    this.ctx = ctx;
  }

  get current(): string {
    return this._current;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  async transition(name: string): Promise<void> {
    if (!this.ctx) throw new Error('[FSM] not bound to a context');
    const next = this.byName.get(name);
    if (!next) throw new Error(`[FSM] unknown phase: ${name}`);
    this.byName.get(this._current)?.exit?.(this.ctx);
    this._current = name;
    await next.enter(this.ctx);
  }
}
