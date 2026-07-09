// A tiny "RGS" for LOCAL DEV: extends the core's authoritative MockNetworkManager and scripts
// a random win (with a symbol grid in the book event) on every play.
//
// In production DELETE this file and remove `network:` from createStakeGame — the core then
// connects to the real Stake RGS from the `rgs_url` launch param automatically.

import { MockNetworkManager } from '@stakeplate/core';
import type { PlayArgs, PlayResponse } from '@stakeplate/core';

const SYMBOLS = ['🍒', '🍋', '⭐', '💎', '🔔', '7️⃣'];
const randomGrid = (): string[][] =>
  Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]!));

export class DemoNetwork extends MockNetworkManager {
  override async play(args: PlayArgs): Promise<PlayResponse> {
    const win = Math.random() < 0.42;
    const multiplier = win ? +(0.5 + Math.random() * 8).toFixed(2) : 0; // 0.5×..8.5×
    this.forceRound({ payoutMultiplier: Math.round(multiplier * 100), events: [{ grid: randomGrid() }] });
    return super.play(args);
  }
}
