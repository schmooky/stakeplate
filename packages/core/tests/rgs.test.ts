import { afterEach, describe, expect, it, vi } from 'vitest';
import { StakeNetworkManager } from '../src/rgs/StakeNetworkManager';
import { MockNetworkManager } from '../src/rgs/MockNetworkManager';
import { createNetwork } from '../src/rgs/network';
import { isStakeLaunch, readRuntime } from '../src/rgs/runtime';
import { API_AMOUNT_MULTIPLIER, roundEvents } from '../src/rgs/protocol';

type Captured = { url: string; method: string; body: unknown };

/** Stub `fetch`, capturing each call and replying with `reply(path)`. */
function stubFetch(reply: (path: string) => unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = new URL(url).pathname;
    return { ok: true, status: 200, json: async () => reply(path), text: async () => '' } as Response;
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('StakeNetworkManager — the real Stake wire (incl. the language 400 fix)', () => {
  const balance = { amount: 1000 * API_AMOUNT_MULTIPLIER, currency: 'CAD' };
  const config = { minBet: 1, maxBet: 1, stepBet: 1, betLevels: [1], defaultBetLevel: 1 };

  it('authenticate sends { sessionID, language } (missing language 400s the RGS)', async () => {
    const calls = stubFetch(() => ({ balance, config, round: null }));
    const net = new StakeNetworkManager({ rgsUrl: 'https://rgs.test', sessionId: 'S1', language: 'ru' });
    await net.authenticate();
    expect(calls[0]!.url).toContain('/wallet/authenticate');
    expect(calls[0]!.body).toEqual({ sessionID: 'S1', language: 'ru' });
  });

  it('play sends { sessionID, currency, amount(API units), mode }', async () => {
    const calls = stubFetch((p) =>
      p.endsWith('authenticate') ? { balance, config, round: null } : { round: { payoutMultiplier: 0 }, balance },
    );
    const net = new StakeNetworkManager({ rgsUrl: 'https://rgs.test', sessionId: 'S1', language: 'en' });
    await net.authenticate(); // learns CAD
    await net.play({ bet: 2.5, mode: 'base' });
    expect(calls[1]!.url).toContain('/wallet/play');
    expect(calls[1]!.body).toEqual({ sessionID: 'S1', currency: 'CAD', amount: 2_500_000, mode: 'base' });
  });

  it('replay GETs /bet/replay/{game}/{version}/{mode}/{event}', async () => {
    const calls = stubFetch(() => ({ round: { payoutMultiplier: 500, state: [] } }));
    const net = new StakeNetworkManager({ rgsUrl: 'https://rgs.test', sessionId: 'S1', language: 'en' });
    const round = await net.replay({ game: 'g', version: '1', mode: 'base', event: '7', amount: 1 });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/bet/replay/g/1/base/7');
    expect(round.payoutMultiplier).toBe(500);
  });
});

describe('MockNetworkManager — authoritative + scriptable', () => {
  it('deducts the stake and credits a forced win', async () => {
    const mock = new MockNetworkManager({ balance: 100, currency: 'USD' });
    mock.forceRound({ win: 20 }); // bet 1 → 20× → +20
    const { round, balance } = await mock.play({ bet: 1, mode: 'base' });
    expect(round.payoutMultiplier).toBe(2000); // 20× in BOOK units
    expect(balance.amount).toBe(119 * API_AMOUNT_MULTIPLIER); // 100 − 1 + 20
  });

  it('surfaces an active round at authenticate (for resume) and settles on end-round', async () => {
    const active = { betID: 'r1', mode: 'base', amount: 1_000_000, payoutMultiplier: 300, state: [{ type: 'x' }], active: true };
    const mock = new MockNetworkManager({ balance: 50, activeRound: active });
    const auth = await mock.authenticate();
    expect(auth.round).toBe(active);
    expect(roundEvents(auth.round!)).toHaveLength(1);
    await mock.endRound();
  });
});

describe('createNetwork + readRuntime', () => {
  it('readRuntime parses the Stake launch params (br → pt, replay set)', () => {
    const param = (n: string): string | undefined =>
      ({ lang: 'br', rgs_url: 'https://x', sessionID: 'S', currency: 'JPY', social: 'true', replay: 'true', amount: '3', game: 'g', version: '2', mode: 'bonus', event: '9' } as Record<string, string>)[n];
    const r = readRuntime({ param });
    expect(r.language).toBe('pt');
    expect(r.currency).toBe('JPY');
    expect(r.social).toBe(true);
    expect(r.replay).toEqual({ active: true, amount: 3, game: 'g', version: '2', mode: 'bonus', event: '9' });
  });

  /** Read a launch runtime from a query string, exactly as the browser would. */
  const fromUrl = (search: string) => {
    const q = new URLSearchParams(search);
    return readRuntime({ param: (n) => q.get(n) ?? undefined });
  };

  // The user's exact Stake "local redirect" launch URL: a real host + session + `demo=true`.
  const STAKE_LOCAL_REDIRECT =
    'sessionID=SID-abc==&rgs_url=rgsd.stake-engine.com&lang=en&currency=USD&device=desktop&social=false&demo=true';

  it('a Stake fun-play launch (real rgs_url + demo=true) uses the REAL transport, not the mock', () => {
    const runtime = fromUrl(STAKE_LOCAL_REDIRECT);
    expect(runtime.demo).toBe(true); // fun-play flag is preserved…
    expect(runtime.rgsUrlProvided).toBe(true);
    expect(isStakeLaunch(runtime)).toBe(true);
    expect(createNetwork(runtime)).toBeInstanceOf(StakeNetworkManager); // …but it talks to the RGS
  });

  it('that real transport authenticates against the launch host with the session', async () => {
    const calls = stubFetch(() => ({ balance: { amount: 0, currency: 'USD' }, config: { minBet: 1, maxBet: 1, stepBet: 1, betLevels: [1], defaultBetLevel: 1 }, round: null }));
    const net = createNetwork(fromUrl(STAKE_LOCAL_REDIRECT));
    await net.authenticate();
    expect(calls[0]!.url).toBe('https://rgsd.stake-engine.com/wallet/authenticate');
    expect(calls[0]!.body).toEqual({ sessionID: 'SID-abc==', language: 'en' });
  });

  it('a real rgs_url without demo also uses the real transport', () => {
    expect(createNetwork(fromUrl('rgs_url=https://rgs.test&sessionID=S'))).toBeInstanceOf(StakeNetworkManager);
  });

  it('demo=true with NO host falls back to the in-process mock (bare local click-around)', () => {
    const runtime = fromUrl('demo=true');
    expect(runtime.rgsUrlProvided).toBe(false);
    expect(isStakeLaunch(runtime)).toBe(false);
    expect(createNetwork(runtime)).toBeInstanceOf(MockNetworkManager);
  });

  it('?mock=true forces the mock even with a real rgs_url', () => {
    const runtime = fromUrl('rgs_url=rgsd.stake-engine.com&sessionID=S&mock=true');
    expect(isStakeLaunch(runtime)).toBe(false); // mock override → not a "stake launch"
    expect(createNetwork(runtime)).toBeInstanceOf(MockNetworkManager);
  });

  it('a supplied mock instance always wins', () => {
    const mock = new MockNetworkManager({ balance: 10 });
    expect(createNetwork(fromUrl(STAKE_LOCAL_REDIRECT), mock)).toBe(mock);
  });

  it('createNetwork picks the mock when demo (overrides, no host)', () => {
    const runtime = readRuntime({ param: () => undefined, overrides: { demo: true } });
    expect(createNetwork(runtime)).toBeInstanceOf(MockNetworkManager);
  });
});
