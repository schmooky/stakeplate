// Base observable state (MobX). Balance/Session/UI are game-agnostic; a game adds its
// own stores (its round model, feature state) alongside these via the DI it owns. All
// amounts are MAJOR units (the transport handles API-unit conversion).

import { makeAutoObservable } from 'mobx';
import type { JurisdictionConfig } from '../rgs/protocol';

/** Player funds + the current bet. Mutated only through actions. */
export class BalanceStore {
  balance = 0;
  /** Base bet (per line/spin), before any mode cost multiplier. */
  bet = 0;
  lastWin = 0;

  constructor() {
    makeAutoObservable(this);
  }

  setBalance(v: number): void {
    this.balance = v;
  }
  setBet(v: number): void {
    this.bet = v;
  }
  /** Take the stake at spin press (win is credited on settle). */
  debitStake(stake: number): void {
    this.balance -= stake;
  }
  /** Undo a debit (the round never happened). */
  refund(stake: number): void {
    this.balance += stake;
  }
  /** Record + credit a settled win. */
  credit(win: number): void {
    this.lastWin = win;
    this.balance += win;
  }
  /** Apply the AUTHORITATIVE post-round balance + record the win (server-settled). */
  settle(balance: number, win: number): void {
    this.balance = balance;
    this.lastWin = win;
  }
}

/** Session facts from `/wallet/authenticate` (read-mostly). */
export class SessionStore {
  sessionId = '';
  currency = 'USD';
  rtp = 96;
  availableBets: number[] = [];
  jurisdiction: JurisdictionConfig = {};

  constructor() {
    makeAutoObservable(this);
  }

  set(patch: Partial<SessionStore>): void {
    Object.assign(this, patch);
  }
}

/** Player-facing UI/session state. Games extend with their own store for feature flags. */
export class UiStore {
  spinning = false;
  /** Free spins remaining (0 = normal play). */
  freeSpins = 0;
  /** A one-shot mode for the next spin (e.g. a bought bonus) — wins over `activeMode`. */
  oneShotMode: string | null = null;
  /** The persistent active mode (e.g. a toggled boost). */
  activeMode: string | null = null;
  /** Replay mode (Stake `replay=true`). */
  replay = false;

  constructor() {
    makeAutoObservable(this);
  }

  setSpinning(v: boolean): void {
    this.spinning = v;
  }
  setFreeSpins(n: number): void {
    this.freeSpins = Math.max(0, n);
  }
  setOneShotMode(m: string | null): void {
    this.oneShotMode = m;
  }
  setActiveMode(m: string | null): void {
    this.activeMode = m;
  }
  /** The mode for the next spin: one-shot wins, then the active mode, then 'base'. */
  nextMode(): string {
    const m = this.oneShotMode ?? this.activeMode ?? 'base';
    this.oneShotMode = null;
    return m;
  }
}

/** Aggregates the base stores. A game may compose this with its own stores. */
export class RootStore {
  readonly balance = new BalanceStore();
  readonly session = new SessionStore();
  readonly ui = new UiStore();
}
