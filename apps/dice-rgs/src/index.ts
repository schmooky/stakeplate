/**
 * Local Stake RGS emulator.
 *
 * Implements Stake's documented wallet contract over plain HTTP+JSON so the game
 * runs fully offline against real math-sdk outcomes:
 *   POST /wallet/authenticate  -> balance, config, (resume) round
 *   POST /wallet/play          -> debit stake, draw a book, return its events
 *   POST /wallet/end-round     -> credit the win, settle the round
 *   POST /wallet/balance       -> current balance
 *
 * All amounts on the wire are API units (value * 1e6). Book payoutMultipliers are
 * BOOK units (value * 100): win_api = round(stake_api * payoutMultiplier / 100).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { genBook } from './game.ts';
import { API_AMOUNT_MULTIPLIER, BOOK_AMOUNT_MULTIPLIER } from '@lucky-magnet/stake-protocol';
import type {
  AuthenticateResponse,
  BalanceResponse,
  EndRoundResponse,
  PlayResponse,
  RgsConfig,
  Round,
} from '@lucky-magnet/stake-protocol';

// 4758 — the dice game's own port (the digits emulator uses 4757).
const PORT = Number(process.env.RGS_PORT ?? 4758);
const CURRENCY = process.env.RGS_CURRENCY ?? 'USD';
const OPENING_BALANCE = Math.round(Number(process.env.RGS_BALANCE ?? 1000) * API_AMOUNT_MULTIPLIER);
const GAME_ID = 'ps1_dice';
/** Outcomes are generated procedurally (see game.ts), so RTP is illustrative. */
const RTP_PERCENT = Number(process.env.RGS_RTP ?? 96);
/** The bet modes the emulator serves. */
const MODES = new Set(['base']);

const BET_LEVELS = [0.2, 0.5, 1, 2, 5, 10].map((v) => Math.round(v * API_AMOUNT_MULTIPLIER));

const flag = (name: string, def = false): boolean => {
  const v = process.env[name];
  return v === undefined ? def : v === '1' || v.toLowerCase() === 'true';
};

// Full Stake Engine compliance switchboard, returned at /wallet/authenticate as
// config.jurisdiction. Defaults to a fully-compliant strict jurisdiction: all
// three mandated readouts on (RTP, net position, session timer) and a minimum
// round duration. Every flag is env-overridable (RGS_JUR_*) to emulate a
// different jurisdiction without code changes.
const JURISDICTION = {
  socialCasino: flag('RGS_JUR_SOCIAL'),
  disabledFullscreen: flag('RGS_JUR_NO_FULLSCREEN'),
  disabledTurbo: flag('RGS_JUR_NO_TURBO'),
  disabledSuperTurbo: flag('RGS_JUR_NO_SUPERTURBO'),
  disabledAutoplay: flag('RGS_JUR_NO_AUTOPLAY'),
  disabledSlamstop: flag('RGS_JUR_NO_SLAMSTOP'),
  disabledSpacebar: flag('RGS_JUR_NO_SPACEBAR'),
  disabledBuyFeature: flag('RGS_JUR_NO_BUYFEATURE'),
  displayNetPosition: flag('RGS_JUR_NET', true),
  displayRTP: flag('RGS_JUR_RTP', true),
  displaySessionTimer: flag('RGS_JUR_TIMER', true),
  minimumRoundDuration: Number(process.env.RGS_JUR_MIN_ROUND_MS ?? 1000),
};

const CONFIG: RgsConfig = {
  minBet: BET_LEVELS[0]!,
  maxBet: BET_LEVELS[BET_LEVELS.length - 1]!,
  stepBet: BET_LEVELS[0]!,
  betLevels: BET_LEVELS,
  defaultBetLevel: Math.round(1 * API_AMOUNT_MULTIPLIER),
  rtp: RTP_PERCENT,
  jurisdiction: JURISDICTION,
};

interface ActiveRound {
  betID: string;
  amount: number;
  payoutMultiplier: number;
  mode: string;
}
interface Session {
  balance: number;
  active?: ActiveRound;
}

const sessions = new Map<string, Session>();
function getSession(sessionID: string): Session {
  let s = sessions.get(sessionID);
  if (!s) {
    s = { balance: OPENING_BALANCE };
    sessions.set(sessionID, s);
  }
  return s;
}

const balanceOf = (s: Session) => ({ amount: s.balance, currency: CURRENCY });

/** Credit a won-but-unsettled round and clear it. No-op if nothing is active. */
function settleActive(s: Session): void {
  if (!s.active) return;
  s.balance += Math.round((s.active.amount * s.active.payoutMultiplier) / BOOK_AMOUNT_MULTIPLIER);
  s.active = undefined;
}

// ---- HTTP plumbing ----

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(json);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ---- Handlers ----

function handleAuthenticate(sessionID: string): AuthenticateResponse {
  const s = getSession(sessionID);
  // Self-heal: settle any round left dangling by an interrupted prior session
  // (page reload, killed autoplay, or a client that skipped end-round) so a
  // fresh auth always starts clean. The real RGS resumes the prior round here.
  settleActive(s);
  return { balance: balanceOf(s), config: CONFIG, round: null };
}

function handlePlay(sessionID: string, amount: number, modeName: string, seed: string): PlayResponse {
  const s = getSession(sessionID);
  if (!MODES.has(modeName)) throw httpError(400, 'ERR_VAL', `unknown mode "${modeName}"`);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'ERR_VAL', 'amount must be > 0');
  if (s.active) {
    // Be forgiving in local dev: instead of blocking forever, close the stale
    // round (a win that never received /wallet/end-round) and warn. A real
    // Carrot RGS 400s here, so the warning flags a client that skips settling.
    console.warn(
      `[rgs] session "${sessionID}" had an unsettled round; auto-closing it (client should call /wallet/end-round after a win)`,
    );
    settleActive(s);
  }
  if (s.balance < amount) throw httpError(400, 'ERR_IPB', 'insufficient balance');

  const book = genBook(seed);
  s.balance -= amount;

  const betID = randomUUID();
  const settledImmediately = book.payoutMultiplier === 0;
  if (!settledImmediately) {
    s.active = { betID, amount, payoutMultiplier: book.payoutMultiplier, mode: modeName };
  }

  // Match the real Stake RGS shape: events under `state`, `active` boolean,
  // and `payout` (win in API units; settled on /wallet/end-round when active).
  const round: Round = {
    betID,
    mode: modeName,
    amount,
    payout: Math.round((amount * book.payoutMultiplier) / BOOK_AMOUNT_MULTIPLIER),
    payoutMultiplier: book.payoutMultiplier,
    active: !settledImmediately,
    // Dice events are a custom shape, not the shared board-based BookEvent union.
    state: book.events as unknown as Round['state'],
  };
  return { round, balance: balanceOf(s) };
}

function handleEndRound(sessionID: string): EndRoundResponse {
  const s = getSession(sessionID);
  settleActive(s);
  return { balance: balanceOf(s) };
}

function handleBalance(sessionID: string): BalanceResponse {
  return { balance: balanceOf(getSession(sessionID)) };
}

// ---- Error helper ----

interface HttpError extends Error {
  status: number;
  code: string;
}
function httpError(status: number, code: string, message: string): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  e.code = code;
  return e;
}

// ---- Server ----

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/health') {
    return send(res, 200, { ok: true, gameID: GAME_ID, rtp: RTP_PERCENT / 100 });
  }

  // Bet replay (read-only): GET /bet/replay/{game}/{version}/{mode}/{event}.
  // Outcomes are procedural (no stored books), so replay generates a fresh book
  // for the requested mode — enough to exercise the read-only render path.
  if (req.method === 'GET' && url.startsWith('/bet/replay/')) {
    const parts = (url.split('?')[0] ?? '').split('/').filter(Boolean); // bet, replay, game, version, mode, event
    const modeName = parts[4] ?? 'base';
    if (!MODES.has(modeName)) return send(res, 404, { error: 'ERR_VAL', message: `unknown mode "${modeName}"` });
    const book = genBook('white');
    return send(res, 200, { payoutMultiplier: book.payoutMultiplier, costMultiplier: 1, state: book.events as unknown });
  }

  try {
    const body = req.method === 'POST' ? await readJson(req) : {};
    const sessionID = String(body.sessionID ?? 'dev');

    switch (url.split('?')[0]) {
      case '/wallet/authenticate':
        return send(res, 200, handleAuthenticate(sessionID));
      case '/wallet/play':
        return send(res, 200, handlePlay(sessionID, Number(body.amount), String(body.mode ?? 'base'), String(body.seed ?? 'white')));
      case '/wallet/end-round':
        return send(res, 200, handleEndRound(sessionID));
      case '/wallet/balance':
        return send(res, 200, handleBalance(sessionID));
      default:
        return send(res, 404, { error: 'ERR_VAL', message: `no route ${url}` });
    }
  } catch (err) {
    const e = err as Partial<HttpError>;
    return send(res, e.status ?? 500, { error: e.code ?? 'ERR_GEN', message: e.message ?? 'error' });
  }
});

server.listen(PORT, () => {
  console.log(`[rgs] ${GAME_ID} RGS emulator on http://localhost:${PORT}`);
  console.log(`[rgs] procedural dice cascade — modes: ${[...MODES].join(', ')}`);
  console.log(`[rgs] opening balance: ${OPENING_BALANCE / API_AMOUNT_MULTIPLIER} ${CURRENCY}`);
});
