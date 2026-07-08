// The ENTIRE game. `createStakeGame` handles the RGS handshake, boot, HUD, currency,
// jurisdiction, replay, errors and the round loop. This game supplies only: a config, a
// pure interpretBook (RGS book → its model), a mountView (the pixi scene) and a Present
// phase (animate the round). Booted on the demo mock RGS — no backend.

import { createStakeGame, roundEvents, type Phase } from '@stakeplate/core';
import { MiniSlot } from './MiniSlot';
import { DemoNetwork } from './demoNetwork';

/** This game's book-event type — declared once, so `interpretBook`'s `raw` is TYPED. */
type Ev = { grid: string[][] };
type Data = { grid: string[][]; win: boolean };

/** The game's Present phase — play the round back on the scene, then settle. */
const present: Phase<Data, MiniSlot, Ev> = {
  name: 'present',
  async enter(ctx) {
    const r = ctx.round;
    if (r) await ctx.view.play(r.data.grid, r.data.win);
    await ctx.fsm.transition('settle');
  },
};

const game = createStakeGame<Data, MiniSlot, Ev>({
  // The bet ladder, default bet and buy-confirm policy come from the RGS/jurisdiction (here
  // the mock's `authenticate`), NOT from game config. `rtp` is display-only fallback.
  config: {
    title: 'Basic Slot',
    rtp: 96,
  },
  // The one money seam: parse the book's grid. `raw` is `Round<Ev>` → `roundEvents(raw)` is
  // `Ev[]`, no cast. The win/multiplier are the engine's (server-authoritative).
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0];
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host) => {
    const scene = new MiniSlot(host);
    (window as unknown as { __SCENE__: MiniSlot }).__SCENE__ = scene; // dev/harness handle
    return scene;
  },
  phases: [present],
  // The mock RGS owns the ladder (like a real `authenticate` would), per currency.
  network: new DemoNetwork({ balance: 1000, currency: 'USD', betLevels: [0.2, 0.5, 1, 2, 5, 10], defaultBet: 1, rtp: 96, modes: { base: 1 } }),
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

// Dev affordance: expose the game so the preview / harness can drive spins and read state
// via `game.requestSpin()` + `game.inspect()` (no screenshots, no pixi event synthesis).
(window as unknown as { __GAME__: typeof game }).__GAME__ = game;

game
  .start()
  .then(() => document.getElementById('boot')?.setAttribute('data-done', '1'))
  .catch((err) => {
    console.error('[basic-slot] boot failed', err);
    document.getElementById('boot')?.setAttribute('data-done', '1');
  });
