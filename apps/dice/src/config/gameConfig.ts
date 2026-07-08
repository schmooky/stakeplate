// Client game config — display shape and bet defaults.
//
// No paytable here — combo evaluation is server-owned. The client only knows
// how many dice to render and the bet defaults (UI display only).

export const GAME = {
  /** Display name shown in the menu / header. */
  title: 'Dice Cascade',
  /** Default seed color for the first die. */
  defaultSeed: 'white',
  defaultBet: 1,
  startingBalance: 1000,
} as const;
