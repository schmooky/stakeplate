// MockNetworkManager — offline stand-in server for Dice Cascade. Resolves the
// whole cascade locally (it IS the server here). Used when RUNTIME.network !==
// 'stake'. The real flow uses the RGS emulator.

import { GAME } from '@/config/gameConfig';
import type { SessionRequest, SessionResponse, SpinRequest, SpinResponse } from '@/domain/types';
import { resolveCascade } from './cascade';
import type { NetworkManager } from './types';

export interface MockNetworkOptions {
  startingBalance?: number;
  latency?: { session?: number; spin?: number };
}

export class MockNetworkManager implements NetworkManager {
  private balance: number;
  private readonly latency: { session: number; spin: number };

  constructor(opts: MockNetworkOptions = {}) {
    this.balance = opts.startingBalance ?? GAME.startingBalance;
    this.latency = { session: opts.latency?.session ?? 350, spin: opts.latency?.spin ?? 200 };
  }

  async session(_req: SessionRequest): Promise<SessionResponse> {
    await wait(this.latency.session);
    return {
      sessionId: `mock-${Math.random().toString(36).slice(2, 10)}`,
      balance: this.balance,
      currency: 'USD',
      availableBets: [0.2, 0.5, 1, 2, 5, 10],
      defaultBet: 1,
      rtp: 96,
      jurisdiction: { displayRTP: true, displayNetPosition: true, displaySessionTimer: true, minimumRoundDuration: 0 },
    };
  }

  async spin(req: SpinRequest): Promise<SpinResponse> {
    await wait(this.latency.spin);
    this.balance = Math.max(0, this.balance - req.bet);
    const { dice, multiplier } = resolveCascade(req.seed ?? GAME.defaultSeed);
    const totalWin = multiplier * req.bet;
    this.balance += totalWin;
    return { cascade: dice, multiplier, totalWin, balance: this.balance };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}
