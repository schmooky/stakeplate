// Composition root — wires every subsystem for the dice game.
//
// Architecture: MobX stores + FSM phases + DicePresenter (slotplate-style), but
// the scene renders via three.js (DiceScene) instead of pixi-reels. The HUD is
// open-slot-ui mounted on a SEPARATE, transparent pixi Application stacked over
// the three.js canvas. Stake networking + the white HTML menu carry over.

import { gsap } from 'gsap';
import { reaction } from 'mobx';
import { Application, Assets, Texture, Rectangle } from 'pixi.js';
import { mountHud, svgSpinSkin, type BootedHud } from '@open-slot-ui/pixi';
import type { CurrencySpec, UISpec } from '@open-slot-ui/core';
import { GAME } from '@/config/gameConfig';
import { FSM } from '@/flow/fsm';
import { PHASES } from '@/flow/phases';
import { sfx } from '@/infrastructure/audio/Sfx';
import { createNetwork, type NetworkManager } from '@/infrastructure/network';
import { GsapTicker } from '@/infrastructure/timing';
import { DicePresenter } from '@/presenters/DicePresenter';
import { RootStore } from '@/state/RootStore';
import { mountHtmlMenu } from '@/hud/htmlMenu';
import { DiceScene } from '@/view/DiceScene';
import type { SessionResponse } from '@/domain/types';

export interface App {
  start(): Promise<void>;
  dispose(): void;
}

export interface ComposeOptions {
  /** Host element for the three.js canvas (the dice table). */
  sceneHost: HTMLElement;
  /** Host element for the transparent pixi HUD canvas (on top). */
  hudHost: HTMLElement;
  network?: NetworkManager;
}

// Three-decimal fiat (Gulf/Arab dinars & rials) must not be truncated to 2dp — e.g. the
// Omani Rial's minimal 0.01 stake at ×0.2 is a 0.002 win, which would render as "0.00".
// Mirrors @stakeplate/core's `currencyFor`; kept inline as this app predates the core dep.
const DINAR_DECIMALS: Record<string, number> = { KWD: 3, BHD: 3, JOD: 3, OMR: 3, TND: 3, LYD: 3, IQD: 3 };
function currencyFor(code: string): CurrencySpec {
  if (code === 'USD') return { code: 'USD', symbol: '$', display: 'symbol', position: 'prefix', decimals: 2 };
  return { code, decimals: DINAR_DECIMALS[code?.toUpperCase()] ?? 2 };
}

function sliceRows(tex: Texture, rows: number): Texture[] {
  const src = tex.source;
  const rh = src.height / rows;
  return Array.from({ length: rows }, (_, i) => new Texture({ source: src, frame: new Rectangle(0, i * rh, src.width, rh) }));
}

async function loadHudArt(): Promise<{ spinSkin: () => ReturnType<typeof svgSpinSkin>; icons: Record<string, Texture> }> {
  const load = async (src: string): Promise<Texture> => {
    const t = await Assets.load<Texture>({ src, data: { resolution: 3 } });
    t.source.autoGenerateMipmaps = true;
    t.source.style.scaleMode = 'linear';
    t.source.update();
    return t;
  };
  const [spinDefault, spinAuto, rulesTex, musicTrack, soundTrack, turboTex, autoTex, plusTex, minusTex] = await Promise.all([
    load('/spin/default.svg'), load('/spin/auto.svg'), load('/icons/rules.svg'),
    load('/icons/slider-music-track.svg'), load('/icons/slider-sound-track.svg'),
    load('/icons/turbo.svg'), load('/icons/auto.svg'), load('/icons/plus.svg'), load('/icons/minus.svg'),
  ]);
  const [turboOff, turboOn] = sliceRows(turboTex, 2);
  const autoFrames = sliceRows(autoTex, 4);
  return {
    spinSkin: () => svgSpinSkin({ default: spinDefault, auto: spinAuto }),
    icons: {
      rules: rulesTex, sliderMusic: musicTrack, sliderSound: soundTrack,
      turboOff: turboOff as Texture, turboOn: turboOn as Texture,
      autoIdle: autoFrames[0] as Texture, autoActive: autoFrames[2] as Texture,
      betPlus: plusTex, betMinus: minusTex,
    },
  };
}

export async function compose({ sceneHost, hudHost, network: networkOverride }: ComposeOptions): Promise<App> {
  const stores = new RootStore();
  stores.balance.setBet(GAME.defaultBet);

  const scene = new DiceScene();
  const dice = new DicePresenter(scene);
  const ticker = new GsapTicker();
  const network = networkOverride ?? createNetwork();

  const fsm = new FSM({ stores, ticker, network, dice });
  for (const phase of PHASES) fsm.register(phase);

  // HUD lives on its own transparent pixi app, stacked over the three canvas.
  const hudApp = new Application();
  let hud: BootedHud | null = null;
  const disposers: Array<() => void> = [];

  function buildSpec(session: SessionResponse): UISpec {
    const levels = session.availableBets.length ? session.availableBets : [0.2, 0.5, 1, 2, 5, 10];
    const idx = Math.max(0, levels.indexOf(session.defaultBet));
    return {
      theme: 'default',
      currency: currencyFor(session.currency),
      betLadder: { levels, index: idx },
      turbo: { modes: 2 },
      autoplay: { mode: 'options', options: [10, 25, 50, 100, Infinity] },
      spin: { press: 'tap' },
      rtp: session.rtp ?? 96,
      game: { name: GAME.title, version: '1.0.0' },
    };
  }

  async function runRound(): Promise<void> {
    if (!hud) return;
    const ui = hud.ui;
    stores.balance.setBet(ui.bet.get());
    const bet = stores.balance.bet;
    if (ui.balance.get() < bet) {
      hud.showRgsError('ERR_IPB');
      return;
    }
    document.getElementById('flash')?.classList.remove('show');
    ui.spin.busy();
    const startedAt = performance.now();
    try {
      await fsm.transition('spin'); // resolves after winShow → idle
      const minMs = hud.ui.minimumRoundDuration;
      const remaining = minMs - (performance.now() - startedAt);
      if (remaining > 0) await new Promise<void>((r) => ticker.schedule(remaining, r));
      hud.reportRound(stores.balance.lastWin, bet);
      // Round payout flash (cascade multiplier).
      const flash = document.getElementById('flash');
      const fval = document.getElementById('fVal');
      if (flash && fval && stores.data.multiplier > 0) {
        fval.textContent = stores.data.multiplier.toLocaleString(undefined, { maximumFractionDigits: 2 }) + '×';
        flash.classList.add('show');
        ticker.schedule(1600, () => flash.classList.remove('show'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.match(/ERR_[A-Z_]+/)?.[0];
      if (code) hud.showRgsError(code);
      else hud.showError(msg);
    } finally {
      ui.spin.idle();
    }
  }

  async function wireHud(session: SessionResponse): Promise<void> {
    const art = await loadHudArt();
    hud = mountHud(hudApp, buildSpec(session), { gsap, menu: false, spinSkin: art.spinSkin, icons: art.icons });
    const ui = hud.ui;

    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__dice = { hud, fsm, stores, spin: () => runRound(), scene, gsap };
    }

    if (session.rtp != null) hud.setRtp(session.rtp);
    hud.applyJurisdiction(session.jurisdiction ?? {});

    // Live cascade tally → top-centre badges.
    const $t = (id: string): HTMLElement | null => document.getElementById(id);
    dice.onTally((t) => {
      const d = $t('tDice'); if (d) d.textContent = String(t.dropped);
      const w = $t('tWin'); if (w) w.textContent = t.winSum.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const m = $t('tMult'); if (m) m.textContent = '×' + t.mult;
    });

    disposers.push(ui.on('spinRequested', () => void runRound()));
    disposers.push(ui.on('toggled', ({ id, on }) => { if (id === 'turbo') dice.setTurbo(on); }));
    disposers.push(
      ui.on('autoplayStarted', async () => {
        while (ui.autoplay.isActive) {
          if (ui.balance.get() < ui.bet.get()) { ui.autoplay.stop(); break; }
          await runRound();
        }
      }),
    );
    disposers.push(
      reaction(() => stores.balance.balance, (b) => hud?.setBalance(b), { fireImmediately: true }),
    );

    disposers.push(
      mountHtmlMenu(hudApp, hud, {
        gameName: GAME.title,
        paytable: [
          { symbol: 'White die', payouts: 'up to 1×' },
          { symbol: 'Green die', payouts: 'up to 2×' },
          { symbol: 'Blue die', payouts: 'up to 5× · ×2' },
          { symbol: 'Purple die', payouts: 'up to 25× · ×2' },
          { symbol: 'Gold die', payouts: 'up to 200× · ×2' },
        ],
        rules: [
          { kind: 'heading', id: 'r-h', text: 'How to play' },
          { kind: 'text', id: 'r-1', text: 'Press **SPIN** to drop the seed die. Each face pays (a number), multiplies (×k), is blank — or shows a **?** mystery.' },
          { kind: 'heading', id: 'r-h2', text: 'Cascade' },
          { kind: 'text', id: 'r-2', text: 'A **mystery (?)** face spawns more dice that drop and pile on. Pay faces add up; ×k faces multiply the lot. The round pays **sum × multiplier** (up to 5000×).' },
          { kind: 'steps', id: 'r-s', ordered: true, items: ['Set your stake with bet ± ', 'Press SPIN', 'Rarer colours (gold!) pay far more'] },
        ],
      }),
    );
  }

  return {
    async start() {
      await scene.init(sceneHost);
      await hudApp.init({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
      hudHost.appendChild(hudApp.canvas);

      sfx.init();

      const session = await network.session({});
      stores.ui.setSession(session.sessionId, session.currency);
      stores.balance.setBalance(session.balance);
      stores.balance.setBet(session.defaultBet);

      fsm.patchContext({ dice });
      await wireHud(session);

      document.getElementById('boot')?.setAttribute('data-done', '1');
      await fsm.transition('idle');
    },
    dispose() {
      for (const d of disposers.splice(0)) d();
      hud?.dispose();
      hudApp.destroy(true);
      network.dispose?.();
      dice.dispose();
    },
  };
}
