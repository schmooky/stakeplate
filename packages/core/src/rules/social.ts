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
const RESTRICTED = SOCIAL_REPLACEMENTS.map(([term]) => term);

// CHECK matchers: word-boundary-anchored stems that ALSO catch common inflections — so a
// DERIVED form leaks through nothing (credit → credit/credits/credited/crediting; pay →
// pay/pays/paying/payer/payment). The trailing `\b` after the optional suffix keeps innocent
// words safe: "between"/"better" (contain "bet"), "cashew" ("cash"), "stakeholder" ("stake")
// and "display" ("play") never false-match — where a raw substring scan would flag them all.
// Multi-word phrases match verbatim (no suffix). A stem's own inflected entries (e.g. the
// explicit "paying"/"bets") still match too; this just widens coverage to unlisted forms.
const CHECK_MATCHERS = RESTRICTED.map((term) => {
  // Multi-word phrases match verbatim (word-boundary anchored).
  if (/\s/.test(term)) return new RegExp(`\\b${escapeRe(term)}\\b`, 'i');
  // A stem ending in `e` (purchase, gamble, stake) drops it before -ed/-ing: match the
  // e-less root plus the e-inflections (purchase/purchased/purchasing/gambler).
  if (term.endsWith('e')) {
    const root = escapeRe(term.slice(0, -1));
    return new RegExp(`\\b${root}(?:e|es|ed|ing|er|ers|ement|ements)?\\b`, 'i');
  }
  // Otherwise the stem plus common inflections (credit→credited, withdraw→withdrawn).
  return new RegExp(`\\b${escapeRe(term)}(?:s|es|ed|d|ing|er|ers|or|ors|able|ment|ments|al|als|n)?\\b`, 'i');
});

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
 * Find restricted gambling wording in an English string — including DERIVED forms (`credited`,
 * `payouts`, `paying`, `betting`) via word-boundary-anchored stems, but WITHOUT false-flagging
 * innocent words that merely contain a stem (`between`, `better`, `cashew`, `display`). Returns
 * the offending matches (as they appear). Use it at launch/build to fail on any social copy that
 * would still surface gambling wording — including a suffixed form the auto-rewrite missed.
 */
export function findRestricted(text: string): string[] {
  const hits: string[] = [];
  for (const re of CHECK_MATCHERS) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
