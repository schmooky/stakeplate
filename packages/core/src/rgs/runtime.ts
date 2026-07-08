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
  sessionId: string;
  /** BCP-47-ish language for `/wallet/authenticate` + the HUD locale ('br' → 'pt'). */
  language: string;
  /** `?currency=` — currency code (used for replay, where there's no wallet to read it). */
  currency: string;
  /** `?social=true` — force Stake US social/sweepstakes wording. */
  social: boolean;
  /** `?device=` — Stake's viewport hint ('' | 'desktop' | 'mobile' | a small popout). */
  device: string;
  /** `?demo=true` — run against the built-in mock RGS, no real backend. */
  demo: boolean;
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
  const base: RuntimeConfig = {
    rgsUrl: param('rgs_url') ?? param('rgsUrl') ?? opts.defaultRgsUrl ?? 'http://localhost:4758',
    sessionId: param('sessionID') ?? param('sessionId') ?? 'dev',
    language,
    currency: param('currency') ?? 'USD',
    social: param('social') === 'true',
    device: param('device') ?? '',
    demo: param('demo') === 'true',
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
