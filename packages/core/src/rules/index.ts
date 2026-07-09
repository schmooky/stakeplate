// @stakeplate/core/rules — `buildRules` assembles a Stake-COMPLIANT rules section (an
// @open-slot-ui `MenuSpec`) so every game ships the mandatory copy without re-authoring it:
// a **User Interaction Guide** (a description of every standard control), the **Game info**
// grid (RTP / volatility / max win) and the **EXACT Stake Engine disclaimer** — authored ONCE
// here. The game supplies only its own about/paytable/features. The library's white HTML menu
// (open-slot-ui) renders it; the built-in Settings (Sound · Language · Quick spin) are the
// menu's own — a game NEVER invents settings.
//
// Social wording: `buildRules` returns `socialEn` — { normal → social } for the strings it
// authored that carry restricted terms (bet/pay…). Merge into `config.socialMessages.en`. The
// disclaimer is legal-exact — mandated verbatim on every platform, so it is NEVER swapped.

import type { BlockSpec, MenuSpec } from '@open-slot-ui/core';

/** RTP / volatility / max-win etc. — shown as a stat grid. Values are display strings. */
export interface RulesStats {
  rtp?: string; // "96.00%"
  volatility?: string; // "High"
  maxWin?: string; // "5,000×"
  lines?: string; // "5"
  /** Any extra label → value rows (e.g. per-mode RTP/Max win). */
  extra?: Array<{ label: string; value: string }>;
}

export interface BuildRulesOptions {
  /** How Settings exposes sound: a `'toggle'` only · `'master'` slider · `'sliders'`
   *  (Music + Effects). Default `'sliders'`. */
  sound?: 'toggle' | 'master' | 'sliders';
  /** An "About the game" intro paragraph. */
  about?: string;
  /** "How to play" steps. */
  howToPlay?: string[];
  /** Feature cards (Wild / Scatter / Bonus …). */
  features?: Array<{ icon?: string; title: string; text?: string }>;
  /** The game's paytable blocks (usually one `{ kind: 'paytable' }`). */
  paytable?: BlockSpec[];
  /** RTP / volatility / max-win — the Game info grid. Must match the certified report. */
  stats?: RulesStats;
  /** Extra rules blocks appended before the disclaimer. */
  extra?: BlockSpec[];
  /** Override the built-in per-control guide lines (each: `**Name** — what it does.`). */
  controlGuide?: string[];
  /** Include the Stake disclaimer (default `true`). */
  disclaimer?: boolean;
}

export interface BuiltRules {
  menu: MenuSpec;
  /** { normal → social } for the strings buildRules authored — merge into `config.socialMessages.en`. */
  socialEn: Record<string, string>;
}

// ── Canonical, core-authored copy ───────────────────────────────────────────────────

/** Every interactive control described (Stake: the Info/Help must explain each button). */
export const DEFAULT_CONTROL_GUIDE: string[] = [
  '**Spin** — plays one round at your current bet; press and hold to spin in turbo.',
  '**＋ / −** — raise or lower your bet before spinning.',
  '**Autoplay** — plays a set number of rounds automatically; tap again to stop any time.',
  '**Turbo / Quick spin** — speeds up spins by shortening the animation; the result is identical.',
  '**Buy Feature** — instantly buys entry to the bonus for the shown price (needs confirmation).',
  '**Menu** — opens settings, the paytable and these rules.',
  '**Sound** — mutes or unmutes all game audio.',
];

/** The EXACT Stake Engine disclaimer — never reworded, never given a social override. */
export const STAKE_DISCLAIMER =
  'Malfunction voids all wins and plays. A consistent internet connection is required. In the event of a disconnection, reload the game to finish any uncompleted rounds. The expected return is calculated over many plays. The game display is not representative of any physical device and is for illustrative purposes only. Winnings are settled according to the amount received from the Remote Game Server and not from events within the web browser.';

/** { normal → social } overrides for the CONTROL GUIDE lines (the disclaimer is exact — none). */
const CORE_SOCIAL: Record<string, string> = {
  '**Spin** — plays one round at your current bet; press and hold to spin in turbo.':
    '**Spin** — plays one round at your current play; press and hold to spin in turbo.',
  '**＋ / −** — raise or lower your bet before spinning.': '**＋ / −** — raise or lower your play before spinning.',
  '**Menu** — opens settings, the paytable and these rules.': '**Menu** — opens settings, the prize table and these rules.',
  Paytable: 'Prizes',
  RTP: 'RTP',
  'Max win': 'Max prize',
};

// ── The builder ────────────────────────────────────────────────────────────────────

export function buildRules(opts: BuildRulesOptions = {}): BuiltRules {
  const rules: BlockSpec[] = [];

  if (opts.about) {
    rules.push({ kind: 'heading', id: 'r-about-h', text: 'About the game' });
    rules.push({ kind: 'text', id: 'r-about', text: opts.about });
  }

  if (opts.howToPlay?.length) {
    rules.push({ kind: 'heading', id: 'r-play-h', text: 'How to play' });
    rules.push({ kind: 'steps', id: 'r-play', ordered: true, items: opts.howToPlay });
  }

  if (opts.features?.length) {
    rules.push({ kind: 'heading', id: 'r-feat-h', text: 'Features' });
    rules.push({ kind: 'cards', id: 'r-feat', items: opts.features });
  }

  // ── User Interaction Guide (Stake compliance: a description for EVERY control) ──
  rules.push({ kind: 'heading', id: 'r-ctrl-h', text: 'Controls' });
  rules.push({ kind: 'text', id: 'r-ctrl-0', text: 'Every interactive button and what it does:' });
  rules.push({ kind: 'steps', id: 'r-ctrl', ordered: false, items: opts.controlGuide ?? DEFAULT_CONTROL_GUIDE });

  // ── Game info (RTP / volatility / max win — must match the certified report) ──
  const stats = opts.stats;
  if (stats) {
    const items: Array<{ label: string; value: string }> = [];
    if (stats.rtp) items.push({ label: 'RTP', value: stats.rtp });
    if (stats.volatility) items.push({ label: 'Volatility', value: stats.volatility });
    if (stats.maxWin) items.push({ label: 'Max win', value: stats.maxWin });
    if (stats.lines) items.push({ label: 'Lines', value: stats.lines });
    if (stats.extra) items.push(...stats.extra);
    if (items.length) {
      rules.push({ kind: 'heading', id: 'r-info-h', text: 'Game info' });
      rules.push({ kind: 'stat-grid', id: 'r-info', items });
    }
  }

  if (opts.extra?.length) rules.push(...opts.extra);

  // ── The exact Stake disclaimer ──
  if (opts.disclaimer !== false) {
    rules.push({ kind: 'heading', id: 'r-general-h', text: 'General' });
    rules.push({ kind: 'text', id: 'r-general', text: STAKE_DISCLAIMER });
  }

  const menu: MenuSpec = {
    ...(opts.sound ? { sound: opts.sound } : {}),
    ...(opts.paytable ? { paytable: opts.paytable } : {}),
    rules,
  };
  return { menu, socialEn: { ...CORE_SOCIAL } };
}
