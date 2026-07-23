// A tiny "RGS" for LOCAL DEV: extends the core's authoritative MockNetworkManager and scripts
// a random win (with a symbol grid in the book event) on every play.
//
// main.ts uses this ONLY for bare `npm run dev` (no backend). A real Stake launch (a real
// `rgs_url`, incl. `demo=true` fun-play) auto-connects to the real RGS — no code change. You
// may delete this file + the `demoNetwork` block in main.ts for a real-RGS-only build.

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
