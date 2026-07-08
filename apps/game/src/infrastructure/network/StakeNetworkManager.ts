// StakeNetworkManager — talks to a Stake Engine RGS (the local emulator in dev,
// or a real Carrot RGS in production) and translates the returned *book events*
// into slotplate's resolved SpinResponse. This is the ONLY place that knows the
// Stake wire format; the FSM/presenters/reels stay platform-agnostic.
//
// Flow per spin:
//   POST /wallet/play  -> a pre-generated book (reveal + win events), debits stake
//   POST /wallet/end-round (only if the round won) -> credits + settles
//   interpret round.events -> { grid, winlines, totalWin, balance, bonus }
//
// Money: the RGS speaks API units (value * 1e6); books carry BOOK units
// (value * 100). We convert both back to major units for the client.

import type { AuthenticateResponse, EndRoundResponse, PlayResponse } from '@lucky-magnet/stake-protocol';
import { API_AMOUNT_MULTIPLIER } from '@lucky-magnet/stake-protocol';
import { GAME } from '@/config/gameConfig';
import type { SessionRequest, SessionResponse, SpinRequest, SpinResponse } from '@/domain/types';
import { interpretBook } from './interpretBook';
import type { NetworkManager } from './types';

export interface StakeNetworkOptions {
  /** Base URL of the RGS (e.g. http://localhost:4757). */
  rgsUrl: string;
  /** Session id passed by the lobby; in dev any stable string works. */
  sessionId: string;
  /** Bet-mode to play. Defaults to 'base'. */
  mode?: string;
  /** Grid shape — the RGS config doesn't restate it, so the client supplies it. */
  columns: number;
  rows: number;
}

export class StakeNetworkManager implements NetworkManager {
  private readonly mode: string;
  private readonly base: string;

  constructor(private readonly opts: StakeNetworkOptions) {
    this.mode = opts.mode ?? 'base';
    // Stake hands the client `rgs_url` sometimes without a scheme — default https.
    this.base = /^https?:\/\//.test(opts.rgsUrl) ? opts.rgsUrl : `https://${opts.rgsUrl}`;
  }

  async session(_req: SessionRequest): Promise<SessionResponse> {
    const auth = await this.post<AuthenticateResponse>('/wallet/authenticate', {
      sessionID: this.opts.sessionId,
    });
    // Resume: if a prior session left a round open, the RGS reports it here.
    // Settle it before the first spin so /wallet/play isn't rejected as "active".
    let balanceApi = auth.balance.amount;
    if (auth.round?.active) {
      const end = await this.post<EndRoundResponse>('/wallet/end-round', {
        sessionID: this.opts.sessionId,
      });
      balanceApi = end.balance.amount;
    }
    return {
      sessionId: this.opts.sessionId,
      balance: balanceApi / API_AMOUNT_MULTIPLIER,
      currency: auth.balance.currency,
      availableBets: auth.config.betLevels.map((b) => b / API_AMOUNT_MULTIPLIER),
      defaultBet: auth.config.defaultBetLevel / API_AMOUNT_MULTIPLIER,
      columns: this.opts.columns,
      rows: this.opts.rows,
      // Stake Engine compliance: RTP figure + the jurisdiction switchboard, passed
      // straight through to the HUD (hud.setRtp / hud.applyJurisdiction).
      ...(auth.config.rtp != null ? { rtp: auth.config.rtp } : {}),
      ...(auth.config.jurisdiction ? { jurisdiction: auth.config.jurisdiction } : {}),
    };
  }

  async spin(req: SpinRequest): Promise<SpinResponse> {
    // The Vortex ante stakes more per spin (and pays proportionally more).
    const mode = req.mode ?? 'base';
    const stake = mode === 'vortex' ? req.bet * GAME.vortexAnte : req.bet;
    const amount = Math.round(stake * API_AMOUNT_MULTIPLIER);
    const play = await this.post<PlayResponse>('/wallet/play', {
      sessionID: this.opts.sessionId,
      amount,
      mode,
    });

    // Winning rounds must be settled via /wallet/end-round; the settled balance
    // is the authoritative POST-WIN figure the client reconciles to.
    let balanceApi = play.balance.amount;
    if (play.round.active) {
      const end = await this.post<EndRoundResponse>('/wallet/end-round', {
        sessionID: this.opts.sessionId,
      });
      balanceApi = end.balance.amount;
    }

    return interpretBook(play.round, stake, balanceApi / API_AMOUNT_MULTIPLIER);
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
