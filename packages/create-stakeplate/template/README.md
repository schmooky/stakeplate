# {{name}}

A Stake Engine slot game built on [`@stakeplate/core`](https://github.com/schmooky/stakeplate).

```bash
npm install
npm run dev      # open the preview and spin
npm run build    # single self-contained bundle (relative paths) for Stake
```

## What's here

| File | What it is |
|---|---|
| `src/main.ts` | The whole game: `config` + `interpretBook` + `mountView` + a `Present` phase, wired with `createStakeGame`. |
| `src/Scene.ts` | Your pixi scene (a placeholder 3×3 emoji grid). Swap it for `pixi-reels` boards + your art. |
| `src/demoNetwork.ts` | A **local dev** mock RGS. **Delete it for production** — the core connects to the real Stake RGS from the `rgs_url` launch param. |

The core owns everything else: the RGS handshake (with the required `language`), the
[open-slot-ui](https://github.com/schmooky/open-slot-ui) HUD, currency + jurisdiction, the
buy-confirm gate, replay, active-round resume, the blocking boot-error, the round FSM, and the
audio mixer (nine buses in two groups, driven by the HUD's Music/Effects sliders).

## Going to production

1. Delete `src/demoNetwork.ts` and remove `network:` from `createStakeGame` — the core reads
   `rgs_url` / `sessionID` / `lang` / `currency` from the launch URL.
2. Replace `Scene.ts` with your real reels + art; add sounds via `audio.load([...])`.
3. Fill in the rules/paytable (`config.rules`) and run your math to certify RTP + max win.
4. `npm run build` → upload the `dist/` bundle.

Docs: <https://github.com/schmooky/stakeplate>
