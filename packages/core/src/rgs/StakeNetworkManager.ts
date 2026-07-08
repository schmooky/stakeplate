// StakeNetworkManager — the ONLY thing that speaks the Stake RGS wire. Thin: it
// returns RAW protocol shapes; the engine (SpinPhase/boot) owns the end-round settle
// + active-round resume. Money: RGS = API units (×1e6); the game's book = BOOK units.

import {
  API_AMOUNT_MULTIPLIER,
  type AuthenticateResponse,
  type EndRoundResponse,
  type PlayResponse,
  type ReplayParams,
  type Round,
} from './protocol';
import type { NetworkManager, PlayArgs } from './network';

export interface StakeNetworkOptions {
  rgsUrl: string;
  sessionId: string;
  /** REQUIRED — `/wallet/authenticate` 400s without it. */
  language: string;
}

export class StakeNetworkManager implements NetworkManager {
  private readonly base: string;
  /** Currency learned at authenticate; sent on every `/wallet/play`. */
  private currency = 'USD';

  constructor(private readonly opts: StakeNetworkOptions) {
    this.base = /^https?:\/\//.test(opts.rgsUrl) ? opts.rgsUrl : `https://${opts.rgsUrl}`;
  }

  async authenticate(): Promise<AuthenticateResponse> {
    const res = await this.post<AuthenticateResponse>('/wallet/authenticate', {
      sessionID: this.opts.sessionId,
      language: this.opts.language,
    });
    this.currency = res.balance.currency;
    return res;
  }

  async play(args: PlayArgs): Promise<PlayResponse> {
    return this.post<PlayResponse>('/wallet/play', {
      sessionID: this.opts.sessionId,
      currency: args.currency ?? this.currency,
      amount: Math.round(args.bet * API_AMOUNT_MULTIPLIER),
      mode: args.mode,
    });
  }

  async endRound(): Promise<EndRoundResponse> {
    return this.post<EndRoundResponse>('/wallet/end-round', { sessionID: this.opts.sessionId });
  }

  async replay(p: ReplayParams): Promise<Round> {
    const path = `/bet/replay/${encodeURIComponent(p.game)}/${encodeURIComponent(p.version)}/${encodeURIComponent(p.mode)}/${encodeURIComponent(p.event)}`;
    const res = await this.get<Record<string, unknown>>(path);
    // The RGS may return `{ round }` or the round object directly.
    return (res.round ?? res) as Round;
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

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.base + path, { method: 'GET', headers: { accept: 'application/json' } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[StakeNetworkManager] ${path} -> ${res.status} ${text}`);
    }
    return (await res.json()) as T;
  }
}
