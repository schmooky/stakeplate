// The canonical Stake SOCIAL/sweepstakes wording dictionary. In social mode, restricted
// gambling phrases must be swapped for the alternatives below. `toSocial` auto-rewrites an
// English string (word-safe, longest-phrase-first, case-preserving) so a game rarely
// hand-authors social copy; `findRestricted` AGGRESSIVELY scans for restricted terms — even
// as PART of a word (paytable, betting…) — for the launch/build compliance gate.

/** Restricted → replacement, ORDERED longest-phrase-first (so multi-word phrases win). */
export const SOCIAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["be awarded to player's accounts", "appear in player's accounts"],
  ['place your bets', 'come and play / join in the game'],
  ['at the cost of', 'for'],
  ['bonus buy', 'bonus / feature'],
  ['buy bonus', 'get bonus'],
  ['win feature', 'play feature'],
  ['total bet', 'total play'],
  ['pays out', 'won'],
  ['paid out', 'win'],
  ['pay out', 'win'],
  ['cost of', 'can be played for'],
  ['paytable', 'prize table'],
  ['payouts', 'wins'],
  ['payout', 'win'],
  ['betting', 'playing'],
  ['gambling', 'playing'],
  ['wagering', 'playing'],
  ['paying', 'awarding'],
  ['buying', 'playing'],
  ['buys', 'plays'],
  ['deposit', 'get coins'],
  ['withdraw', 'redeem'],
  ['purchase', 'play'],
  ['currency', 'token'],
  ['credits', 'coins'],
  ['credit', 'coins'],
  ['winnings', 'prizes'],
  ['payer', 'winner'],
  ['bought', 'instantly triggered'],
  ['gamble', 'play'],
  ['wager', 'play'],
  ['rebet', 'respin'],
  ['stakes', 'play amounts'],
  ['stake', 'play amount'],
  ['money', 'coins'],
  ['cash', 'coins'],
  ['bets', 'plays'],
  ['bet', 'play'],
  ['pays', 'wins'],
  ['paid', 'won'],
  ['pay', 'win'],
  ['buy', 'play'],
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matchCase = (matched: string, repl: string): string =>
  matched[0] && matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()
    ? repl.charAt(0).toUpperCase() + repl.slice(1)
    : repl;

// Word-boundary regexes (so "bet"→"play" never breaks "better"/"internet"). Built once.
const REPLACERS = SOCIAL_REPLACEMENTS.map(([term, repl]) => [new RegExp(`\\b${escapeRe(term)}\\b`, 'gi'), repl] as const);
// Aggressive substring matchers for the CHECK (catch "pay" inside "paytable", etc.).
const RESTRICTED = SOCIAL_REPLACEMENTS.map(([term]) => term);

/**
 * Rewrite an English string into its social/sweepstakes wording — restricted phrases swapped
 * for their alternatives (word-boundary safe, longest-phrase-first, case-preserving). Idempotent
 * enough for authoring: run it over your menu/feature copy to auto-generate social variants.
 */
export function toSocial(text: string): string {
  let out = text;
  for (const [re, repl] of REPLACERS) out = out.replace(re, (m) => matchCase(m, repl));
  return out;
}

/**
 * AGGRESSIVELY find restricted phrases in an English string — matches even as part of a word
 * (so `paytable`, `betting`, `payout` are all flagged). Returns the offending terms. Use it at
 * launch/build to fail on any social-copy that would still surface gambling wording.
 */
export function findRestricted(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const term of RESTRICTED) if (lower.includes(term)) hits.push(term);
  return hits;
}
