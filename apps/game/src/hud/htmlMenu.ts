// White HTML menu — the open-slot-ui reference ☰ menu (Settings → Paytable →
// Rules) as a biased white card with gold accents, INDEPENDENT of the dark game
// theme (so it always looks its best, matching the white buy-feature modal).
// Ported/adapted from the library's `examples/demo/src/htmlMenu.ts`; used with
// `menu: false` (the library's themed Pixi menu is disabled, this shows instead).
// Opens/closes off `ui.settingsPanel` state, so the canvas ☰ button drives it.

import type { Application } from 'pixi.js';
import type { BootedHud } from '@open-slot-ui/pixi';
import type { BlockSpec } from '@open-slot-ui/core';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Escape, then turn **bold** runs into <b> — the same inline syntax the Pixi renderer uses. */
const rich = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** Render the rules `BlockSpec[]` to HTML (the subset this game uses). */
function renderBlocks(blocks: BlockSpec[], tr: (s: string) => string): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        out.push(`<div class="ohm-sec"><span>${esc(tr(b.text))}</span></div>`);
        break;
      case 'subheading':
        out.push(`<h4 class="ohm-subh">${esc(tr(b.text))}</h4>`);
        break;
      case 'text':
        out.push(`<p>${rich(tr(b.text))}</p>`);
        break;
      case 'steps': {
        const items = b.items.map((s) => `<li>${rich(tr(s))}</li>`).join('');
        out.push(b.ordered ? `<ol class="ohm-steps">${items}</ol>` : `<ul class="ohm-steps">${items}</ul>`);
        break;
      }
      case 'stat-grid': {
        const rows = b.items.map((it) => `<div><dt>${esc(tr(it.label))}</dt><dd>${esc(tr(it.value))}</dd></div>`).join('');
        out.push(`<dl class="ohm-stats">${rows}</dl>`);
        break;
      }
      case 'divider':
        out.push('<hr class="ohm-hr">');
        break;
      default:
        break;
    }
  }
  return out.join('\n');
}

export interface HtmlMenuContent {
  gameName: string;
  paytable: Array<{ symbol: string; payouts: string }>;
  rules: BlockSpec[];
}

/** Mount the white HTML menu. Returns a leak-free teardown. */
export function mountHtmlMenu(_app: Application, hud: BootedHud, content: HtmlMenuContent): () => void {
  const ui = hud.ui;
  const tr = (k: string): string => ui.t(k);
  const disposers: Array<() => void> = [];

  const host = document.createElement('div');
  host.className = 'ohm-root';
  const vars: Record<string, string> = {
    '--accent': '#d99000', '--accent-text': '#1a1200',
    '--surface': '#ffffff', '--surface-alt': '#eef1f6',
    '--text': '#181b20', '--text-dim': '#5b6472',
    '--card-radius': '8px', '--font': ui.theme.type.family,
  };
  for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);

  const payRows = content.paytable
    .map((r) => `<div class="ohm-payrow"><span class="ohm-payname">${esc(tr(r.symbol))}</span><b class="ohm-payval">${esc(r.payouts)}</b></div>`)
    .join('');

  // Quick-spin reflects the turbo (2-mode) toggle.
  const turbo = ui.turbo;

  host.innerHTML = `
    <div class="ohm-backdrop" data-close></div>
    <button class="ohm-x" data-close aria-label="Close">✕</button>
    <div class="ohm-card" role="dialog" aria-modal="true">
      <div class="ohm-body">
        <h1 class="ohm-logo">${esc(content.gameName)}</h1>

        <div class="ohm-sec"><span data-t="Settings">${tr('Settings')}</span></div>
        <label class="ohm-row ohm-check"><span data-t="Sound">${tr('Sound')}</span>
          <span class="ohm-ctl"><input id="ohm-soundtoggle" type="checkbox" checked></span></label>
        <label class="ohm-row ohm-check"><span data-t="Quick spin">${tr('Quick spin')}</span>
          <span class="ohm-ctl"><input id="ohm-turbo-toggle" type="checkbox"></span></label>

        <div class="ohm-sec"><span data-t="Paytable">${tr('Paytable')}</span></div>
        <div class="ohm-paygrid">${payRows}</div>

        <div class="ohm-sec"><span data-t="Rules">${tr('Rules')}</span></div>
        <div class="ohm-rules" id="ohm-rules">${renderBlocks(content.rules, tr)}</div>
      </div>
    </div>`;

  const style = document.createElement('style');
  style.textContent = OHM_CSS;
  host.appendChild(style);
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string): T => host.querySelector(sel) as T;
  const soundToggle = $<HTMLInputElement>('#ohm-soundtoggle');
  const turboToggle = $<HTMLInputElement>('#ohm-turbo-toggle');

  soundToggle.checked = !ui.muted.get();
  soundToggle.addEventListener('change', () => ui.setMuted(!soundToggle.checked));
  disposers.push(ui.muted.subscribe((m) => { soundToggle.checked = !m; }));

  turboToggle.checked = turbo.isOn;
  turboToggle.addEventListener('change', () => turbo.set(turboToggle.checked));
  disposers.push(turbo.index.subscribe(() => { turboToggle.checked = turbo.isOn; }));

  host.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ui.settingsPanel.closePanel()));

  // open / close follows the settings panel state (the canvas ☰ toggles it).
  disposers.push(ui.settingsPanel.state.subscribe(() => host.classList.toggle('open', ui.settingsPanel.isOpen)));

  return () => {
    for (const d of disposers.splice(0)) d();
    host.remove();
  };
}

const OHM_CSS = `
.ohm-root { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; font-family: var(--font); opacity: 0; pointer-events: none; transition: opacity .18s ease; }
.ohm-root.open { opacity: 1; pointer-events: auto; }
.ohm-backdrop { position: absolute; inset: 0; background: rgba(8,6,4,0); backdrop-filter: blur(0px) saturate(1); -webkit-backdrop-filter: blur(0px) saturate(1); transition: background .4s ease, backdrop-filter .4s ease, -webkit-backdrop-filter .4s ease; }
.ohm-root.open .ohm-backdrop { background: rgba(8,6,4,.34); backdrop-filter: blur(6px) saturate(1.1); -webkit-backdrop-filter: blur(6px) saturate(1.1); }
.ohm-card { position: relative; width: min(92%, 760px); max-height: 86vh; display: flex; flex-direction: column; background: var(--surface); color: var(--text); border: 1.5px solid #000; border-radius: var(--card-radius); box-shadow: 0 30px 80px rgba(0,0,0,.5); overflow: hidden; transform: translateY(8px) scale(.99); transition: transform .18s ease; }
.ohm-root.open .ohm-card { transform: none; }
.ohm-x { position: absolute; top: 18px; right: 22px; width: 46px; height: 46px; border-radius: 999px; border: 0; background: rgba(18,14,10,.82); color: #fff; font-size: 18px; cursor: pointer; display: grid; place-items: center; box-shadow: 0 6px 18px rgba(0,0,0,.45); z-index: 2; transition: transform .12s, background .12s; }
.ohm-x:hover { transform: scale(1.08); background: rgba(18,14,10,.95); }
.ohm-body { padding: 24px 26px 26px; overflow-y: auto; }
.ohm-body::-webkit-scrollbar { width: 14px; }
.ohm-body::-webkit-scrollbar-thumb { background-color: #111; border: 5px solid transparent; background-clip: padding-box; border-radius: 999px; }
.ohm-logo { margin: 4px 0 18px; text-align: center; font-size: 30px; font-weight: 900; letter-spacing: 1px; color: var(--text); }
.ohm-sec { display: flex; align-items: center; gap: 14px; margin: 24px 0 14px; color: var(--text); font-weight: 800; letter-spacing: 1px; }
.ohm-sec::before, .ohm-sec::after { content: ""; flex: 1; height: 2px; background: color-mix(in srgb, var(--text) 80%, transparent); border-radius: 2px; }
.ohm-root *, .ohm-root *::before, .ohm-root *::after { box-sizing: border-box; }
.ohm-row { display: flex; align-items: center; gap: 16px; margin: 14px 0; font-weight: 700; }
.ohm-row > span:first-child { flex: none; min-width: 110px; }
.ohm-ctl { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; }
.ohm-check input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 50px; height: 28px; border-radius: 999px; background: color-mix(in srgb, var(--text-dim) 38%, transparent); position: relative; cursor: pointer; transition: background .15s; flex: none; }
.ohm-check input[type=checkbox]:checked { background: var(--accent); }
.ohm-check input[type=checkbox]::before { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; transition: left .15s; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.ohm-check input[type=checkbox]:checked::before { left: 25px; }
.ohm-paygrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 28px; }
.ohm-payrow { display: flex; justify-content: space-between; align-items: baseline; padding: 8px 4px; border-bottom: 1px solid color-mix(in srgb, var(--text-dim) 20%, transparent); }
.ohm-payname { font-weight: 700; color: var(--text); }
.ohm-payval { color: var(--accent); font-weight: 800; font-size: 18px; }
.ohm-body p { color: var(--text-dim); line-height: 1.6; margin: 10px 0; }
.ohm-body p b { color: var(--text); }
.ohm-subh { margin: 22px 0 8px; font-size: 15px; font-weight: 800; letter-spacing: .5px; color: var(--text); }
.ohm-hr { border: 0; border-top: 1px solid color-mix(in srgb, var(--text-dim) 30%, transparent); margin: 18px 0; }
.ohm-steps { margin: 12px 0; padding-left: 22px; color: var(--text-dim); line-height: 1.7; }
.ohm-steps li { margin: 5px 0; }
.ohm-steps b { color: var(--text); }
.ohm-stats { margin: 12px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
.ohm-stats > div { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid color-mix(in srgb, var(--text-dim) 20%, transparent); }
.ohm-stats dt { color: var(--text-dim); margin: 0; } .ohm-stats dd { margin: 0; font-weight: 700; }
`;
