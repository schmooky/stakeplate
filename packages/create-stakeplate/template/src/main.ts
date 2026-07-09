// The ENTIRE game. `createStakeGame` runs the compliant boot (RGS handshake, HUD, currency,
// jurisdiction, replay, active-round resume, errors) and the round loop. You supply only:
// a config, a pure interpretBook (RGS book → your model), a mountView (your pixi scene) and
// a Present phase (animate the round). See https://github.com/schmooky/stakeplate.

import { createStakeGame, roundEvents, type Phase } from '@stakeplate/core';
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

const game = createStakeGame<Data, Scene, Ev>({
  // The bet ladder, default bet and buy-confirm come from the RGS/jurisdiction, NOT here.
  config: { title: '{{name}}', rtp: 96, rules: rulesMenu, socialMessages },
  // The ONE money seam: parse the book's events into your model. Pure. The win/multiplier
  // are the engine's (server-authoritative) — never compute payouts on the client.
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0];
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host) => new Scene(host),
  phases: [present],
  audio,
  // LOCAL DEV ONLY — a scripted mock RGS. Delete this line (and demoNetwork.ts) for production;
  // the core then talks to the real Stake RGS from the `rgs_url` launch param.
  network: new DemoNetwork({ balance: 1000, currency: 'USD', betLevels: [0.2, 0.5, 1, 2, 5, 10], defaultBet: 1, modes: { base: 1 } }),
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

game.start().finally(() => document.getElementById('boot')?.setAttribute('data-done', '1'));
