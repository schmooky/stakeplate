// MockNetworkManager — an in-process, AUTHORITATIVE fake RGS for local dev + tests.
// It owns the balance, serves a config/jurisdiction, and is SCRIPTABLE: queue exact
// rounds with `forceRound(...)` (a 5000×, a bonus, a no-win) for deterministic play.
// Money is API units on the wire; `forceRound` amounts are convenient MAJOR units.

import {
  API_AMOUNT_MULTIPLIER,
  type AuthenticateResponse,
  type Balance,
  type EndRoundResponse,
  type JurisdictionConfig,
  type PlayResponse,
  type ReplayParams,
  type RgsConfig,
  type Round,
} from './protocol';
import type { NetworkManager, PlayArgs } from './network';

export interface MockOptions {
  /** Starting balance in MAJOR units (default 1000). */
  balance?: number;
  currency?: string;
  betLevels?: number[]; // major units
  defaultBet?: number; // major units
  rtp?: number;
  jurisdiction?: JurisdictionConfig;
  /** Mode key → cost multiplier, so the mock charges bet × cost like the platform. */
  modes?: Record<string, number>;
  /** An incomplete round present at authenticate — for testing mid-spin resume. */
  activeRound?: Round | null;
}

/** A scripted round. `payoutMultiplier` is BOOK units (×100); `win` (major) is a shortcut. */
export interface ScriptedRound {
  mode?: string;
  /** BOOK units (100 = 1×). Provide this OR `win`. */
  payoutMultiplier?: number;
  /** Convenience: the win in MAJOR units for the given bet (sets payoutMultiplier). */
  win?: number;
  /** The stake charged, MAJOR units (default = the bet passed to play). */
  stake?: number;
  /** The book events the game's `interpretBook` will parse. */
  events?: unknown[];
  /** Leave the round open (needs `end-round`) — for exercising the settle path. */
  active?: boolean;
}

const toApi = (major: number): number => Math.round(major * API_AMOUNT_MULTIPLIER);

export class MockNetworkManager implements NetworkManager {
  private balanceApi: number;
  private currency: string;
  private readonly config: RgsConfig;
  private active: Round | null;
  private readonly modes: Record<string, number>;
  private readonly queue: ScriptedRound[] = [];
  /** The last round returned but not yet end-round'd (its win is applied on settle). */
  private pendingWinApi = 0;

  constructor(opts: MockOptions = {}) {
    this.balanceApi = toApi(opts.balance ?? 1000);
    this.currency = opts.currency ?? 'USD';
    const levels = (opts.betLevels ?? [0.2, 0.5, 1, 2, 5, 10]).map(toApi);
    this.config = {
      minBet: levels[0]!,
      maxBet: levels[levels.length - 1]!,
      stepBet: levels[0]!,
      betLevels: levels,
      defaultBetLevel: toApi(opts.defaultBet ?? 1),
      ...(opts.rtp != null ? { rtp: opts.rtp } : {}),
      ...(opts.jurisdiction ? { jurisdiction: opts.jurisdiction } : {}),
    };
    this.active = opts.activeRound ?? null;
    this.modes = opts.modes ?? {};
  }

  /** Queue the next round `play()` will return (call repeatedly to queue several). */
  forceRound(round: ScriptedRound): this {
    this.queue.push(round);
    return this;
  }

  /** Set the current balance (MAJOR units). */
  setBalance(major: number): this {
    this.balanceApi = toApi(major);
    return this;
  }

  private balance(): Balance {
    return { amount: this.balanceApi, currency: this.currency };
  }

  async authenticate(): Promise<AuthenticateResponse> {
    return { balance: this.balance(), config: this.config, round: this.active };
  }

  async play(args: PlayArgs): Promise<PlayResponse> {
    const s = this.queue.shift() ?? {};
    const cost = this.modes[args.mode] ?? 1;
    const stakeApi = s.stake != null ? toApi(s.stake) : toApi(args.bet * cost);
    const betApi = toApi(args.bet); // win is relative to the BASE bet
    const pm = s.payoutMultiplier ?? (s.win != null && args.bet > 0 ? Math.round((s.win / args.bet) * 100) : 0);
    const winApi = Math.round((betApi * pm) / 100);
    this.balanceApi -= stakeApi;
    const round: Round = {
      betID: `mock-${Date.now()}`,
      mode: s.mode ?? args.mode,
      amount: stakeApi,
      payout: winApi,
      payoutMultiplier: pm,
      state: (s.events ?? []) as Round['state'],
      // Default: settle the win inline (balance returned by play is final). Script
      // `active: true` to leave it open + exercise the engine's end-round settle path.
      active: s.active ?? false,
    };
    if (round.active) this.pendingWinApi = winApi; // credited on end-round
    else this.balanceApi += winApi; // settled inline
    return { round, balance: this.balance() };
  }

  async endRound(): Promise<EndRoundResponse> {
    this.balanceApi += this.pendingWinApi;
    this.pendingWinApi = 0;
    this.active = null;
    return { balance: this.balance() };
  }

  async replay(_p: ReplayParams): Promise<Round> {
    const s = this.queue.shift() ?? { payoutMultiplier: 0 };
    return {
      betID: 'replay',
      mode: s.mode ?? 'base',
      amount: toApi(s.stake ?? 1),
      payout: 0,
      payoutMultiplier: s.payoutMultiplier ?? 0,
      state: (s.events ?? []) as Round['state'],
      active: false,
    };
  }
}
