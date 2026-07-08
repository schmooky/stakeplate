// ReplayNetworkManager — the read-only transport for Stake "bet replay" mode.
//
// Unlike the live StakeNetworkManager it makes NO authenticated calls
// (no /wallet/authenticate, /wallet/play or /wallet/end-round). It fetches the
// historical round once from `GET {rgs_url}/bet/replay/{game}/{version}/{mode}/{event}`
// and serves that single book through the same `interpretBook` pipeline, so the
// replay renders bit-for-bit identically to the original round. "Play again"
// simply re-serves the cached book.

import type { BookEvent, Round } from '@lucky-magnet/stake-protocol';
import type { ReplayParams } from '@/config/replay';
import type { SessionRequest, SessionResponse, SpinRequest, SpinResponse } from '@/domain/types';
import { interpretBook } from './interpretBook';
import type { NetworkManager } from './types';

/** Shape of the RGS replay endpoint response. */
interface ReplayResponse {
  payoutMultiplier: number;
  costMultiplier?: number;
  state: BookEvent[];
}

/** Display-only balance shown in replay (no real wallet exists). */
const REPLAY_BALANCE = 1000;

export interface ReplayNetworkOptions {
  params: ReplayParams;
  columns: number;
  rows: number;
}

export class ReplayNetworkManager implements NetworkManager {
  private readonly base: string;
  private cached: Round | null = null;

  constructor(private readonly opts: ReplayNetworkOptions) {
    const url = opts.params.rgsUrl;
    this.base = /^https?:\/\//.test(url) ? url : `https://${url}`;
  }

  /** No authenticate call — a synthetic, display-only session. */
  async session(_req: SessionRequest): Promise<SessionResponse> {
    const { params } = this.opts;
    return {
      sessionId: 'replay',
      balance: REPLAY_BALANCE,
      currency: params.currency,
      availableBets: [params.amount],
      defaultBet: params.amount,
      columns: this.opts.columns,
      rows: this.opts.rows,
    };
  }

  async spin(_req: SpinRequest): Promise<SpinResponse> {
    const round = await this.fetchReplay();
    // Balance is held constant — replay never moves a real wallet.
    return interpretBook(round, this.opts.params.amount, REPLAY_BALANCE);
  }

  private async fetchReplay(): Promise<Round> {
    if (this.cached) return this.cached;
    const { game, version, mode, event } = this.opts.params;
    const url = `${this.base}/bet/replay/${encodeURIComponent(game)}/${encodeURIComponent(version)}/${encodeURIComponent(mode)}/${encodeURIComponent(event)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[ReplayNetworkManager] ${url} -> ${res.status} ${text}`);
    }
    const data = (await res.json()) as ReplayResponse;
    const round: Round = {
      betID: `replay:${event}`,
      mode,
      amount: 0,
      payoutMultiplier: data.payoutMultiplier,
      state: data.state,
      active: false,
    };
    this.cached = round;
    return round;
  }
}
