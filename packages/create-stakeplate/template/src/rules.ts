// The game's info menu, built with `@stakeplate/core/rules`. `buildRules` authors the
// mandatory compliance sections for you — the User Interaction Guide (a description of every
// control), the Game info grid (RTP / volatility / max win) and the canonical Stake
// disclaimer — plus their SOCIAL variants. Fill in your paytable, features and stats.

import { buildRules } from '@stakeplate/core/rules';
import type { BlockSpec } from '@open-slot-ui/core';

const paytable: BlockSpec[] = [
  { kind: 'paytable', id: 'pt', columns: 3, rows: [
    { symbol: '7️⃣', payouts: '3: 10×\n4: 25×\n5: 100×' },
    { symbol: '💎', payouts: '3: 5×\n4: 15×\n5: 50×' },
    { symbol: '🍒 / 🍋', payouts: '3: 1×\n4: 3×\n5: 10×' },
  ] },
];

const built = buildRules({
  intro: 'Match symbols on a line to win — **bigger symbols pay more**.',
  features: [{ title: 'Wild', text: 'Substitutes for every paying symbol.' }],
  howToWin: ['Set your bet with the − and + buttons.', 'Press **spin** to play a round.'],
  paytable,
  // These MUST match your certified math report.
  stats: { rtp: '96.00%', volatility: 'Medium', maxWin: '5,000×' },
});

export const rulesMenu = built.menu;

// Social wording: the core's disclaimer/guide overrides + this game's restricted strings →
// their social equivalents (crafted to pass the forbidden-phrase gate).
export const socialMessages: Record<string, Record<string, string>> = {
  en: {
    ...built.socialEn,
    'Match symbols on a line to win — **bigger symbols pay more**.': 'Match symbols on a line to win — **bigger symbols award more**.',
    'Substitutes for every paying symbol.': 'Substitutes for every symbol.',
    'Set your bet with the − and + buttons.': 'Set your play with the − and + buttons.',
  },
};
