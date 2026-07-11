// Composition root — the only file that knows how every subsystem is built.
//
// Stakeplate wiring: slotplate architecture (DI container + MobX stores + FSM
// phases + ReelsPresenter), the Lucky-Magnet 3×3 digit/magnet scene, the Stake
// Engine networking, and the @open-slot-ui/pixi HUD mounted in one call. There is no
// Preact/DOM game UI — open-ui owns the controls in-canvas.

import { gsap } from 'gsap';
import { autorun, reaction } from 'mobx';
import { Assets, Rectangle, Texture } from 'pixi.js';
import { mountHud, svgSpinSkin, type BootedHud } from '@open-slot-ui/pixi';
import type { BlockSpec, CurrencySpec, UISpec } from '@open-slot-ui/core';
import { mountBuyFeatureModal } from '@/hud/buyFeatureModal';
import { mountHtmlMenu } from '@/hud/htmlMenu';
import type { SessionResponse } from '@/domain/types';
import { GAME } from '@/config/gameConfig';
import { getReplayParams } from '@/config/replay';
import { Container as DI, Tokens } from '@/container';
import { FSM } from '@/flow/fsm';
import { PHASES } from '@/flow/phases';
import { i18n, initI18n } from '@/i18n';
import { ConsoleAnalytics } from '@/infrastructure/Analytics';
import { AssetLoader } from '@/infrastructure/AssetLoader';
import { sfx } from '@/infrastructure/audio/Sfx';
import { BUNDLES } from '@/infrastructure/loader/assetManifest';
import { createNetwork, type NetworkManager } from '@/infrastructure/network';
import { ScriptableMockNetwork } from '@/infrastructure/network/ScriptableMockNetwork';
import { GsapTicker, type Ticker } from '@/infrastructure/timing';
import { BackgroundPresenter } from '@/presenters/BackgroundPresenter';
import { ReelsPresenter } from '@/presenters/ReelsPresenter';
import { AVAILABLE_BETS } from '@/state/UIStore';
import { RootStore } from '@/state/RootStore';
import {
  InstantTicker,
  isTestModeEnabled,
  StubReelsEngine,
  shouldUseHeadlessStubs,
  TEST_BRIDGE_GLOBAL,
  TestBridge,
} from '@/testing';
import { InspectorChannel } from '@/testing/InspectorChannel';
import { mountInspector } from '@/testing/InspectorOverlay';
import { MainScene } from '@/view/scenes/MainScene';
import { resizeObject } from '@/view/smart';

export interface App {
  container: DI;
  start(): Promise<void>;
  dispose(): void;
  /** Present only when test mode is on (`?test=1` or `VITE_TEST_BRIDGE=1`). */
  testBridge?: TestBridge;
}

export interface ComposeOptions {
  /** Pixi canvas host element. */
  host: HTMLElement;
  /** Optional NetworkManager override (skips the createNetwork factory). */
  network?: NetworkManager;
  /** Optional Ticker override — see InstantTicker for the test-mode default. */
  ticker?: Ticker;
  /** Force test mode on (equivalent to `?test=1`). */
  testMode?: boolean;
}

/** Vortex buy-feature card art — an inline SVG swirl of digits (no network). */
const VORTEX_CARD_ART =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#0b3a4a"/><stop offset="55%" stop-color="#0a2230"/><stop offset="100%" stop-color="#05111a"/>
        </radialGradient>
      </defs>
      <rect width="320" height="200" fill="url(#g)"/>
      <g fill="none" stroke="#5eead4" stroke-width="3" stroke-linecap="round" opacity="0.9">
        <path d="M160 100 m-58 0 a58 58 0 1 1 24 47" />
        <path d="M160 100 m-38 0 a38 38 0 1 0 30 -28" opacity="0.7"/>
        <path d="M160 100 m-18 0 a18 18 0 1 1 16 11" opacity="0.5"/>
      </g>
      <g font-family="sans-serif" font-weight="700" fill="#e7eef0" opacity="0.92">
        <text x="60" y="56" font-size="30">7</text>
        <text x="240" y="64" font-size="26" opacity="0.8">3</text>
        <text x="250" y="150" font-size="32">9</text>
        <text x="58" y="156" font-size="24" opacity="0.8">1</text>
        <text x="150" y="116" font-size="44" fill="#5eead4">4</text>
      </g>
    </svg>`,
  );

/** Build a minimal open-ui CurrencySpec from the session currency code. Three-decimal
 *  fiat (Gulf/Arab dinars & rials) must not be truncated to 2dp — e.g. OMR 0.01 × ×0.2 =
 *  0.002 → "0.00". Mirrors @stakeplate/core's `currencyFor`; inline as this app predates
 *  the core dep. */
const DINAR_DECIMALS: Record<string, number> = { KWD: 3, BHD: 3, JOD: 3, OMR: 3, TND: 3, LYD: 3, IQD: 3 };
function currencyFor(code: string): CurrencySpec {
  if (code === 'USD') return { code: 'USD', symbol: '$', display: 'symbol', position: 'prefix', decimals: 2 };
  return { code, decimals: DINAR_DECIMALS[code?.toUpperCase()] ?? 2 };
}

/** Slice a vertical sprite-sheet texture into `rows` equal frames. */
function sliceRows(tex: Texture, rows: number): Texture[] {
  const src = tex.source;
  const rh = src.height / rows;
  return Array.from(
    { length: rows },
    (_, i) => new Texture({ source: src, frame: new Rectangle(0, i * rh, src.width, rh) }),
  );
}

/**
 * Load the open-ui black-and-white icon set (SVGs in public/icons + public/spin)
 * and assemble the `spinSkin` + `icons` options for mountHud. Menu (☰), mute and
 * fullscreen fall back to the library's built-in mono glyphs.
 */
async function loadHudArt(): Promise<{
  spinSkin: () => ReturnType<typeof svgSpinSkin>;
  icons: Record<string, Texture>;
}> {
  const load = async (src: string): Promise<Texture> => {
    const t = await Assets.load<Texture>({ src, data: { resolution: 3 } });
    t.source.autoGenerateMipmaps = true;
    t.source.style.scaleMode = 'linear';
    t.source.style.mipmapFilter = 'linear';
    t.source.update();
    return t;
  };
  const [spinDefault, spinAuto, rulesTex, musicTrack, soundTrack, turboTex, autoTex, bonusTex, plusTex, minusTex] =
    await Promise.all([
      load('/spin/default.svg'),
      load('/spin/auto.svg'),
      load('/icons/rules.svg'),
      load('/icons/slider-music-track.svg'),
      load('/icons/slider-sound-track.svg'),
      load('/icons/turbo.svg'),
      load('/icons/auto.svg'),
      load('/icons/bonus.svg'),
      load('/icons/plus.svg'),
      load('/icons/minus.svg'),
    ]);
  const [turboOff, turboOn] = sliceRows(turboTex, 2);
  const autoFrames = sliceRows(autoTex, 4);
  return {
    spinSkin: () => svgSpinSkin({ default: spinDefault, auto: spinAuto }),
    icons: {
      rules: rulesTex,
      sliderMusic: musicTrack,
      sliderSound: soundTrack,
      turboOff: turboOff as Texture,
      turboOn: turboOn as Texture,
      autoIdle: autoFrames[0] as Texture,
      autoActive: autoFrames[2] as Texture,
      bonus: bonusTex,
      betPlus: plusTex,
      betMinus: minusTex,
    },
  };
}

export async function compose({
  host,
  network: networkOverride,
  ticker: tickerOverride,
  testMode,
}: ComposeOptions): Promise<App> {
  const testEnabled = testMode || isTestModeEnabled();
  const useStubs = shouldUseHeadlessStubs(testEnabled);
  await initI18n();
  const container = new DI();

  container.register(Tokens.Stores, () => {
    const root = new RootStore();
    root.balance.setBet(GAME.defaultBet);
    return root;
  });
  container.register(Tokens.Ticker, () => tickerOverride ?? (useStubs ? new InstantTicker() : new GsapTicker()));
  container.register(Tokens.Network, () => {
    if (networkOverride) return networkOverride;
    if (testEnabled) {
      return new ScriptableMockNetwork({
        symbolIds: GAME.symbolIds,
        columns: GAME.columns,
        rows: GAME.rows,
        startingBalance: GAME.startingBalance,
      });
    }
    return createNetwork();
  });
  container.register(Tokens.Analytics, () => new ConsoleAnalytics());
  container.register(Tokens.Assets, () => new AssetLoader(BUNDLES));
  container.register(Tokens.Scene, () => new MainScene());

  const stores = container.get(Tokens.Stores);
  const ticker = container.get(Tokens.Ticker);
  const network = container.get(Tokens.Network);
  const assets = container.get(Tokens.Assets);
  const scene = container.get(Tokens.Scene);

  const fsm = new FSM({
    stores,
    ticker,
    network,
    reels: null as unknown as ReelsPresenter,
  });

  stores.ui.setLanguage(i18n.language || 'en');
  i18n.on('languageChanged', (lng) => stores.ui.setLanguage(lng));

  // Audio: WebAudio synth (no sourced files), mirrored to the UI sound toggle.
  sfx.init();
  const sfxDisposer = autorun(() => {
    sfx.setEnabled(stores.ui.soundEnabled);
    sfx.setVolume(stores.ui.sfxVolume);
  });

  for (const phase of PHASES) fsm.register(phase);

  let hud: BootedHud | null = null;
  let reels: ReelsPresenter | null = null;
  let inspectorDisposer: (() => void) | null = null;
  let inspectorChannel: InspectorChannel | null = null;
  const hudDisposers: Array<() => void> = [];

  // Test bridge — built only in test mode.
  let testBridge: TestBridge | undefined;
  if (testEnabled) {
    if (!(network instanceof ScriptableMockNetwork)) {
      throw new Error('[composition] testMode requires a ScriptableMockNetwork.');
    }
    testBridge = new TestBridge({ stores, fsm, network, usesStubs: useStubs });
    (globalThis as Record<string, unknown>)[TEST_BRIDGE_GLOBAL] = testBridge;
  }

  /** Drive one full round through the FSM, bridging the open-ui spin lifecycle. */
  async function runRound(): Promise<void> {
    if (!hud) return;
    const ui = hud.ui;
    // open-ui owns the bet ladder + turbo toggle; push them into the stores the
    // FSM/scene read before kicking the round off.
    stores.balance.setBet(ui.bet.get());
    stores.ui.setSpeed(ui.turbo.isOn ? 'turbo' : 'normal');
    const bet = stores.balance.bet;
    // Vortex ante stakes more per spin; check funds against the effective stake.
    const stake = stores.ui.vortexActive ? bet * GAME.vortexAnte : bet;
    if (ui.balance.get() < stake) {
      hud.showRgsError('ERR_IPB'); // insufficient funds
      return;
    }
    ui.spin.busy();
    const startedAt = performance.now();
    try {
      await fsm.transition('spin'); // resolves after winShow → idle
      // Jurisdiction compliance: a round must last at least `minimumRoundDuration`
      // ms (the platform hints it; the GAME enforces it). Pad with the Pixi-synced
      // ticker — never setTimeout (slotplate principle #2).
      const minMs = hud.ui.minimumRoundDuration;
      const remaining = minMs - (performance.now() - startedAt);
      if (remaining > 0) await new Promise<void>((r) => ticker.schedule(remaining, r));
      hud.reportRound(stores.balance.lastWin, stake);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.match(/ERR_[A-Z_]+/)?.[0];
      if (code) hud.showRgsError(code);
      else hud.showError(msg);
    } finally {
      ui.spin.idle();
    }
  }

  function buildSpec(session: SessionResponse): UISpec {
    const idx = Math.max(0, AVAILABLE_BETS.indexOf(GAME.defaultBet as (typeof AVAILABLE_BETS)[number]));
    return {
      theme: 'default',
      currency: currencyFor(session.currency),
      betLadder: { levels: [...AVAILABLE_BETS], index: idx },
      turbo: { modes: 2 },
      autoplay: { mode: 'options', options: [10, 25, 50, 100, Infinity] },
      spin: { press: 'tap' },
      // Compliance readouts (RTP / net / session) render as the top-left block;
      // the jurisdiction switchboard (which to show) is applied at runtime from
      // the RGS. The RTP figure itself:
      rtp: session.rtp ?? 96,
      game: { name: GAME.title, version: '1.0.0' },
      // The ☰ menu is the white HTML menu (mountHtmlMenu) — see wireHud.
    };
  }

  /** Rules blocks for the white HTML menu (Settings → Paytable → Rules). */
  function menuRules(session: SessionResponse): BlockSpec[] {
    return [
      { kind: 'heading', id: 'r-h', text: 'How to play' },
      {
        kind: 'text',
        id: 'r-1',
        text: 'Land **consecutive digits** on a line to form a number — and win **that number**. Lines are the 3 columns (read top→bottom) and the 2 diagonals. A leading zero is dropped.',
      },
      {
        kind: 'steps',
        id: 'r-steps',
        ordered: true,
        items: ['Set your stake with the bet ± ', 'Press SPIN', 'A column of digits = a winning number'],
      },
      { kind: 'heading', id: 'r-h2', text: 'Vortex' },
      {
        kind: 'text',
        id: 'r-2',
        text: 'The **Vortex** fills a whole column with digits, making a number near-certain. It strikes at random in the base game — or open the **buy feature** to activate the Vortex ante and force one every spin.',
      },
      {
        kind: 'stat-grid',
        id: 'r-stats',
        items: [
          { label: 'RTP', value: `${(session.rtp ?? 96).toFixed(1)}%` },
          { label: 'Vortex ante', value: `+${Math.round((GAME.vortexAnte - 1) * 100)}%` },
          { label: 'Lines', value: '3 cols · 2 diag' },
        ],
      },
    ];
  }

  async function wireHud(session: SessionResponse): Promise<void> {
    const art = await loadHudArt();
    hud = mountHud(scene.app, buildSpec(session), {
      gsap,
      menu: false, // we supply our own white HTML menu (mountHtmlMenu) below
      spinSkin: art.spinSkin,
      icons: art.icons,
    });
    const ui = hud.ui;

    // ── Stake Engine compliance ──────────────────────────────────────────────
    // Apply the RGS jurisdiction switchboard (disable features + reveal the
    // mandated RTP / net-position / session-timer readouts), set the RTP figure,
    // and enter replay mode when launched via Stake `replay=true`.
    if (session.rtp != null) hud.setRtp(session.rtp);
    hud.applyJurisdiction(session.jurisdiction ?? {});
    if (getReplayParams()) hud.setReplay(true);

    // Feed the live HUD control bounds to the scene so the reel safe area sits
    // below the top status bar and above the spin-button cluster, then reflow.
    scene.setControlBounds(() =>
      hud ? hud.snapshot().map((c) => c.bounds).filter((b): b is NonNullable<typeof b> => b != null) : [],
    );
    resizeObject.remeasure();

    // Dev-only spin hook for the preview harness (the HUD renders into the Pixi
    // canvas, so there is no DOM button to click in automated checks).
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).__stakeplate = { hud, fsm, stores, spin: () => runRound() };
    }

    hudDisposers.push(
      ui.on('spinRequested', () => {
        void runRound();
      }),
    );
    hudDisposers.push(ui.on('skipRequested', () => reels?.forceStop()));

    // Vortex ante: the bonus (cart) button opens the open-slot-ui buy-feature
    // MODAL — a Vortex CARD with an Activate toggle (a 'boost' = bet surcharge).
    // Activating raises the stake to vortexAnte× and forces a digit column every
    // spin; a vortex can also spawn for free at random in base mode.
    const closeBuyModal = mountBuyFeatureModal(
      scene.app,
      hud,
      [{ id: 'vortex', name: 'Vortex', variant: 'boost', cost: GAME.vortexAnte - 1, image: VORTEX_CARD_ART }],
      {
        activation: 'single',
        onActivate: (_ids, _id, active) => stores.ui.setVortexActive(active),
      },
    );
    hudDisposers.push(closeBuyModal);

    // The ☰ menu: a white HTML sheet (Settings → Paytable → Rules), opened by the
    // canvas menu button via ui.settingsPanel. White + gold, theme-independent,
    // matching the buy-feature modal.
    const closeMenu = mountHtmlMenu(scene.app, hud, {
      gameName: GAME.title,
      paytable: [
        { symbol: '2-digit number', payouts: '2×' },
        { symbol: '3-digit number', payouts: '10×' },
      ],
      rules: menuRules(session),
    });
    hudDisposers.push(closeMenu);
    hudDisposers.push(
      ui.on('autoplayStarted', async () => {
        while (ui.autoplay.isActive) {
          if (ui.balance.get() < ui.bet.get()) {
            ui.autoplay.stop();
            break;
          }
          await runRound();
        }
      }),
    );
    hudDisposers.push(
      ui.on('toggled', ({ id, on }) => {
        if (id === 'turbo') stores.ui.setSpeed(on ? 'turbo' : 'normal');
      }),
    );

    // Mirror the authoritative store balance into the HUD readout.
    hudDisposers.push(
      reaction(
        () => stores.balance.balance,
        (b) => hud?.setBalance(b),
        { fireImmediately: true },
      ),
    );
  }

  return {
    container,
    ...(testBridge ? { testBridge } : {}),
    async start() {
      try {
        await scene.init(host);
        resizeObject.remeasure();

        stores.ui.setBootStage('session');
        stores.ui.setLoadProgress(0.1);
        const session = await network.session({});
        stores.ui.setSession(session.sessionId, session.currency);
        stores.balance.setBalance(session.balance);
        stores.balance.setBet(session.defaultBet);
        stores.ui.setLoadProgress(0.45);

        stores.ui.setBootStage('assets');
        await assets.loadAll((p) => stores.ui.setLoadProgress(0.45 + p * 0.3));
        await scene.loadAssets();
        stores.ui.setLoadProgress(1);

        const engine = useStubs ? new StubReelsEngine() : scene.createReelsEngine(() => stores.ui.speed);
        reels = new ReelsPresenter(engine);
        fsm.patchContext({ reels });

        const bgLayer = scene.backgroundLayer;
        if (bgLayer) container.register(Tokens.Background, () => new BackgroundPresenter(bgLayer));

        testBridge?.attachApp(scene.app);
        if (testBridge) {
          inspectorChannel = new InspectorChannel(testBridge);
          const params = new URLSearchParams(window.location.search);
          const inspectorOff = params.get('inspector') === '0' || params.get('inspector') === 'off';
          if (!inspectorOff) inspectorDisposer = mountInspector(testBridge, inspectorChannel);
        }

        // Mount the open-ui HUD (one call) and bridge it to the FSM/stores.
        if (!useStubs) await wireHud(session);

        stores.ui.setBootStage('ready');
        // Hide the static boot loader overlay from index.html (its id selector
        // beats `[hidden]`, so trigger the `data-done` fade hook instead).
        const loader = document.getElementById('sp-loader');
        if (loader) loader.dataset.done = '1';
        await fsm.transition('idle');
      } catch (err) {
        stores.ui.setLoadError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    dispose() {
      inspectorDisposer?.();
      inspectorDisposer = null;
      inspectorChannel?.dispose();
      inspectorChannel = null;
      for (const d of hudDisposers.splice(0)) d();
      hud?.dispose();
      hud = null;
      sfxDisposer();
      network.dispose?.();
      scene.dispose();
    },
  };
}
