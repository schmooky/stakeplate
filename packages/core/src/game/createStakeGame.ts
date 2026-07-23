// createStakeGame — the one-call façade. `start()` runs the whole compliant boot with
// zero game involvement: runtime → network → HUD → (replay | authenticate → configure
// HUD → resume active round → wire events) → run the FSM. Connection/auth failure →
// the themed, blocking showBootError. The game supplies only config + interpretBook +
// mountView (+ optional Present phase, audio). This is the ONLY module that imports the
// HUD/pixi peers; the engine stays decoupled behind ports.

import { Application } from 'pixi.js';
import { mountHud, showBootError, mountBuyFeatureModal, type BootedHud, type FeatureSpec } from '@open-slot-ui/pixi';
import { loadBuiltinArt } from '@open-slot-ui/pixi/art';
import { isSocialCurrency } from '@open-slot-ui/core';
import { currencyFor } from '../currency';
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
import { bindInputSounds, type InputSoundMap } from '../audio/inputs';
import type { GameAudioOptions, SoundEntry } from '../audio';
import { createLoader, type GameLoader, type LoaderConfig } from '../loader';
import { modeCostOf, type GameConfig } from './config';

/**
 * Declarative audio: hand the core your sounds and it lazily creates the `@schmooky/zvuk`
 * mixer (master → music/sfx/ambience buses + ducking), preloads them, and auto-binds it to
 * the HUD (sliders/mute + unlock). zvuk loads in its OWN async chunk — a game without sound
 * pays nothing. (Advanced: pass a ready `GameAudio` instance instead, for custom buses/FX.)
 */
export interface AudioSpec extends GameAudioOptions {
  sounds: SoundEntry[];
  /** Optional: play a cue on HUD input events (spin/bet/autoplay/turbo/toggle/skip). The
   *  core auto-binds these after the HUD mounts — the named sounds must be in `sounds`. */
  inputSounds?: InputSoundMap;
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
  /** The boot loader (if `loader` was configured) — drive `setProgress` while your scene
   *  loads art, and (with `loader.manual`) call `done()` when the scene is ready. `null`
   *  when no loader is used. */
  loader: GameLoader | null;
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
  /**
   * A configurable boot loader — shows the instant boot starts, advances across the boot
   * milestones, then fills + pops away when the game is ready. Pass a {@link LoaderConfig}
   * to enable it (title defaults to `config.title`); omit or `false` to render none (the
   * game keeps its own HTML loader). With `manual: true`, call `ctx.loader.done()` yourself
   * (e.g. after the scene's art finishes loading).
   */
  loader?: LoaderConfig | false;
}

/**
 * Stake policy: buys/activations costing more than this many × base bet require a confirm
 * (no one-click). A buy-feature always costs far more than 2×, so in practice this means
 * "always confirm a buy". The jurisdiction (`auth.config.jurisdiction`) may override it; a
 * game never sets it — it's compliance, not design.
 */
const STAKE_CONFIRM_ABOVE_COST = 2;

/** Fallback min-payout coefficient used ONLY when `config.minBet` is unset: the
 *  currency-derived floor is `minUnit / MIN_PAYOUT_COEF` (= 5 minimal units at 0.2). */
const MIN_PAYOUT_COEF = 0.2;

/** Persisted player UI preferences (sound mute + turbo mode). Best-effort — every access
 *  is guarded: Safari Private Browsing, a cross-origin-iframe storage block, or a hardened
 *  session throws on access, so this degrades to "no persistence", never into the boot. */
const PREFS_KEY = 'stakeplate.prefs';
interface GamePrefs {
  muted?: boolean;
  turbo?: number;
}
function readPrefs(): GamePrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as GamePrefs;
  } catch {
    return {};
  }
}
function writePrefs(patch: GamePrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* storage disabled / full — preferences just won't persist this session */
  }
}

/** Drop server bet-ladder levels below the minimum bet — the explicit `config.minBet`, else
 *  the currency-derived floor (5 minimal units) — so the smallest win can't round below one
 *  minimal unit. Never returns empty (keeps the largest level if every level is below). */
function applyMinBet(levels: number[], minBet: number | undefined, decimals: number): number[] {
  const minUnit = 10 ** -decimals;
  const floor = minBet ?? minUnit / MIN_PAYOUT_COEF;
  const filtered = levels.filter((b) => b >= floor - minUnit / 1000);
  return filtered.length ? filtered : [Math.max(...levels)];
}

/** Snap a wanted bet up to the first ladder level that is >= it (or the closest). */
function snapToLadder(levels: number[], want: number): number {
  if (levels.includes(want)) return want;
  return levels.find((b) => b >= want) ?? levels[levels.length - 1] ?? want;
}

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
  let loader: GameLoader | null = null;

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
  const buildSpec = (s: HudSpecInput, extra?: { hideBalance?: boolean }): Record<string, unknown> => ({
    currency: currencyFor(s.currency),
    betLadder: { levels: s.betLevels, index: Math.max(0, s.betLevels.indexOf(s.defaultBet)) },
    rtp: s.rtp,
    game: { name: opts.config.title, version: opts.config.version ?? '1.0.0' },
    // Stake owns fullscreen in its iframe — the game must not render its own. The bonus
    // (buy-feature) button shows only when a mode is a buy/boost card — it opens the feature list.
    // Replay mode has no wallet (it's a recorded round) — Stake approval: show NO balance
    // readout; the round's facts live in the replay panel instead.
    controls: {
      fullscreen: { hidden: true },
      ...(buyFeaturesOf(opts.config).length ? { bonus: { hidden: false } } : {}),
      ...(extra?.hideBalance ? { balance: { hidden: true } } : {}),
    },
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
    // Boot loader: paint it BEFORE anything heavy loads, then advance it across the milestones
    // below (init → auth → HUD → view) and fill + pop it away once the game is ready. `false`
    // (the default) renders none, so a game keeps whatever loader its HTML already has.
    if (opts.loader) loader = createLoader({ title: opts.config.title, ...opts.loader });
    const manualLoader = !!(opts.loader && opts.loader.manual);
    const phases = [...defaultPhases<T, V, E>(), ...(opts.phases ?? [])];
    const machine = (fsm = new FSM<T, V, E>(phases)); // outer `fsm` powers inspect()/requestSpin()
    loader?.setProgress(0.1);
    await resolveAudio(); // if `audio` is an AudioSpec, build the zvuk mixer (lazy chunk) + preload

    // ── REPLAY (Stake ?replay=true): fetch a round + play it back read-only ──────
    if (runtime.replay.active && network.replay) {
      try {
        await initApp(hudHost);
        loader?.setProgress(0.5);
        const cur = runtime.currency;
        const bet = runtime.replay.amount || 1; // replay carries its own bet; no ladder needed
        hud = mountHud(app, buildSpec({ currency: cur, betLevels: [bet], defaultBet: bet, rtp: opts.config.rtp ?? 96, confirmBuyAboveCost: STAKE_CONFIRM_ABOVE_COST }, { hideBalance: true }), (await hudOpts()) as never);
        stores.session.set({ currency: cur });
        stores.balance.setBalance(0);
        stores.balance.setBet(bet);
        if (runtime.social) hud.setSocial(true);
        loader?.setProgress(0.85);
        const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio, turbo, loader });
        hud.setReplay(true);
        hud.lockInput();
        const cost = modeCostOf(opts.config, runtime.replay.mode);
        const raw = (await network.replay({ ...runtime.replay })) as Round<E>;
        const info = roundInfo(raw, bet, cost);
        const ctx = makeCtx(machine, view);
        ctx.round = { ...info, data: opts.interpretBook(raw, info), active: false, balance: 0, raw };
        const replayInfo = { baseBet: bet, costMultiplier: cost, payoutMultiplier: info.multiplier, amount: info.totalWin, currency: currencyFor(cur) };
        const playRound = async (): Promise<void> => {
          stores.ui.setSpinning(true);
          await machine.transition('present'); // game's Present plays it back → settle → idle
          hud!.replayEnd(replayInfo, () => void playRound());
        };
        hud.replayStart(replayInfo, () => void playRound());
        if (!manualLoader) void loader?.done();
      } catch (err) {
        loader?.remove();
        showBootError({ title: 'Cannot load the replay', message: 'The recorded round could not be loaded. Please reload to try again.', detail: errMsg(err) });
      }
      return;
    }

    // ── NORMAL BOOT ─────────────────────────────────────────────────────────────
    let auth;
    try {
      await initApp(hudHost);
      loader?.setProgress(0.35);
      auth = await network.authenticate();
      loader?.setProgress(0.6);
    } catch (err) {
      loader?.remove();
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
    // Server ladder, trimmed by the client min-bet floor (explicit `config.minBet`, else the
    // currency-derived 5-minimal-units) so the smallest possible win can't round to sub-unit.
    const rawLevels = auth.config.betLevels.map((b) => b / API_AMOUNT_MULTIPLIER);
    const betLevels = applyMinBet(rawLevels, opts.config.minBet, currencyFor(currency).decimals ?? 2);
    const active = auth.round;
    const activeCost = active?.active ? modeCostOf(opts.config, active.mode) : 1;
    // Wanted default (restored from the active bet on resume), snapped up to the first legal
    // (floored) level so the ladder + store agree.
    const wantedDefault = active?.active
      ? active.amount / API_AMOUNT_MULTIPLIER / activeCost // resume: restore bet from the active amount
      : auth.config.defaultBetLevel / API_AMOUNT_MULTIPLIER;
    const defaultBet = snapToLadder(betLevels, wantedDefault);
    const confirmBuyAboveCost = juris.confirmBuyAboveCost ?? STAKE_CONFIRM_ABOVE_COST;

    hud = mountHud(app, buildSpec({ currency, betLevels, defaultBet, rtp, confirmBuyAboveCost }), (await hudOpts()) as never);
    hud.setCurrency(currencyFor(currency));
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
    loader?.setProgress(0.8);

    const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio, turbo, loader });
    const ctx = makeCtx(machine, view);
    loader?.setProgress(0.95);

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
    // Autoplay/hold both shorten game animations (turbo.setAutoplay) so long auto sessions
    // don't crawl. It's a floor on turbo speed — a faster turbo level still wins.
    disposers.push(hud.on('autoplayStarted', () => { turbo.setAutoplay(true); beginSpin(); }));
    disposers.push(hud.on('autoplayStopped', () => { turbo.setAutoplay(holdActive); }));
    disposers.push(hud.on('holdSpinStarted', () => { holdActive = true; turbo.setAutoplay(true); beginSpin(); }));
    disposers.push(hud.on('holdSpinStopped', () => { holdActive = false; turbo.setAutoplay(hud!.ui.autoplay.isActive); }));
    // Turbo speed (2-/3-mode cycler) + slam-stop (tap-to-skip the reels).
    disposers.push(hud.on('turboChanged', (p) => { const e = p as { index?: number }; if (typeof e.index === 'number') { turbo.setLevel(e.index); writePrefs({ turbo: e.index }); } }));
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
          // Read the BASE bet straight from the stepper CONTROL (updated synchronously by
          // inc()/dec()) — NOT `stores.balance.bet`, which the core updates a tick later off
          // `valueChanged`, so the modal would lag one step (first +/- press "doesn't
          // register", +then- re-fires +). The readout still shows the boosted stake.
          getBet: () => hud!.ui.betStepper.value,
          onBuy: (id) => {
            if (machine.current !== 'idle') return;
            // Buying plays at the BASE bet — clear any active ante so its multiplied
            // (emphasised, yellow) bet readout reverts to the plain base bet first.
            if (stores.ui.activeMode) {
              stores.ui.setActiveMode(null);
              applyBetDisplay();
            }
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
    // Input sounds: if the declarative AudioSpec named cues per HUD input, wire them now.
    if (audio && isAudioSpec(opts.audio) && opts.audio.inputSounds) {
      disposers.push(bindInputSounds(audio, hud, opts.audio.inputSounds));
    }

    // ── Persist player prefs (sound mute + turbo mode) across sessions ──────────
    // Restore BEFORE the game is interactive so the controls boot in the saved position
    // (setMuted also propagates to the audio mixer via bindMixerToHud's muted subscription
    // above). turboChanged below persists the turbo mode; anon/blocked-storage is safe.
    const prefs = readPrefs();
    if (typeof prefs.muted === 'boolean') hud.setMuted(prefs.muted);
    if (typeof prefs.turbo === 'number' && prefs.turbo > 0) {
      hud.ui.turbo.setIndex(prefs.turbo);
      turbo.setLevel(prefs.turbo);
    }
    disposers.push(hud.ui.muted.subscribe((m) => writePrefs({ muted: m })));

    // ── ACTIVE-ROUND RESUME: settle it, land idle, then a "round in progress" modal ──
    if (active?.active) {
      // The player refreshed while a round was still open. Settle it now (balance becomes
      // authoritative; the bet was restored into the ladder above), land on a clean idle
      // board, then show a NON-dismissible modal — on Continue we replay the recovered
      // round through the game's Present phase so the player watches how it resolved before
      // regaining control. (Not awaited — start() proceeds to fill/pop the loader; the modal
      // shows over the game once the loader fades.)
      const end = await network.endRound();
      const raw = active as Round<E>;
      const info = roundInfo(raw, defaultBet, activeCost);
      const settledBal = end.balance.amount / API_AMOUNT_MULTIPLIER;
      stores.balance.setBalance(settledBal);
      const resumeRound = { ...info, data: opts.interpretBook(raw, info), active: false, balance: settledBal, raw };
      await machine.transition('idle');
      hud.showFatal('You have an unfinished round. Continue to see how it ends.', {
        title: 'Round in progress',
        tone: 'info',
        actions: [
          {
            label: 'Continue',
            variant: 'primary',
            onSelect: () => {
              hud!.hideNotice();
              hud!.lockInput(); // no spins/buys while the recovered round replays
              ctx.round = resumeRound;
              void machine.transition('present').finally(() => hud!.unlockInput());
            },
          },
        ],
      });
    } else {
      stores.balance.setBalance(auth.balance.amount / API_AMOUNT_MULTIPLIER);
      await machine.transition('idle');
    }
    // The game is booted + interactive → fill + pop the loader away (unless the game asked
    // to drive it manually, e.g. to wait for its scene art via `ctx.loader.done()`).
    if (!manualLoader) void loader?.done();
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
      loader,
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
