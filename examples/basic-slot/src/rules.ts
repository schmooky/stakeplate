// The game's rules, built with `@stakeplate/core/rules`. `buildRules` authors the mandatory
// compliance copy — the User Interaction Guide (a description of every control), the Game info
// grid (RTP / max win) and the EXACT Stake disclaimer — plus the control-guide social variants.
// This game adds only its own About / paytable / features. The library's white HTML menu
// renders it, with its OWN built-in Settings (Sound · Language · Quick spin) — we invent none.

import { buildRules } from '@stakeplate/core/rules';
import type { BlockSpec } from '@open-slot-ui/core';

const paytable: BlockSpec[] = [
  { kind: 'paytable', id: 'pt', columns: 3, rows: [
    { symbol: '7️⃣', payouts: '3: 10.00x\n4: 25.00x\n5: 100.00x' },
    { symbol: '💎', payouts: '3: 5.00x\n4: 15.00x\n5: 50.00x' },
    { symbol: '⭐', payouts: '3: 4.00x\n4: 12.00x\n5: 40.00x' },
    { symbol: '🔔', payouts: '3: 3.00x\n4: 8.00x\n5: 25.00x' },
    { symbol: '🍒', payouts: '3: 1.50x\n4: 4.00x\n5: 10.00x' },
    { symbol: '🍋', payouts: '3: 1.00x\n4: 3.00x\n5: 8.00x' },
  ] },
];

const built = buildRules({
  about: '**Basic Slot** is a 3×3 slot. Match symbols on a line to win — bigger symbols pay more, and **Wild** substitutes for all.',
  howToPlay: ['Set your bet with the − and + buttons.', 'Press **spin** once, or **hold** for turbo.', 'Land 3 or more **Scatters** to start the bonus.'],
  features: [
    { title: 'Wild', text: 'Substitutes for every paying symbol.' },
    { title: 'Scatter', text: 'Pays from anywhere on the reels.' },
    { title: 'Multiplier', text: 'Boosts wins during the bonus.' },
  ],
  paytable,
  stats: { rtp: '96.00%', volatility: 'Medium', maxWin: '5,000×', lines: '5' },
});

export const rulesMenu = built.menu;

// Social wording: the core's control-guide overrides + this game's own restricted strings.
export const socialMessages: Record<string, Record<string, string>> = {
  en: {
    ...built.socialEn,
    '**Basic Slot** is a 3×3 slot. Match symbols on a line to win — bigger symbols pay more, and **Wild** substitutes for all.':
      '**Basic Slot** is a 3×3 slot. Match symbols on a line to win — bigger symbols award more, and **Wild** substitutes for all.',
    'Substitutes for every paying symbol.': 'Substitutes for every symbol.',
    'Pays from anywhere on the reels.': 'Awards from anywhere on the reels.',
    'Set your bet with the − and + buttons.': 'Set your play with the − and + buttons.',
  },
};
