// The round state machine. A round is an explicit sequence of awaited phases
// (Idle → Spin → Present → Settle); each `enter` does its work + transitions on. The
// core ships Idle/Spin/Settle; the game writes Present (and may override any). The FSM
// + context are pure — the HUD/view/audio arrive via ports, so a whole round runs
// headless (see the InstantTicker + MockNetworkManager).

import type { NetworkManager } from '../rgs/network';
import type { RootStore } from '../stores/index';
import type { Ticker } from './ticker';
import type { HudPort } from './hud-port';
import type { GameRound, InterpretBook } from './round';
import type { GameConfig } from '../game/config';

/** The minimal audio surface a game's phases call (satisfied by `@stakeplate/core/audio`). */
export interface AudioPort {
  play(name: string, opts?: { bus?: string; volume?: number }): void;
  music(name: string, opts?: { fadeIn?: number }): void;
  stopMusic(opts?: { fade?: number }): void;
}

/** Handed to every phase. `round` is set by SpinPhase and read by Present/Settle. */
export interface PhaseContext<T = unknown, V = unknown> {
  readonly config: GameConfig;
  readonly stores: RootStore;
  readonly network: NetworkManager;
  readonly hud: HudPort;
  readonly ticker: Ticker;
  /** The game's mounted view (scene/presenter/stores) — whatever `mountView` returned. */
  readonly view: V;
  readonly audio: AudioPort | null;
  readonly interpretBook: InterpretBook<T>;
  readonly fsm: FSM<T, V>;
  round: GameRound<T> | null;
  /** Cost multiplier for a mode key (from `config.modes`, default 1). */
  modeCost(mode: string): number;
}

export interface Phase<T = unknown, V = unknown> {
  readonly name: string;
  enter(ctx: PhaseContext<T, V>): Promise<void> | void;
  exit?(ctx: PhaseContext<T, V>): void;
}

export class FSM<T = unknown, V = unknown> {
  private ctx: PhaseContext<T, V> | null = null;
  private readonly byName = new Map<string, Phase<T, V>>();
  private _current = '';

  /** Later phases with the same `name` win — so a game's Present overrides the default. */
  constructor(phases: Phase<T, V>[]) {
    for (const p of phases) this.byName.set(p.name, p);
  }

  bind(ctx: PhaseContext<T, V>): void {
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
