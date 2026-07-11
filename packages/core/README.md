# @stakeplate/core

The batteries-included **Stake Engine game core**. Import it, and the RGS handshake,
boot flow, round lifecycle, HUD wiring, audio, i18n and compliant rules all *just work*
— "plug a battery into a slot." A game supplies only its **scene(s)**, its **Present
phase**, its **sounds**, and a pure **`interpretBook`**.

Built on [`@open-slot-ui`](https://github.com/schmooky/open-slot-ui) (HUD + compliance),
[`@schmooky/zvuk`](https://github.com/schmooky/zvuk) (audio), pixi-reels (boards) and
Pixi v8.

> Status: **usable, pre-1.0.** In: the `@stakeplate/core/rgs` transport + runtime (real
> Stake wire — `authenticate {sessionID, language}`, `play {mode, currency, amount}`,
> end-round, replay — plus an authoritative, scriptable mock RGS), the `createStakeGame(...)`
> façade, the engine/phases + stores, `/audio` (zvuk buses + HUD binding), `/rules`
> (`buildRules` + social dict), turbo/autoplay, buy-features and `/testing`. Still landing:
> `/scene` helpers and `/i18n`.

## The idea

```ts
import { createStakeGame } from '@stakeplate/core';

const game = createStakeGame({
  config,                                   // title, currency, modes (+buy/boost), rules
  interpretBook: raw => parseRound(raw),    // pure: RGS book → your model
  mountView: (host, ctx) => new MyScene(host, ctx), // your pixi + presenters + stores
  audio: manifest,
  phases: [new PresentPhase()],             // Idle/Spin/Settle are provided
});
await game.start(); // auth+language, resume, replay, errors, jurisdiction, HUD, audio…
```

## Buy-features & rules

A mode flagged `buy` or `boost` makes the **bonus button open the feature-list modal**
(shipped by `@open-slot-ui/pixi`) — one card per feature, with the jurisdiction confirm gate:

```ts
config.modes = {
  base: 1,
  bonus: { cost: 100, buy: true,   name: 'Free Spins', image: art }, // Buy card — spins once
  lucky: { cost: 2,   boost: true, name: 'Lucky Bet',  image: art }, // Activate card — 2× ante
};
```

`buy` cards spend `cost × bet` and spin that mode once; `boost` cards toggle a persistent ante
(every spin plays at `cost×`, the readout shows the boosted stake). Build the **compliant info
menu** — how-to-play, per-button guide, stats, and the exact Stake disclaimer — with `buildRules`:

```ts
import { buildRules } from '@stakeplate/core/rules';
const built = buildRules({ about, howToPlay, features, paytable, stats });
config.rules = built.menu;                      // → the white HTML menu
config.socialMessages = { en: built.socialEn }; // auto-derived social wording
```

## Subpaths

- `@stakeplate/core` — the one-call API + engine (turbo, autoplay, buy-features).
- `@stakeplate/core/rgs` — wire protocol, launch-param runtime, `NetworkManager` +
  Stake/mock adapters, `createNetwork`.
- `@stakeplate/core/audio` — zvuk bus graph (music/effects groups) + HUD slider/mute binding.
  Loaded one-shots are RMS-normalized by default (consistent levels, no per-file gains) and
  each effects bus is voice-capped so stacked cues don't machine-gun. `play(name, { volume,
  pitch })` takes jitter (`{ base, jitter }`) so repeated cues vary. `bindInputSounds(audio,
  hud, map)` (or an `AudioSpec.inputSounds` map) plays a cue on spin/bet/autoplay/turbo/skip.
  Encode raw clips to shippable web assets (webm/opus + mp3 codec ladder, all metadata
  stripped) with `scripts/encode-audio.sh OUTDIR raw/*.wav`, then load the pair with
  `{ url: ['clip.webm', 'clip.mp3'] }`.
- `@stakeplate/core/rules` — `buildRules` compliant menu + `toSocial`/`findRestricted` + dict.
- `@stakeplate/core/stores` — the MobX stores (balance, ui) for composing game state.
- `@stakeplate/core/testing` — the mock RGS, scriptable network, instant ticker.
- (soon) `/scene`, `/i18n`.

## License

MIT © schmooky and the stakeplate contributors.
