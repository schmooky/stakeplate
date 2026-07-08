// Replay mode — Stake Engine "bet replay" is a mandatory approval requirement
// (docs/STAKE-APPROVAL-CHECKLIST.md §E). When the game is launched with
// `?replay=true&game=…&version=…&mode=…&event=…&rgs_url=…` it must, with NO
// authenticated session, fetch the historical round and deterministically
// re-render it from its events — then offer "Play again", never transitioning
// into live play.
//
// This module just parses + validates the launch params. The read-only
// transport lives in ReplayNetworkManager; the boot wiring is in composition.

export interface ReplayParams {
  game: string;
  version: string;
  mode: string;
  event: string;
  /** RGS base URL to fetch the replay book from. */
  rgsUrl: string;
  /** Display currency (no wallet is touched in replay). */
  currency: string;
  /** The staked amount to scale the book's multipliers by, in major units. */
  amount: number;
  lang?: string;
}

/**
 * Parse replay launch params from a query string. Returns null when not a
 * replay launch, or when a required param is missing (so the caller falls back
 * to normal boot rather than rendering a broken replay).
 *
 * @param search defaults to the current location's query string.
 */
export function getReplayParams(search?: string): ReplayParams | null {
  const raw = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const p = new URLSearchParams(raw);

  const replay = p.get('replay');
  if (replay !== 'true' && replay !== '1') return null;

  const game = p.get('game');
  const version = p.get('version');
  const mode = p.get('mode');
  const event = p.get('event');
  const rgsUrl = p.get('rgs_url') ?? p.get('rgsUrl');
  if (!game || !version || !mode || !event || !rgsUrl) return null;

  const amount = Number(p.get('amount'));
  const lang = p.get('lang') ?? p.get('language');

  return {
    game,
    version,
    mode,
    event,
    rgsUrl,
    currency: p.get('currency') ?? 'USD',
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
    ...(lang ? { lang } : {}),
  };
}
