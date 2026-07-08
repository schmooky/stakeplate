// The ENTIRE game. `createStakeGame` handles the RGS handshake, boot, HUD, currency,
// jurisdiction, replay, errors and the round loop. This game supplies only: a config, a
// pure interpretBook (RGS book → its model), a mountView (the pixi scene) and a Present
// phase (animate the round). Booted on the demo mock RGS — no backend.

import { createStakeGame, roundEvents, type Phase } from '@stakeplate/core';
import { MiniSlot } from './MiniSlot';
import { DemoNetwork } from './demoNetwork';

type Data = { grid: string[][]; win: boolean };

/** The game's Present phase — play the round back on the scene, then settle. */
const present: Phase<Data, MiniSlot> = {
  name: 'present',
  async enter(ctx) {
    const r = ctx.round;
    if (r) await ctx.view.play(r.data.grid, r.data.win);
    await ctx.fsm.transition('settle');
  },
};

const game = createStakeGame<Data, MiniSlot>({
  config: {
    title: 'Basic Slot',
    bets: [0.2, 0.5, 1, 2, 5, 10],
    defaultBet: 1,
    rtp: 96,
    confirmBuyAboveCost: 2,
  },
  // The one money seam: parse the book's grid; the win/multiplier are the engine's.
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0] as { grid?: string[][] } | undefined;
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host) => {
    const scene = new MiniSlot(host);
    (window as unknown as { __SCENE__: MiniSlot }).__SCENE__ = scene; // dev/harness handle
    return scene;
  },
  phases: [present],
  network: new DemoNetwork({ balance: 1000, currency: 'USD', modes: { base: 1 } }),
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
