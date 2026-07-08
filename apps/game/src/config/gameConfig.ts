// Client game config — view shape and bet defaults.
//
// There is NO paytable and NO paylines here. That is server-owned math.
// The client only knows:
//   - how many reels/rows to render
//   - what symbol ids can appear (for the asset factory)
//   - what the starting balance / default bet are (UI display only; the
//     server is authoritative on balance)

export const GAME = {
  /** Display name shown in the header. */
  title: 'Vortex Digits',
  columns: 3,
  rows: 3,
  defaultBet: 1,
  startingBalance: 1000,

  /**
   * Vortex ante multiplier: the paid "lucky bet" stakes this × the bet and
   * guarantees a Vortex (a full random row of digits) every spin.
   */
  vortexAnte: 1.5,

  /**
   * Symbol ids the server may send (DOT = blank, D0..D9 = digits). A win is a
   * run of consecutive digits forming a number; the Vortex fills a row to make
   * one near-certain. The StakeNetworkManager maps the reveal board verbatim.
   */
  symbolIds: ['DOT', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'] as const,
} as const;

export type SymbolId = (typeof GAME.symbolIds)[number];
