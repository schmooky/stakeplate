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
| `src/demoNetwork.ts` | A **local dev** mock RGS, used only for bare `npm run dev`. A real Stake launch auto-uses the real RGS (see below). |

The core owns everything else: the RGS handshake (with the required `language`), the
[open-slot-ui](https://github.com/schmooky/open-slot-ui) HUD, currency + jurisdiction, the
buy-confirm gate, replay, active-round resume, the blocking boot-error, the round FSM, and the
audio mixer (nine buses in two groups, driven by the HUD's Music/Effects sliders).

## Running against the real Stake RGS

The template is already wired for it — **the mock is only a fallback for bare `npm run dev`**
(no backend). As soon as your game is launched with a real `rgs_url`, `main.ts`'s
`isStakeLaunch()` check skips the mock and the core connects to the real RGS: it authenticates
with the launch `sessionID`, pulls the real balance / bet-ladder / config, and spins + buys
features with real requests.

To try it from the Stake Engine dashboard:

1. In the dev tool, set a **local redirect** to your dev server (e.g. `http://localhost:5173`)
   and launch. It opens a new tab like:

   ```
   http://localhost:5173/?sessionID=…&rgs_url=rgsd.stake-engine.com&lang=en&currency=USD&device=desktop&social=false&demo=true
   ```

   `demo=true` is Stake **fun-play** (a demo wallet on the real RGS) — it still authorizes and
   plays against `rgs_url`, so you get real balances and real spins/buys.
2. That's it — no code change needed. (Force the mock during a real launch with `?mock=true`.)

## Going to production

1. Optionally delete `src/demoNetwork.ts` + the `demoNetwork` block in `main.ts` for a
   real-RGS-only build (the mock is inert under a real launch anyway).
2. Replace `Scene.ts` with your real reels + art; add sounds via `audio.load([...])`.
3. Fill in the rules/paytable (`config.rules`) and run your math to certify RTP + max win.
4. `npm run build` → upload the `dist/` bundle.

Docs: <https://github.com/schmooky/stakeplate>
