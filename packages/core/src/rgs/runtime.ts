/**
 * Stake launch parameters (mirrors `StakeEngine/web-sdk`
 * `packages/state-shared/src/stateUrl`): sessionID, rgs_url, lang, currency, device,
 * social, demo — plus the REPLAY set: replay, amount, game, version, mode, event.
 * `lang` is REQUIRED by `/wallet/authenticate` (its absence 400s the RGS).
 */

export interface ReplayLaunch {
  /** `?replay=true` — launch into replay (fetch + play back a recorded round). */
  active: boolean;
  amount: number;
  game: string;
  version: string;
  mode: string;
  event: string;
}

export interface RuntimeConfig {
  rgsUrl: string;
  /**
   * True when a real `rgs_url`/`rgsUrl` launch param was present (vs falling back to the
   * local default). A provided host means "talk to it" — this is what tells the transport
   * picker to use the REAL Stake RGS, even for a `demo` fun-play launch. Set it in
   * `overrides` to force the real transport when you supply `rgsUrl` programmatically.
   */
  rgsUrlProvided: boolean;
  sessionId: string;
  /** BCP-47-ish language for `/wallet/authenticate` + the HUD locale ('br' → 'pt'). */
  language: string;
  /** `?currency=` — currency code (used for replay, where there's no wallet to read it). */
  currency: string;
  /** `?social=true` — force Stake US social/sweepstakes wording. */
  social: boolean;
  /** `?device=` — Stake's viewport hint ('' | 'desktop' | 'mobile' | a small popout). */
  device: string;
  /**
   * `?demo=true` — Stake FUN-PLAY: a demo (non-cash) wallet on the REAL RGS. This is NOT a
   * "use a fake backend" switch — Stake's own local-redirect dev tool launches
   * `…?rgs_url=rgsd.stake-engine.com&sessionID=…&demo=true`, and that session still
   * authenticates + plays against the real RGS. To run the in-process mock, use `?mock=true`.
   */
  demo: boolean;
  /**
   * `?mock=true` — force the built-in in-process mock RGS (no backend). For pure client dev
   * without a real session; distinct from Stake's `demo` fun-play. Overrides `rgs_url`.
   */
  mock: boolean;
  replay: ReplayLaunch;
}

type ParamSource = (name: string) => string | undefined;

/** Read a URL param from `window.location.search` (undefined off-DOM). */
export function urlParam(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

/**
 * Parse the Stake launch params into a {@link RuntimeConfig}. Pass `overrides` (or a
 * custom `param` reader) for tests/embedding; otherwise reads the page URL. `rgsUrl`
 * defaults to a local emulator so `pnpm dev` works out of the box.
 */
export function readRuntime(opts: { param?: ParamSource; overrides?: Partial<RuntimeConfig>; defaultRgsUrl?: string } = {}): RuntimeConfig {
  const param = opts.param ?? urlParam;
  const rawLang = param('lang');
  const language = rawLang === 'br' ? 'pt' : rawLang || 'en';
  const rgsUrlParam = param('rgs_url') ?? param('rgsUrl');
  const base: RuntimeConfig = {
    rgsUrl: rgsUrlParam ?? opts.defaultRgsUrl ?? 'http://localhost:4758',
    rgsUrlProvided: rgsUrlParam != null,
    sessionId: param('sessionID') ?? param('sessionId') ?? 'dev',
    language,
    currency: param('currency') ?? 'USD',
    social: param('social') === 'true',
    device: param('device') ?? '',
    demo: param('demo') === 'true',
    mock: param('mock') === 'true',
    replay: {
      active: param('replay') === 'true',
      amount: Number(param('amount')) || 0,
      game: param('game') ?? '',
      version: param('version') ?? '',
      mode: param('mode') ?? '',
      event: param('event') ?? '',
    },
  };
  return { ...base, ...opts.overrides, replay: { ...base.replay, ...opts.overrides?.replay } };
}

/**
 * True when the game was launched by the Stake platform — i.e. a real `rgs_url` was provided
 * (the dev dashboard's "local redirect", or a live launch) and the in-process mock wasn't
 * forced with `?mock=true`. This holds for `demo=true` fun-play launches too: they still run
 * against the real RGS.
 *
 * A game gates its local dev mock on `!isStakeLaunch()` — so bare `pnpm dev` uses the mock,
 * while a Stake launch auto-connects to the real RGS with the launch `sessionID`, no code edit.
 */
export function isStakeLaunch(runtime: RuntimeConfig = readRuntime()): boolean {
  return runtime.rgsUrlProvided && !runtime.mock;
}
