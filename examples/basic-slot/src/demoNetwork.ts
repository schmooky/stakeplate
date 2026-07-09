// A tiny "RGS" for the demo: extends the core's authoritative MockNetworkManager and
// scripts a random win (with a symbol grid in the book event) on every play. A real game
// deletes this and lets `createStakeGame` talk to the actual Stake RGS.

import { MockNetworkManager } from '@stakeplate/core';
import type { PlayArgs, PlayResponse } from '@stakeplate/core';

const SYMBOLS = ['🍒', '🍋', '⭐', '💎', '🔔', '7️⃣'];
const randomGrid = (): string[][] =>
  Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!));

export class DemoNetwork extends MockNetworkManager {
  async play(args: PlayArgs): Promise<PlayResponse> {
    const bought = args.mode === 'bonus' || args.mode === 'super'; // one-shot bought bonuses → big win
    const ante = args.mode === 'lucky'; // the activated ante → a normal spin, just win more often
    const win = bought || Math.random() < (ante ? 0.55 : 0.42);
    const multiplier = bought ? +(30 + Math.random() * 170).toFixed(2) : win ? +(0.5 + Math.random() * 8).toFixed(2) : 0;
    this.forceRound({ payoutMultiplier: Math.round(multiplier * 100), events: [{ grid: randomGrid() }] });
    return super.play(args);
  }
}
