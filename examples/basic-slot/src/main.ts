// The ENTIRE game. `createStakeGame` handles the RGS handshake, boot, HUD, currency,
// jurisdiction, replay, errors and the round loop. This game supplies only: a config, a
// pure interpretBook (RGS book → its model), a mountView (the pixi scene) and a Present
// phase (animate the round). Booted on the demo mock RGS — no backend.

import { createStakeGame, isStakeLaunch, roundEvents, type Phase } from '@stakeplate/core';
import { createGameAudio } from '@stakeplate/core/audio';
import { MiniSlot } from './MiniSlot';
import { DemoNetwork } from './demoNetwork';
import { rulesMenu, socialMessages } from './rules';
import winUrl from './assets/win.mp3';
import bgmUrl from './assets/bgm.mp3';

// The mixer: nine buses in two groups (music/effects). The core binds the HUD's Music/Effects
// sliders + mute to the groups and unlocks on the first spin.
const audio = createGameAudio();
(window as unknown as { __AUDIO__: typeof audio }).__AUDIO__ = audio; // dev/harness handle

// The win jingle → `wins` bus (music ducks under it); the BGM is a PLAIN loop, so we let
// zvuk crossfade its boundary (400 ms) into a seamless loop — no authored intro/tail needed.
const soundsReady = audio.load([
  { name: 'win', url: winUrl, bus: 'wins' },
  { name: 'base', kind: 'music', loop: bgmUrl, loopCrossfadeMs: 400 },
]);

/** A throwaway feature-card image: an emoji on a gradient, as an inline SVG data URI. A real
 *  game passes its own art URL; this keeps the demo self-contained (no extra asset files). */
const cardArt = (emoji: string, from: string, to: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><text x="160" y="132" font-size="96" text-anchor="middle">${emoji}</text></svg>`,
  )}`;

/** This game's book-event type — declared once, so `interpretBook`'s `raw` is TYPED. */
type Ev = { grid: string[][] };
type Data = { grid: string[][]; win: boolean };

let musicStarted = false;
/** The game's Present phase — start the BGM once, ring the win jingle, play the scene, settle. */
const present: Phase<Data, MiniSlot, Ev> = {
  name: 'present',
  async enter(ctx) {
    if (!musicStarted) { musicStarted = true; ctx.audio?.music('base', { fadeIn: 0.8 }); } // seamless loop
    const r = ctx.round;
    if (r?.data.win) ctx.audio?.play('win', { bus: 'wins' });
    // ctx.turbo.delay drives the spin duration → turbo speed + slam-stop for free.
    if (r) await ctx.view.play(r.data.grid, r.data.win, (ms) => ctx.turbo.delay(ms));
    await ctx.fsm.transition('settle');
  },
};

const game = createStakeGame<Data, MiniSlot, Ev>({
  // The bet ladder, default bet and buy-confirm policy come from the RGS/jurisdiction (here
  // the mock's `authenticate`), NOT from game config. `rtp` is display-only fallback.
  config: {
    title: 'Basic Slot',
    rtp: 96,
    // Buy modes → the bonus button appears and opens the feature-LIST modal (a card each).
    // Buying a card (its cost × the bet) runs the confirm gate, then spins that mode once.
    // `base` is the normal spin; `name`/`image` skin the card.
    modes: {
      base: 1,
      // `buy` cards → one-shot bought bonuses (spin once, full cost). `boost` → an activatable
      // ante: while on, every spin plays this mode at 2× the bet (card shows the +1× surcharge).
      bonus: { cost: 100, buy: true, name: 'Free Spins', image: cardArt('🎁', '#7b3fe4', '#3f2b96') },
      super: { cost: 300, buy: true, name: 'Super Bonus', image: cardArt('💎', '#e4b03f', '#8a5a1e') },
      lucky: { cost: 2, boost: true, name: 'Lucky Bet', image: cardArt('🍀', '#2ea043', '#14532d') },
    },
    rules: rulesMenu, // full compliant info menu (buildRules: control guide + disclaimer + stats)
    socialMessages, // social-mode wording swaps (core + game restricted terms)
  },
  // The one money seam: parse the book's grid. `raw` is `Round<Ev>` → `roundEvents(raw)` is
  // `Ev[]`, no cast. The win/multiplier are the engine's (server-authoritative).
  interpretBook: (raw, info): Data => {
    const ev = roundEvents(raw)[0];
    return { grid: ev?.grid ?? [[], [], []], win: info.totalWin > 0 };
  },
  mountView: (host, ctx) => {
    const scene = new MiniSlot(host);
    (window as unknown as { __SCENE__: MiniSlot }).__SCENE__ = scene; // dev/harness handle
    (window as unknown as { __HUD__: unknown }).__HUD__ = ctx.hud; // dev/harness handle
    (window as unknown as { __TURBO__: unknown }).__TURBO__ = ctx.turbo; // dev/harness handle
    return scene;
  },
  phases: [present],
  audio, // core auto-binds Music/Effects sliders + mute + unlock (add sounds via audio.load)
  // Bare dev → the mock RGS (owns the ladder, like a real `authenticate` would). Launched with
  // a real `rgs_url` (e.g. `?rgs_url=…&sessionID=…`, incl. Stake `demo=true` fun-play) → the
  // core authenticates + plays against that real RGS instead. See `isStakeLaunch`.
  ...(isStakeLaunch()
    ? {}
    : { network: new DemoNetwork({ balance: 1000, currency: 'USD', betLevels: [0.2, 0.5, 1, 2, 5, 10], defaultBet: 1, rtp: 96, modes: { base: 1, bonus: 100, super: 300, lucky: 2 } }) }),
  hudHost: document.getElementById('hud')!,
  sceneHost: document.getElementById('scene')!,
});

// Dev affordance: expose the game so the preview / harness can drive spins and read state
// via `game.requestSpin()` + `game.inspect()` (no screenshots, no pixi event synthesis).
(window as unknown as { __GAME__: typeof game }).__GAME__ = game;

// Preload the sounds (non-fatal), then boot.
soundsReady
  .catch((err) => console.warn('[basic-slot] sound load failed (non-fatal)', err))
  .then(() => game.start())
  .then(() => document.getElementById('boot')?.setAttribute('data-done', '1'))
  .catch((err) => {
    console.error('[basic-slot] boot failed', err);
    document.getElementById('boot')?.setAttribute('data-done', '1');
  });
