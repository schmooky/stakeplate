# @stakeplate/rules-editor

`npx`-runnable visual editor for **open-slot-ui rules documents** — the one portable
JSON file that carries a game's whole rules surface: draggable content blocks,
i18next-compatible per-locale copy with `{{rtp.base}}`-style interpolation tokens,
and the game facts they resolve from.

```bash
npx @stakeplate/rules-editor src/rules.doc.json
```

The editor opens in your browser:

- **Blocks** — drag block kinds (heading · text · steps · callout · stat-grid ·
  mode-stats · table · image · legal · divider) into the document, drag cards to
  reorder, edit copy inline. `mode-stats` auto-renders every declared mode's
  RTP / Max win — it can never drift from the config.
- **Audit** — the REAL `@open-slot-ui/core` compliance audit runs live on every
  keystroke: a mode whose RTP / max win is unstated, a configured buy feature with
  no description, missing free-spins count / retrigger policy, missing legal or
  controls guide — all called out before you ship them.
- **Tokens** — every interpolation variable the declared facts expose
  (`{{rtp.base}}`, `{{maxWin.bonus}}`, `{{cost.free-spins}}`, `{{freeSpins.count}}`,
  `{{freeSpins.retrigger}}`, `{{volatility}}`, `{{maxWinCap}}`), click to copy.
  Copy that states numbers via tokens is correct **by construction**.
- **Translate** — add locales; the English copy doubles as the i18n key (the house
  convention), each string gets a translation box. Same tokens work everywhere.
- **Facts / Preview** — edit the facts JSON; preview renders the interpolated,
  localized result in the in-game menu's look.

Options: `--facts game-facts.json` (merge the game's own facts export),
`--port 4977`, `--no-open`.

## Consuming the saved file

```ts
import { mountHud } from '@open-slot-ui/pixi';
import { applyRulesDoc, type RulesDoc } from '@open-slot-ui/core';
import doc from './rules.doc.json';

const hud = mountHud(app, applyRulesDoc(spec, doc as RulesDoc));
```

`applyRulesDoc` folds the blocks into `menu.rules`, merges the per-locale messages
under your own dictionaries, and merges the doc's facts under `spec.facts`. The
in-game info menu interpolates the same tokens from the LIVE facts and shows an
explicit "Rules incomplete" card if anything required is missing.
