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
    const win = Math.random() < 0.42;
    const multiplier = win ? +(0.5 + Math.random() * 8).toFixed(2) : 0; // 0.5×..8.5×
    this.forceRound({ payoutMultiplier: Math.round(multiplier * 100), events: [{ grid: randomGrid() }] });
    return super.play(args);
  }
}
