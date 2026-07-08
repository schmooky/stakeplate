// MainScene — mounts the Pixi app, constructs the reels engine, owns lifecycle.
//
// Uses pixi-reels as documented: build a ReelSet via ReelSetBuilder, add it
// as a child of the adaptive ReelsFrame, and hand an adapter to the app's
// ReelsPresenter. Loads real symbol art from public/assets/symbols/*.png;
// falls back to programmatic placeholders if any texture is missing.

import { gsap } from 'gsap';
import { Application, Container, Graphics } from 'pixi.js';
import { driveGsapWithTicker, type ReelSet, ReelSetBuilder, SpeedPresets, type SymbolRegistry } from 'pixi-reels';
import { GAME } from '@/config/gameConfig';
import { THEME } from '@/config/theme';
import type { Rect } from '@/hud/layout';
import type { ReelsEngine } from '@/presenters/ReelsPresenter';
import type { Disposable } from '@/utils/Disposable';
import { type ControlBound, computeReelSafeArea } from '@/view/scenes/reelSafeArea';
import { ReelsSafeFrame } from '@/view/scenes/ReelsSafeFrame';
import { buildReelDecor } from '@/view/scenes/reelDecor';
import { resizeObject } from '@/view/smart';
import { DigitSymbol } from '@/view/symbols/DigitSymbol';
import { DotSymbol } from '@/view/symbols/DotSymbol';
import { adaptReelGrid, type SpinSpeed } from './reelGridAdapter';

const CELL_GAP = 8;

const CELL_SIZE = 140;

/** Padding between the cells and the rail frame. */
const FRAME_PAD = 14;

/** Natural size of the 3×3 grid content (cells + gaps), in local px. */
const GRID_W = GAME.columns * CELL_SIZE + (GAME.columns - 1) * CELL_GAP;
const GRID_H = GAME.rows * CELL_SIZE + (GAME.rows - 1) * CELL_GAP;

/** Decorated board size (grid + rail padding both sides). */
const FRAME_W = GRID_W + FRAME_PAD * 2;
const FRAME_H = GRID_H + FRAME_PAD * 2;

export class MainScene implements Disposable {
  readonly app: Application;
  private reelsFrame: ReelsSafeFrame | null = null;
  private engineDisposable: Disposable | null = null;
  private gsapDriverDispose: (() => void) | null = null;
  /** Supplies the live HUD control bounds; empty until the open-ui HUD mounts. */
  private controlBounds: () => ControlBound[] = () => [];
  /** Red dashed overlay outlining the reel safe area; toggled in debug mode. */
  private debugSafe: Graphics | null = null;
  private debugOn = false;
  private debugUnsub: (() => void) | null = null;
  private debugKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.app = new Application();
    // Debug safe-area overlay: on via ?debug=1 / ?safearea=1, toggled with "d".
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      this.debugOn = p.get('debug') === '1' || p.get('safearea') === '1';
    }
  }

  /** The reel safe rect — below the top status bar, above the bottom controls. */
  private safeArea(): Rect {
    return computeReelSafeArea(this.controlBounds(), resizeObject.width, resizeObject.height);
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: THEME.clearColor,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    // GSAP is pinned to the Pixi ticker in createReelsEngine() — AFTER the
    // ReelSetBuilder binds the app's gsap into the engine (.gsap(gsap)). Driving
    // it here would pin the engine's default (unbound) gsap instance.

    // Background is the flat Stake clear color (THEME.clearColor) — no layer.

    // Dev-only handle so the scene can be poked from the browser console.
    // Stripped from production by the `import.meta.env.DEV` guard.
    if (import.meta.env.DEV) {
      const w = globalThis as unknown as { __SLOTPLATE?: { app: Application } };
      w.__SLOTPLATE = { app: this.app };
    }

    // Reels are fit into the reel SAFE rect (below the top status bar, above the
    // bottom control cluster) so they're never under the HUD on any device.
    this.reelsFrame = new ReelsSafeFrame(FRAME_W, FRAME_H);
    this.reelsFrame.setSafeAreaProvider(() => this.safeArea());
    this.app.stage.addChild(this.reelsFrame);

    // Debug overlay: a red dashed rectangle tracing the live safe area. Sits
    // above the reels (below the HUD, which mounts later). Redraws on resize.
    this.debugSafe = new Graphics();
    this.debugSafe.label = 'reels-safe-debug';
    this.debugSafe.eventMode = 'none';
    this.app.stage.addChild(this.debugSafe);
    this.redrawDebug();
    this.debugUnsub = resizeObject.subscribe(() => this.redrawDebug());
    this.debugKeyHandler = (e: KeyboardEvent): void => {
      if (e.key === 'd' || e.key === 'D') {
        this.debugOn = !this.debugOn;
        this.redrawDebug();
      }
    };
    window.addEventListener('keydown', this.debugKeyHandler);
  }

  /**
   * Feed the live open-ui control bounds in so the safe area tracks the HUD.
   * Called once from composition after `mountHud`, then a remeasure reflows the
   * reels (and redraws the debug overlay) into the up-to-date rect.
   */
  setControlBounds(provider: () => ControlBound[]): void {
    this.controlBounds = provider;
    this.reelsFrame?.relayout();
    this.redrawDebug();
  }

  /** Draw (or clear) the dashed red safe-area outline. */
  private redrawDebug(): void {
    const g = this.debugSafe;
    if (!g) return;
    g.clear();
    if (!this.debugOn) return;
    const { x, y, w, h } = this.safeArea();
    if (w <= 0 || h <= 0) return;
    // Dashed rectangle: stroke short segments along each edge.
    const dash = 14;
    const gap = 9;
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      for (let d = 0; d < len; d += dash + gap) {
        const e = Math.min(d + dash, len);
        g.moveTo(x1 + ux * d, y1 + uy * d).lineTo(x1 + ux * e, y1 + uy * e);
      }
    };
    seg(x, y, x + w, y);
    seg(x + w, y, x + w, y + h);
    seg(x + w, y + h, x, y + h);
    seg(x, y + h, x, y);
    g.stroke({ width: 3, color: 0xff3b30, alpha: 0.95 });
  }

  /** No background layer — the flat Stake clear color is the backdrop. */
  get backgroundLayer(): null {
    return null;
  }

  /** Nothing to load — symbols are vector primitives and the background is a flat color. */
  async loadAssets(): Promise<void> {}

  createReelsEngine(getSpeed: () => SpinSpeed): ReelsEngine {
    // Symbols are custom vector ReelSymbol subclasses (no textures).
    const registerSymbols = (registry: SymbolRegistry): void => {
      for (const id of GAME.symbolIds) {
        if (id === 'DOT') registry.register(id, DotSymbol, {});
        else registry.register(id, DigitSymbol, { digit: Number(id.slice(1)) });
      }
    };
    // Weight the random fill (initial board + spin blur) mostly-dots so it reads
    // like the real math, not a uniform digit/magnet soup.
    const fillWeights = Object.fromEntries(GAME.symbolIds.map((id) => [id, id === 'DOT' ? 88 : 1]));

    // Primitive reel housing: recessed wells behind the cells, cylinder shade +
    // rail in front. Cells are inset by FRAME_PAD so the rail frames them.
    const decor = buildReelDecor({
      columns: GAME.columns,
      rows: GAME.rows,
      cellSize: CELL_SIZE,
      cellGap: CELL_GAP,
      origin: FRAME_PAD,
      frameW: FRAME_W,
      frameH: FRAME_H,
    });

    // Hold&win layout: 9 INDEPENDENT 1x1 reels in a 3x3 grid. Each cell is its
    // own ReelSet (its own mask + motion), so it spins and stops on its own.
    const grid = new Container();
    grid.addChild(decor.back); // wells render behind every cell
    const reelsets: ReelSet[][] = [];
    for (let c = 0; c < GAME.columns; c++) {
      const col: ReelSet[] = [];
      for (let r = 0; r < GAME.rows; r++) {
        const rs = new ReelSetBuilder()
          // Bind the app's gsap so the engine's motion/bounce tweens run on the
          // SAME instance we drive via driveGsapWithTicker. Without this, pixi-reels'
          // compiled dist resolves its own gsap under vite/pnpm and reels stall
          // at progress 0 (the spin promise never resolves). See pixi-reels
          // gsapRef.ts "dual-instance trap".
          .gsap(gsap)
          .reels(1)
          .visibleRows(1)
          .symbolSize(CELL_SIZE, CELL_SIZE)
          .symbols(registerSymbols)
          .weights(fillWeights)
          // Register all three native speed profiles so setSpeed('turbo') works —
          // the builder only auto-registers 'normal'. pixi-reels then owns the
          // accel/spin/decel/bounce; we only choose the per-column reveal order.
          .speed('normal', SpeedPresets.NORMAL)
          .speed('turbo', SpeedPresets.TURBO)
          .speed('superTurbo', SpeedPresets.SUPER_TURBO)
          .ticker(this.app.ticker)
          .build();
        rs.position.set(FRAME_PAD + c * (CELL_SIZE + CELL_GAP), FRAME_PAD + r * (CELL_SIZE + CELL_GAP));
        grid.addChild(rs);
        col.push(rs);
      }
      reelsets.push(col);
    }
    grid.addChild(decor.front); // cylinder shade + rail render over the cells
    // Shared unmasked layer above every cell, for the cross-cell magnet pull.
    const overlay = new Container();
    grid.addChild(overlay);

    this.reelsFrame?.setContent(grid);
    resizeObject.remeasure();

    // Pin GSAP to the Pixi ticker now that the builder has bound the app's gsap
    // into the engine (the `.gsap(gsap)` calls above). driveGsapWithTicker reads
    // that bound instance via getGsap(), so the spin easing + landing bounce +
    // spotlight tweens all advance in lockstep with rendering — even backgrounded.
    // (Do NOT also call syncGsapToPixi: two drivers double-advance GSAP.)
    this.gsapDriverDispose = driveGsapWithTicker(this.app.ticker);

    const adapter = adaptReelGrid(reelsets, overlay, getSpeed);
    this.engineDisposable = adapter;
    return adapter;
  }

  dispose(): void {
    this.debugUnsub?.();
    this.debugUnsub = null;
    if (this.debugKeyHandler) window.removeEventListener('keydown', this.debugKeyHandler);
    this.debugKeyHandler = null;
    this.debugSafe = null;
    this.gsapDriverDispose?.();
    this.gsapDriverDispose = null;
    this.engineDisposable?.dispose();
    this.engineDisposable = null;
    this.reelsFrame?.dispose();
    this.reelsFrame = null;
    this.app.destroy(true, { children: true });
  }
}
