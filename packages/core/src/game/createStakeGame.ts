// createStakeGame — the one-call façade. `start()` runs the whole compliant boot with
// zero game involvement: runtime → network → HUD → (replay | authenticate → configure
// HUD → resume active round → wire events) → run the FSM. Connection/auth failure →
// the themed, blocking showBootError. The game supplies only config + interpretBook +
// mountView (+ optional Present phase, audio). This is the ONLY module that imports the
// HUD/pixi peers; the engine stays decoupled behind ports.

import { Application } from 'pixi.js';
import { mountHud, showBootError, type BootedHud } from '@open-slot-ui/pixi';
import { loadBuiltinArt } from '@open-slot-ui/pixi/art';
import { resolveCurrency, isSocialCurrency } from '@open-slot-ui/core';
import { reaction } from 'mobx';
import { readRuntime, type RuntimeConfig } from '../rgs/runtime';
import { createNetwork, type NetworkManager } from '../rgs/network';
import { API_AMOUNT_MULTIPLIER } from '../rgs/protocol';
import { RootStore } from '../stores/index';
import { RealTicker, type Ticker } from '../engine/ticker';
import { FSM, type AudioPort, type Phase, type PhaseContext } from '../engine/fsm';
import { defaultPhases } from '../engine/phases';
import { roundInfo, type InterpretBook } from '../engine/round';
import { modeCostOf, type GameConfig } from './config';

/** Passed to `mountView` — everything the game's scene needs (not the round/fsm yet). */
export interface ViewContext {
  config: GameConfig;
  stores: RootStore;
  hud: BootedHud;
  ticker: Ticker;
  audio: AudioPort | null;
}

export interface CreateStakeGameOptions<T = unknown, V = unknown> {
  config: GameConfig;
  /** The game's ONE money seam: raw RGS round → your model. Pure. */
  interpretBook: InterpretBook<T>;
  /** Mount the game's pixi scene/presenter/stores; returns the view handed to phases. */
  mountView: (host: HTMLElement, ctx: ViewContext) => V;
  /** The game's Present phase (+ any overrides); Idle/Spin/Settle are provided. */
  phases?: Phase<T, V>[];
  audio?: AudioPort | null;
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

export function createStakeGame<T = unknown, V = unknown>(opts: CreateStakeGameOptions<T, V>): StakeGame {
  const runtime = readRuntime({ overrides: opts.runtime });
  const network = opts.network ?? createNetwork(runtime);
  const stores = new RootStore();
  const ticker = new RealTicker();
  const audio = opts.audio ?? null;
  const app = new Application();
  const disposers: Array<() => void> = [];
  let hud: BootedHud | null = null;
  let fsm: FSM<T, V> | null = null;

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

  const buildSpec = (currency: string): Record<string, unknown> => {
    const bets = opts.config.bets;
    const defaultBet = opts.config.defaultBet ?? bets[Math.floor(bets.length / 2)] ?? bets[0] ?? 1;
    return {
      currency: resolveCurrency(currency),
      betLadder: { levels: bets, index: Math.max(0, bets.indexOf(defaultBet)) },
      ...(opts.config.rtp != null ? { rtp: opts.config.rtp } : {}),
      game: { name: opts.config.title, version: opts.config.version ?? '1.0.0' },
      // Stake owns fullscreen in its iframe — the game must not render its own.
      controls: { fullscreen: { hidden: true } },
      ...(opts.config.confirmBuyAboveCost != null ? { buyFeature: { confirmAboveCost: opts.config.confirmBuyAboveCost } } : {}),
      ...(opts.config.rules ? { menu: opts.config.rules } : {}),
      locale: { locale: runtime.language, messages: { en: {} } },
      ...(opts.config.spec ?? {}),
    };
  };

  const initApp = async (host: HTMLElement): Promise<void> => {
    await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(app.canvas);
  };

  async function start(): Promise<void> {
    const hudHost = opts.hudHost ?? document.body;
    const sceneHost = opts.sceneHost ?? hudHost;
    const phases = [...defaultPhases<T, V>(), ...(opts.phases ?? [])];
    const machine = (fsm = new FSM<T, V>(phases)); // outer `fsm` powers inspect()/requestSpin()

    // ── REPLAY (Stake ?replay=true): fetch a round + play it back read-only ──────
    if (runtime.replay.active && network.replay) {
      try {
        await initApp(hudHost);
        const cur = runtime.currency;
        const bet = runtime.replay.amount || opts.config.defaultBet || opts.config.bets[0] || 1;
        hud = mountHud(app, buildSpec(cur), (await hudOpts()) as never);
        stores.session.set({ currency: cur });
        stores.balance.setBalance(0);
        stores.balance.setBet(bet);
        if (runtime.social) hud.setSocial(true);
        const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio });
        hud.setReplay(true);
        hud.lockInput();
        const cost = modeCostOf(opts.config, runtime.replay.mode);
        const raw = await network.replay({ ...runtime.replay });
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

    const currency = auth.balance.currency;
    const rtp = auth.config.rtp ?? opts.config.rtp ?? 96;
    hud = mountHud(app, buildSpec(currency), (await hudOpts()) as never);
    hud.setCurrency(resolveCurrency(currency));
    hud.applyJurisdiction(auth.config.jurisdiction ?? {});
    if (runtime.social || isSocialCurrency(currency)) hud.setSocial(true);

    const active = auth.round;
    const activeCost = active?.active ? modeCostOf(opts.config, active.mode) : 1;
    const defaultBet = active?.active
      ? active.amount / API_AMOUNT_MULTIPLIER / activeCost // resume: restore bet from the active amount
      : auth.config.defaultBetLevel / API_AMOUNT_MULTIPLIER;
    stores.session.set({
      sessionId: runtime.sessionId,
      currency,
      rtp,
      availableBets: auth.config.betLevels.map((b) => b / API_AMOUNT_MULTIPLIER),
      jurisdiction: auth.config.jurisdiction ?? {},
    });
    stores.balance.setBet(defaultBet);
    hud.setBet(defaultBet);

    const view = opts.mountView(sceneHost, { config: opts.config, stores, hud, ticker, audio });
    const ctx = makeCtx(machine, view);

    // reactions store→HUD + HUD events
    disposers.push(reaction(() => stores.balance.balance, (b) => hud!.setBalance(b), { fireImmediately: false }));
    disposers.push(hud.on('valueChanged', (p) => { const v = p as { id?: string; value?: number }; if (v?.id === 'bet' && typeof v.value === 'number') stores.balance.setBet(v.value); }));
    disposers.push(hud.on('spinRequested', () => { if (machine.current === 'idle') void machine.transition('spin'); }));

    // ── ACTIVE-ROUND RESUME: settle it + play it back, else idle ────────────────
    if (active?.active) {
      const end = await network.endRound();
      const info = roundInfo(active, defaultBet, activeCost);
      stores.balance.setBalance(end.balance.amount / API_AMOUNT_MULTIPLIER);
      ctx.round = { ...info, data: opts.interpretBook(active, info), active: false, balance: end.balance.amount / API_AMOUNT_MULTIPLIER, raw: active };
      await machine.transition('present'); // view plays it back → settle → idle
    } else {
      stores.balance.setBalance(auth.balance.amount / API_AMOUNT_MULTIPLIER);
      await machine.transition('idle');
    }
  }

  function makeCtx(fsm: FSM<T, V>, view: V): PhaseContext<T, V> {
    const ctx: PhaseContext<T, V> = {
      config: opts.config,
      stores,
      network,
      hud: hud as BootedHud,
      ticker,
      view,
      audio,
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
