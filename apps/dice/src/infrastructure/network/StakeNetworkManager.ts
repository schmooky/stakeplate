// StakeNetworkManager — talks to a Stake Engine RGS (the local dice emulator in
// dev). The ONLY place that knows the Stake wire format; the FSM/presenter stay
// platform-agnostic. Money: RGS = API units (×1e6), books = BOOK units (×100).

import type { AuthenticateResponse, EndRoundResponse, PlayResponse } from '@lucky-magnet/stake-protocol';
import { API_AMOUNT_MULTIPLIER } from '@lucky-magnet/stake-protocol';
import { GAME } from '@/config/gameConfig';
import type { SessionRequest, SessionResponse, SpinRequest, SpinResponse } from '@/domain/types';
import { interpretBook } from './interpretBook';
import type { NetworkManager } from './types';

export interface StakeNetworkOptions {
  rgsUrl: string;
  sessionId: string;
}

export class StakeNetworkManager implements NetworkManager {
  private readonly base: string;

  constructor(private readonly opts: StakeNetworkOptions) {
    this.base = /^https?:\/\//.test(opts.rgsUrl) ? opts.rgsUrl : `https://${opts.rgsUrl}`;
  }

  async session(_req: SessionRequest): Promise<SessionResponse> {
    const auth = await this.post<AuthenticateResponse>('/wallet/authenticate', { sessionID: this.opts.sessionId });
    let balanceApi = auth.balance.amount;
    if (auth.round?.active) {
      const end = await this.post<EndRoundResponse>('/wallet/end-round', { sessionID: this.opts.sessionId });
      balanceApi = end.balance.amount;
    }
    return {
      sessionId: this.opts.sessionId,
      balance: balanceApi / API_AMOUNT_MULTIPLIER,
      currency: auth.balance.currency,
      availableBets: auth.config.betLevels.map((b) => b / API_AMOUNT_MULTIPLIER),
      defaultBet: auth.config.defaultBetLevel / API_AMOUNT_MULTIPLIER,
      ...(auth.config.rtp != null ? { rtp: auth.config.rtp } : {}),
      ...(auth.config.jurisdiction ? { jurisdiction: auth.config.jurisdiction } : {}),
    };
  }

  async spin(req: SpinRequest): Promise<SpinResponse> {
    const amount = Math.round(req.bet * API_AMOUNT_MULTIPLIER);
    const play = await this.post<PlayResponse>('/wallet/play', {
      sessionID: this.opts.sessionId,
      amount,
      mode: req.mode ?? 'base',
      seed: req.seed ?? 'white',
    });
    let balanceApi = play.balance.amount;
    if (play.round.active) {
      const end = await this.post<EndRoundResponse>('/wallet/end-round', { sessionID: this.opts.sessionId });
      balanceApi = end.balance.amount;
    }
    return interpretBook(play.round, req.bet, balanceApi / API_AMOUNT_MULTIPLIER);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[StakeNetworkManager] ${path} -> ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
