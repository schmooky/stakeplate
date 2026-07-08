# @stakeplate/core

The batteries-included **Stake Engine game core**. Import it, and the RGS handshake,
boot flow, round lifecycle, HUD wiring, audio, i18n and compliant rules all *just work*
— "plug a battery into a slot." A game supplies only its **scene(s)**, its **Present
phase**, its **sounds**, and a pure **`interpretBook`**.

Built on [`@open-slot-ui`](https://github.com/schmooky/open-slot-ui) (HUD + compliance),
[`@schmooky/zvuk`](https://github.com/schmooky/zvuk) (audio), pixi-reels (boards) and
Pixi v8.

> Status: **early / WIP.** The `@stakeplate/core/rgs` transport + runtime layer is in
> (with the real Stake wire — `authenticate {sessionID, language}`, `play {mode, currency,
> amount}`, end-round, replay — plus an authoritative, scriptable mock RGS). The
> `createStakeGame(...)` façade, engine/phases, `/audio`, `/scene`, `/i18n`, `/rules`
> and `/testing` land next.

## The idea

```ts
import { createStakeGame } from '@stakeplate/core';

const game = createStakeGame({
  config,                                   // bets, modes, title, currency, rules
  interpretBook: raw => parseRound(raw),    // pure: RGS book → your model
  mountView: (host, ctx) => new MyScene(host, ctx), // your pixi + presenters + stores
  audio: manifest,
  phases: [new PresentPhase()],             // Idle/Spin/Settle are provided
});
await game.start(); // auth+language, resume, replay, errors, jurisdiction, HUD, audio…
```

## Subpaths

- `@stakeplate/core` — the one-call API + engine.
- `@stakeplate/core/rgs` — wire protocol, launch-param runtime, `NetworkManager` +
  Stake/mock adapters, `createNetwork`.
- `@stakeplate/core/testing` — the mock RGS, scriptable network, instant ticker.
- (soon) `/stores`, `/audio`, `/scene`, `/i18n`, `/rules`.

## License

MIT © schmooky and the stakeplate contributors.
