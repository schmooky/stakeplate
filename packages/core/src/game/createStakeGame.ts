// createStakeGame — the one-call façade. `start()` runs the whole compliant boot with
// zero game involvement: runtime → network → HUD → (replay | authenticate → configure
// HUD → resume active round → wire events) → run the FSM. Connection/auth failure →
// the themed, blocking showBootError. The game supplies only config + interpretBook +
// mountView (+ optional Present phase, audio). This is the ONLY module that imports the
// HUD/pixi peers; the engine stays decoupled behind ports.

import { Application } from 'pixi.js';
import { mountHud, showBootError, mountBuyFeatureModal, type BootedHud, type FeatureSpec } from '@open-slot-ui/pixi';
import { loadBuiltinArt } from '@open-slot-ui/pixi/art';
import { resolveCurrency, isSocialCurrency } from '@open-slot-ui/core';
import { reaction } from 'mobx';
import { readRuntime, type RuntimeConfig } from '../rgs/runtime';
import { createNetwork, type NetworkManager } from '../rgs/network';
import { API_AMOUNT_MULTIPLIER, type Round } from '../rgs/protocol';
import { RootStore } from '../stores/index';
import { RealTicker, type Ticker } from '../engine/ticker';
import { TurboClock, type TurboState } from '../engine/turbo';
import { FSM, type AudioPort, type Phase, type PhaseContext } from '../engine/fsm';
import { defaultPhases } from '../engine/phases';
import { roundInfo, type InterpretBook } from '../engine/round';
import { bindMixerToHud, type MixerLike } from '../audio/bind';
import type { GameAudioOptions, SoundEntry } from '../audio';
import { modeCostOf, type GameConfig } from './config';

/**
 * Declarative audio: hand the core your sounds and it lazily creates the `@schmooky/zvuk`
 * mixer (master → music/sfx/ambience buses + ducking), preloads them, and auto-binds it to
 * the HUD (sliders/mute + unlock). zvuk loads in its OWN async chunk — a game without sound
 * pays nothing. (Advanced: pass a ready `GameAudio` instance instead, for custom buses/FX.)
 */
export interface AudioSpec extends GameAudioOptions {
  sounds: SoundEntry[];
}

/** Passed to `mountView` — everything the game's scene needs (not the round/fsm yet). */
export interface ViewContext {
  config: GameConfig;
  stores: RootStore;
  hud: BootedHud;
  ticker: Ticker;
  audio: AudioPort | null;
  /** Turbo speed + slam-stop (core-owned) — the scene may branch on `turbo.level`/`speed`. */
  turbo: TurboState;
}

export interface CreateStakeGameOptions<T = unknown, V = unknown, E = unknown> {
  config: GameConfig;
  /** The game's ONE money seam: typed RGS round (`Round<E>`) → your model. Pure. */
  interpretBook: InterpretBook<T, E>;
  /** Mount the game's pixi scene/presenter/stores; returns the view handed to phases. */
  mountView: (host: HTMLElement, ctx: ViewContext) => V;
  /** The game's Present phase (+ any overrides); Idle/Spin/Settle are provided. */
  phases?: Phase<T, V, E>[];
  /** Sounds (declarative — the core builds + wires the mixer) OR a ready `GameAudio`/AudioPort. */
  audio?: AudioPort | AudioSpec | null;
  /** Override the transport (tests / a supplied mock). */
  network?: NetworkManager;
  /** Override launch params (tests / embedding). */
  runtime?: Partial<RuntimeConfig>;
  /** Host for the pixi HUD canvas (default document.body). */
  hudHost?: HTMLElement;
  /** Host for the game scene (default = hudHost). */
  sceneHost?: HTMLElement;
  /** Passthrough to `mountHud` (spinSkin, icons, gsap, menu:false, hooks, …). */
  hudOptions?: Record<string, unknown>;
}

/**
 * Stake policy: buys/activations costing more than this many × base bet require a confirm
 * (no one-click). A buy-feature always costs far more than 2×, so in practice this means
 * "always confirm a buy". The jurisdiction (`auth.config.jurisdiction`) may override it; a
 * game never sets it — it's compliance, not design.
 */
const STAKE_CONFIRM_ABOVE_COST = 2;

/** Server/replay-sourced values that drive the HUD spec — never taken from the game config. */
interface HudSpecInput {
  currency: string;
  betLevels: number[]; // major units — the authoritative ladder
  defaultBet: number; // major units
  rtp: number; // display %
  confirmBuyAboveCost: number; // jurisdiction policy
}

/** A read-only snapshot of the running game — for the dev harness, tests and debugging. */
export interface GameSnapshot {
  phase: string;
  balance: number;
  bet: number;
  lastWin: number;
  currency: string;
  spinning: boolean;
}

export interface StakeGame {
  start(): Promise<void>;
  dispose(): void;
  /** Current phase + store values. The declarative harness asserts on this (no screenshots). */
  inspect(): GameSnapshot;
  /** Trigger a spin the same way the HUD spin button does — only from Idle. For harness/tests. */
  requestSpin(): boolean;
}

export function createStakeGame<T = unknown, V = unknown, E = unknown>(opts: CreateStakeGameOptions<T, V, E>): StakeGame {
  const runtime = readRuntime({ overrides: opts.runtime });
  const network = opts.network ?? createNetwork(runtime);
  const stores = new RootStore();
  const ticker = new RealTicker();
  const turbo = new TurboClock(opts.config.turboSpeeds); // core-owned turbo speed + slam-stop
  // A ready AudioPort instance is used as-is; an AudioSpec is resolved lazily in start()
  // (the core creates the zvuk mixer from its own async chunk) — see resolveAudio().
  let audio: AudioPort | null = opts.audio && !isAudioSpec(opts.audio) ? opts.audio : null;
  const app = new Application();
  const disposers: Array<() => void> = [];
  let hud: BootedHud | null = null;
  let fsm: FSM<T, V, E> | null = null;

  // The battery wires the library's DESIGNED default icon set (the white Figma coins +
  // rotating-arrows spin skin) so every game gets the intended HUD out of the box — not
  // the lib's no-art placeholder geometry. `loadBuiltinArt` pulls the whole /art bundle
  // once; a game overrides any icon or the spin skin via `hudOptions.icons`/`spinSkin`.
  let builtinArt: ReturnType<typeof loadBuiltinArt> | null = null;
  const hudOpts = async (): Promise<Record<string, unknown>> => {
    builtinArt ??= loadBuiltinArt();
    const art = await builtinArt;
    const user = (opts.hudOptions ?? {}) as { icons?: Record<string, unknown>; spinSkin?: unknown };
    return {
      spinSkin: art.spinSkin,
      ...user,
      icons: { ...(art.icons as Record<string, unknown>), ...(user.icons ?? {}) },
    };
  };

  // The HUD spec is driven by SERVER-authoritative values (the ladder + confirm policy come
  // from `authenticate`/jurisdiction, not the game). `buildSpec` just formats them.
  const buildSpec = (s: HudSpecInput): Record<string, unknown> => ({
    currency: resolveCurrency(s.currency),
    betLadder: { levels: s.betLevels, index: Math.max(0, s.betLevels.indexOf(s.defaultBet)) },
    rtp: s.rtp,
    game: { name: opts.config.title, version: opts.config.version ?? '1.0.0' },
    // Stake owns fullscreen in its iframe — the game must not render its own. The bonus
    // (buy-feature) button shows only when a mode is a buy/boost card — it opens the feature list.
    controls: { fullscreen: { hidden: true }, ...(buyFeaturesOf(opts.config).length ? { bonus: { hidden: false } } : {}) },
    // Compliance: the buy-feature confirm threshold is jurisdiction policy, not a game knob.
    buyFeature: { confirmAboveCost: s.confirmBuyAboveCost },
    ...(opts.config.rules ? { menu: opts.config.rules } : {}),
    locale: {
      locale: runtime.language,
      messages: opts.config.messages ?? { en: {} },
      ...(opts.config.socialMessages ? { socialMessages: opts.config.socialMessages } : {}),
    },
    ...(opts.config.spec ?? {}),
  });

  const initApp = async (host: HTMLElement): Promise<void> => {
    await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(app.canvas);
  };

  // Build the mixer from a declarative AudioSpec. The `@stakeplate/core/audio` module (the
  // ONLY thing that pulls @schmooky/zvuk) is loaded via a DYNAMIC import, so it lands in its
  // own async chunk — an audio-less game never fetches zvuk. Sounds preload in the background.
  const resolveAudio = async (): Promise<void> => {
    if (!isAudioSpec(opts.audio)) return;
    const { createGameAudio } = await import('../audio');
    const mixer = createGameAudio(opts.audio);
    void mixer.load(opts.audio.sounds);
    audio = mixer;
  };

  async function start(): Promise<void> {
    const hudHost = opts.hudHost ?? document.body;
    const sceneHost = opts.sceneHost ?? hudHost;
    const phases = [...defaultPhases<T, V, E>(), ...(opts.phases ?? [])];
    const machine = (fsm = new FSM<T, V, E>(phases)); // outer `fsm` powers inspect()/requestSpin()
    await resolveAudio(); // if `audio` is an AudioSpec, build the zvuk mixer (lazy chunk) + preload

    // ── REPLAY (Stake ?replay=true): fetch a round + play it back read-only ──────
    if (runtime.replay.active && network.replay) {
      try {
        await initApp(hudHost);
        const cur = runtime.currency;
        const bet = runtime.replay.amount || 1; // replay carries its own bet; no ladder needed
        hud = mountHud(app, buildSpec({ currency: cur, betLevels: [bet], defaultBet: bet, rtp: opts.config.rtp ?? 96, confirmBuyAboveCost: STAKE_CONFIRM_ABOVE_COST }), (await hudOpts()) as never);
        stores.session.set({ currency: cur });
        stores.balance.setBalance(0);
        stores.balance.setBet(bet);
        if (runtime.social) hud.setSocial(true);
        const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio, turbo });
        hud.setReplay(true);
        hud.lockInput();
        const cost = modeCostOf(opts.config, runtime.replay.mode);
        const raw = (await network.replay({ ...runtime.replay })) as Round<E>;
        const info = roundInfo(raw, bet, cost);
        const ctx = makeCtx(machine, view);
        ctx.round = { ...info, data: opts.interpretBook(raw, info), active: false, balance: 0, raw };
        const replayInfo = { baseBet: bet, costMultiplier: cost, payoutMultiplier: info.multiplier, amount: info.totalWin, currency: resolveCurrency(cur) };
        const playRound = async (): Promise<void> => {
          stores.ui.setSpinning(true);
          await machine.transition('present'); // game's Present plays it back → settle → idle
          hud!.replayEnd(replayInfo, () => void playRound());
        };
        hud.replayStart(replayInfo, () => void playRound());
      } catch (err) {
        showBootError({ title: 'Cannot load the replay', message: 'The recorded round could not be loaded. Please reload to try again.', detail: errMsg(err) });
      }
      return;
    }

    // ── NORMAL BOOT ─────────────────────────────────────────────────────────────
    let auth;
    try {
      await initApp(hudHost);
      auth = await network.authenticate();
    } catch (err) {
      showBootError({
        title: 'Cannot reach the game server',
        message: 'The game could not connect to or authenticate with the game server. Please reload to try again.',
        detail: errMsg(err),
      });
      return;
    }

    // Everything the HUD needs is SERVER-authoritative (from `authenticate`): the bet
    // ladder + default bet (per currency/jurisdiction), RTP, and the buy-confirm policy.
    const currency = auth.balance.currency;
    const juris = auth.config.jurisdiction ?? {};
    const rtp = auth.config.rtp ?? opts.config.rtp ?? 96;
    const betLevels = auth.config.betLevels.map((b) => b / API_AMOUNT_MULTIPLIER);
    const active = auth.round;
    const activeCost = active?.active ? modeCostOf(opts.config, active.mode) : 1;
    const defaultBet = active?.active
      ? active.amount / API_AMOUNT_MULTIPLIER / activeCost // resume: restore bet from the active amount
      : auth.config.defaultBetLevel / API_AMOUNT_MULTIPLIER;
    const confirmBuyAboveCost = juris.confirmBuyAboveCost ?? STAKE_CONFIRM_ABOVE_COST;

    hud = mountHud(app, buildSpec({ currency, betLevels, defaultBet, rtp, confirmBuyAboveCost }), (await hudOpts()) as never);
    hud.setCurrency(resolveCurrency(currency));
    hud.applyJurisdiction(juris);
    if (runtime.social || isSocialCurrency(currency)) hud.setSocial(true);

    stores.session.set({
      sessionId: runtime.sessionId,
      currency,
      rtp,
      availableBets: betLevels,
      jurisdiction: juris,
    });
    stores.balance.setBet(defaultBet);
    hud.setBet(defaultBet);

    const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio, turbo });
    const ctx = makeCtx(machine, view);

    // reactions store→HUD + HUD events
    disposers.push(reaction(() => stores.balance.balance, (b) => hud!.setBalance(b), { fireImmediately: false }));
    // The bet stepper is the base-bet source of truth. It emits `valueChanged` with
    // `id: 'bet-stepper'` and the ladder value (never the boosted display), so this feeds the
    // BASE bet even while an ante is active. (The lib mirrors it into `ui.bet`; the boost
    // reaction then overwrites the readout with the effective stake.)
    disposers.push(hud.on('valueChanged', (p) => { const v = p as { id?: string; value?: number }; if (v?.id === 'bet-stepper' && typeof v.value === 'number') stores.balance.setBet(v.value); }));
    // ── Spin triggers + turbo speed + autoplay (ALL core-owned) ─────────────────
    // One entry point for every spin: clears the slam-stop flag, then spins from idle.
    const beginSpin = (): void => {
      if (machine.current !== 'idle') return;
      turbo.resetSkip();
      void machine.transition('spin');
    };
    let holdActive = false; // press-and-hold turbo spin
    disposers.push(hud.on('spinRequested', beginSpin));
    // Autoplay/hold: the HUD owns the count picker, remaining count + RG limits (via
    // reportRound); the CORE runs the loop. Start on the first tick, then re-spin below.
    disposers.push(hud.on('autoplayStarted', beginSpin));
    disposers.push(hud.on('holdSpinStarted', () => { holdActive = true; beginSpin(); }));
    disposers.push(hud.on('holdSpinStopped', () => { holdActive = false; }));
    // Turbo speed (2-/3-mode cycler) + slam-stop (tap-to-skip the reels).
    disposers.push(hud.on('turboChanged', (p) => { const e = p as { index?: number }; if (typeof e.index === 'number') turbo.setLevel(e.index); }));
    disposers.push(hud.on('skipRequested', () => turbo.skip()));
    // Buy-feature: the bonus button opens the lib's feature-LIST modal (a card per buyable
    // mode). Two kinds of card, both routed through the jurisdiction confirm gate (no one-click
    // above the threshold):
    //  • `buy`   → one-shot. On confirm, spin that mode ONCE (SpinPhase charges its full cost).
    //  • `boost` → a persistent ante. Activating sets it as the ACTIVE mode, so every following
    //    base spin plays it at its full `cost×` (via `nextMode()`); toggling off restores base.
    // The modal owns opening/closing/confirm + single-activation; the core supplies the cards +
    // the onBuy/onActivate hooks and reflects the boosted stake in the bet readout.
    const features = buyFeaturesOf(opts.config);
    if (features.length) {
      // The bet readout shows the EFFECTIVE stake (base × the active ante's cost, emphasised)
      // while a boost is on, and the plain base bet otherwise — re-applied on bet/mode change.
      const applyBetDisplay = (): void => {
        const boost = stores.ui.activeMode;
        const cost = boost ? modeCostOf(opts.config, boost) : 1;
        hud!.ui.bet.set(stores.balance.bet * cost);
        (hud!.ui.bet as unknown as { setEmphasis?: (on: boolean) => void }).setEmphasis?.(cost !== 1);
      };
      disposers.push(
        mountBuyFeatureModal(app, hud, features, {
          activation: 'single', // one ante at a time (Stake)
          getBet: () => stores.balance.bet, // the base bet — the readout shows the boosted stake
          onBuy: (id) => {
            if (machine.current !== 'idle') return;
            stores.ui.setOneShotMode(id);
            beginSpin();
          },
          onActivate: (ids) => {
            stores.ui.setActiveMode(ids[0] ?? null); // persistent ante; nextMode() prefers it
            applyBetDisplay();
          },
        }),
      );
      disposers.push(reaction(() => [stores.balance.bet, stores.ui.activeMode] as const, applyBetDisplay));
    }
    // Keep spinning while autoplay/hold is active: after each settled round (spinning
    // true → false), once idle, pause the (turbo-scaled) gap and spin again — stopping on
    // a blocking notice/error or when the next base stake is unaffordable.
    const autoplayGapMs = opts.config.autoplayGapMs ?? 250;
    disposers.push(
      reaction(
        () => stores.ui.spinning,
        (spinning, prev) => {
          if (prev !== true || spinning !== false) return;
          void turbo.delay(autoplayGapMs).then(() => {
            if (machine.current !== 'idle') return;
            if (!hud!.ui.autoplay.isActive && !holdActive) return;
            if (hud!.ui.noticeBlocks.get().length > 0 || stores.balance.balance < stores.balance.bet) {
              hud!.ui.autoplay.stop();
              holdActive = false;
              return;
            }
            beginSpin();
          });
        },
      ),
    );

    // Auto-wire audio ↔ HUD (Music/Effects sliders + mute, persisted) + unlock on the first
    // spin gesture — IF a mixer-like `audio` was provided. Structural check, no @schmooky/zvuk
    // import here, so audio-less games don't bundle it. (A game may bind manually instead.)
    const mixer = audio as unknown as MixerLike | null;
    if (mixer && typeof mixer.setGroupLevel === 'function') {
      disposers.push(bindMixerToHud(mixer, hud));
      if (typeof mixer.unlock === 'function') {
        const off = hud.on('spinRequested', () => { void mixer.unlock!(); off(); });
        disposers.push(off);
      }
    }

    // ── ACTIVE-ROUND RESUME: settle it + play it back, else idle ────────────────
    if (active?.active) {
      const end = await network.endRound();
      const raw = active as Round<E>;
      const info = roundInfo(raw, defaultBet, activeCost);
      stores.balance.setBalance(end.balance.amount / API_AMOUNT_MULTIPLIER);
      ctx.round = { ...info, data: opts.interpretBook(raw, info), active: false, balance: end.balance.amount / API_AMOUNT_MULTIPLIER, raw };
      await machine.transition('present'); // view plays it back → settle → idle
    } else {
      stores.balance.setBalance(auth.balance.amount / API_AMOUNT_MULTIPLIER);
      await machine.transition('idle');
    }
  }

  function makeCtx(fsm: FSM<T, V, E>, view: V): PhaseContext<T, V, E> {
    const ctx: PhaseContext<T, V, E> = {
      config: opts.config,
      stores,
      network,
      hud: hud as BootedHud,
      ticker,
      view,
      audio,
      turbo,
      interpretBook: opts.interpretBook,
      fsm,
      round: null,
      modeCost: (mode) => modeCostOf(opts.config, mode),
    };
    fsm.bind(ctx);
    return ctx;
  }

  function dispose(): void {
    for (const d of disposers.splice(0)) d();
    hud?.dispose();
    app.destroy(true);
  }

  function inspect(): GameSnapshot {
    return {
      phase: fsm?.current ?? 'boot',
      balance: stores.balance.balance,
      bet: stores.balance.bet,
      lastWin: stores.balance.lastWin,
      currency: stores.session.currency,
      spinning: stores.ui.spinning,
    };
  }

  function requestSpin(): boolean {
    if (!fsm || fsm.current !== 'idle') return false;
    void fsm.transition('spin');
    return true;
  }

  return { start, dispose, inspect, requestSpin };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** An AudioSpec (declarative sounds) vs a ready AudioPort/GameAudio instance. */
function isAudioSpec(a: unknown): a is AudioSpec {
  return !!a && typeof a === 'object' && Array.isArray((a as AudioSpec).sounds);
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The buyable/activatable modes (`modes.<key>.buy` / `.boost`) as buy-feature cards — the
 *  list the bonus button opens. A plain number mode or one without `buy`/`boost` is not a card.
 *  `cost` in config is the FULL play multiplier (× bet); a boost card shows the SURCHARGE it
 *  adds over a base spin (`cost − 1`, e.g. a 2× ante → `+1× bet`), so the card + confirm read
 *  right while the mode is still charged its full `cost` when it spins. */
function buyFeaturesOf(config: GameConfig): FeatureSpec[] {
  const out: FeatureSpec[] = [];
  for (const [key, m] of Object.entries(config.modes ?? {})) {
    if (!m || typeof m !== 'object' || !(m.buy || m.boost)) continue;
    const variant = m.boost ? 'boost' : 'buy';
    out.push({ id: key, name: m.name ?? capitalize(key), variant, cost: variant === 'boost' ? m.cost - 1 : m.cost, image: m.image });
  }
  return out;
}
