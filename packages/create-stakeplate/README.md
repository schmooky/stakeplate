# create-stakeplate

Scaffold a new [Stake Engine](https://stake-engine.com) slot game built on
[`@stakeplate/core`](https://www.npmjs.com/package/@stakeplate/core) — the batteries-included
game core (RGS transport, boot, round FSM, HUD wiring, audio, compliant rules).

```bash
npm create stakeplate@latest my-game
# or: pnpm create stakeplate my-game · yarn create stakeplate my-game

cd my-game
npm install
npm run dev        # boots + spins on a local mock RGS — no backend needed
```

You get a compliant skeleton day one: the `#hud` / `#scene` / `#boot` hosts, a Stake-correct
single-bundle `vite.config` (`base: './'` + pixi dedupe), a tiny pixi scene, a demo network,
and a `createStakeGame(...)` entry point. Reskin the scene, write your pure `interpretBook`,
and ship.

## What's inside the template

- `src/main.ts` — the whole game: one `createStakeGame` call.
- `src/Scene.ts` — the pixi scene you replace with your reels/boards.
- `src/demoNetwork.ts` — a mock RGS for local dev (deleted in production; the core talks to
  the real Stake RGS).
- `src/rules.ts` — a `buildRules` starter (compliant info menu + social wording).

See the [`@stakeplate/core` docs](https://github.com/schmooky/stakeplate) for the full model.

## License

MIT © schmooky and the stakeplate contributors.
