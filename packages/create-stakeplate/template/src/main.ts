// The ENTIRE game. `createStakeGame` runs the compliant boot (RGS handshake, HUD, currency,
// jurisdiction, replay, active-round resume, errors) and the round loop. You supply only:
// a config, a pure interpretBook (RGS book → your model), a mountView (your pixi scene) and
// a Present phase (animate the round). See https://github.com/schmooky/stakeplate.

import { createStakeGame, isStakeLaunch, roundEvents, type Phase } from '@stakeplate/core';
import { createGameAudio } from '@stakeplate/core/audio';
import { Scene } from './Scene';
import { DemoNetwork } from './demoNetwork';
import { rulesMenu, socialMessages } from './rules';

/** Your book-event type — declared once, so `interpretBook`'s `raw` is TYPED (not `unknown`). */
type Ev = { grid: string[][] };
/** Your round model — whatever your scene needs to animate a round. */
type Data = { grid: string[][]; win: boolean };

// The mixer: nine buses in two groups (music / effects). The core binds the HUD's Music/Effects
// sliders + mute to the groups and unlocks audio on the first spin. Add your sounds like this:
//
//   import winUrl from './assets/win.mp3';
//   import bgmUrl from './assets/bgm.mp3';
//   audio.load([
//     { name: 'win',  url: winUrl, bus: 'wins' },
//     { name: 'base', kind: 'music', loop: bgmUrl, loopCrossfadeMs: 400 }, // seamless loop
//   ]);
//   // …then from a phase: ctx.audio?.play('win', { bus: 'wins' }) / ctx.audio?.music('base').
const audio = createGameAudio();

/** Your Present phase — play the round back on the scene, then hand off to Settle. */
const present: Phase<Data, Scene, Ev> = {
  name: 'present',
  async enter(ctx) {
    // ctx.turbo.delay drives the spin duration → turbo speed + slam-stop for free.
    if (ctx.round) await ctx.view.play(ctx.round.data.grid, ctx.round.data.win, (ms) => ctx.turbo.delay(ms));
    await ctx.fsm.transition('settle');
  },
};

// NETWORK. When the Stake platform launches your game it opens it with a real `rgs_url` (the
// dev dashboard's "local redirect" does this too — the URL looks like
//   http://localhost:5173/?sessionID=…&rgs_url=rgsd.stake-engine.com&lang=en&currency=USD&demo=true
// ) and the core connects to the REAL Stake RGS: it authenticates with the launch `sessionID`,
// pulls the real balance/config/bet-ladder, and spins + buys features with real requests. Note
// `demo=true` is Stake FUN-PLAY (a demo wallet on the real RGS), NOT a signal to fake the backend.
// Bare `pnpm dev` (no launch params) has no backend, so we fall back to the scripted mock below
// to let you click around. Delete this line + demoNetwork.ts for a real-RGS-only build.
const demoNetwork = isStakeLaunch()
  ? undefined
  : new DemoNetwork({ balance: 1000, currency: 'USD', betLevels: [0.2, 0.5, 1, 2, 5, 10], defaultBet: 1, modes: { base: 1 } });

const game = createStakeGame<Data, Scene, Ev>({
  // The bet ladder, default bet and buy-confirm come from the RGS/jurisdiction, NOT here.
  config: { title: '{{name}}', rtp: 96, rules: rulesMenu, socialMessages },
  // The core's configurable boot loader (spinner + progress → reveals the game). Add a
  // `logo`, `backgroundImage`, or `features: [{ image, text }]` to make it a full intro.
  // Pair with the `@stakeplate/core/vite` plugin (see vite.config.ts) for zero black flash.
  loader: { title: '{{name}}', subtitle: 'Loading…' },
  // The ONE money seam: parse the book's events into your model. Pure. The win/multiplier
  // are the engine's (server-authoritative) — never compute payouts on the client.
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0];
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host) => new Scene(host),
  phases: [present],
  audio,
  // undefined on a real Stake launch (see above) → the core uses the real RGS from `rgs_url`.
  ...(demoNetwork ? { network: demoNetwork } : {}),
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

void game.start(); // the core's loader (configured above) covers boot + reveals the game
