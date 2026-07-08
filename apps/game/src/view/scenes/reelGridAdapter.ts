// Adapter for a 3x3 grid of INDEPENDENT 1x1 reels (hold&win style) behind the
// app's ReelsEngine contract. Each cell is its own pixi-reels ReelSet, so it
// spins and stops on its own. The FSM/presenter/network don't know the
// difference — they still talk grid in, animation out.

import { gsap } from 'gsap';
import { type Container, Graphics, Point } from 'pixi.js';
import type { ReelSet } from 'pixi-reels';
import type { Grid, GridCell } from '@/domain/types';
import { sfx } from '@/infrastructure/audio/Sfx';
import type { ReelsEngine } from '@/presenters/ReelsPresenter';
import type { Disposable } from '@/utils/Disposable';
import { PALETTE } from '@/view/symbols/palette';

/** Global-space centre of a symbol's drawn content. */
function globalCenter(view: Container): Point {
  const b = view.getBounds();
  return new Point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
}

/** A snappy cyan spark burst at `at` (overlay-local). */
function burst(overlay: Container, at: Point): void {
  for (let i = 0; i < 11; i++) {
    const spark = new Graphics().circle(0, 0, 2.5).fill({ color: PALETTE.field });
    spark.position.set(at.x, at.y);
    overlay.addChild(spark);
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 30;
    gsap.to(spark, {
      x: at.x + Math.cos(angle) * dist,
      y: at.y + Math.sin(angle) * dist,
      alpha: 0,
      duration: 0.26,
      ease: 'power3.out',
      onComplete: () => spark.destroy(),
    });
    gsap.to(spark.scale, { x: 0.1, y: 0.1, duration: 0.26, ease: 'power2.in' });
  }
}

/** A bright magnet-ray beam from `from` to `to` that snaps in then fades. */
function beam(overlay: Container, from: Point, to: Point): void {
  const g = new Graphics();
  g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ width: 2.5, color: PALETTE.field, alpha: 0.7, cap: 'round' });
  overlay.addChild(g);
  gsap.to(g, { alpha: 0, duration: 0.2, ease: 'power3.in', onComplete: () => g.destroy() });
}

/** A fast stream of dot particles ripping along the ray from `from` into `to`. */
function streamDots(overlay: Container, from: Point, to: Point): void {
  const count = 10;
  for (let i = 0; i < count; i++) {
    const dot = new Graphics().circle(0, 0, 1.6 + Math.random() * 2.4).fill({ color: PALETTE.field });
    const jx = (Math.random() - 0.5) * 20;
    const jy = (Math.random() - 0.5) * 20;
    dot.position.set(from.x + jx, from.y + jy);
    dot.alpha = 0;
    overlay.addChild(dot);
    const delay = i * 0.022;
    gsap.to(dot, { alpha: 1, duration: 0.06, delay });
    gsap.to(dot, {
      x: to.x + (Math.random() - 0.5) * 8,
      y: to.y + (Math.random() - 0.5) * 8,
      duration: 0.18 + Math.random() * 0.1,
      delay,
      ease: 'power3.in',
      onComplete: () => {
        gsap.to(dot, { alpha: 0, duration: 0.08, onComplete: () => dot.destroy() });
      },
    });
  }
}

/** Reel motion speed — mirrors UIStore's SpeedMode AND pixi-reels' built-in
 *  profile names ('normal' | 'turbo' | 'superTurbo'). Passed straight to
 *  ReelSet.setSpeed() so pixi-reels owns the actual accel/spin/decel/bounce. */
export type SpinSpeed = 'normal' | 'turbo' | 'superTurbo';

interface SpinReveal {
  /** Seconds between columns STARTING to spin (0 = all together, turbo). */
  startGap: number;
  /** Seconds between columns STOPPING (0 = all together, turbo). */
  stopGap: number;
  /** A stop hit per column (true) or one for the whole board (false). */
  perColumnSound: boolean;
}

/** How the three columns reveal. The SPEED itself (how fast each reel spins and
 *  bounces) is pixi-reels' job via setSpeed; this only sets the column cadence. */
function revealFor(speed: SpinSpeed): SpinReveal {
  // Turbo = the instant approach: all columns start AND stop together.
  if (speed !== 'normal') return { startGap: 0, stopGap: 0, perColumnSound: false };
  // Normal = launch column by column: a left-to-right start and stop wave.
  return { startGap: 0.1, stopGap: 0.16, perColumnSound: true };
}

/**
 * @param reelsets `reelsets[reel][row]` — a 3x3 array of 1x1 ReelSets.
 * @param overlay  a shared, unmasked Container above all cells (for the magnet pull).
 * @param getSpeed reads the current reel speed (turbo/normal) at the start of each spin.
 */
export function adaptReelGrid(
  reelsets: ReelSet[][],
  overlay: Container,
  getSpeed: () => SpinSpeed,
): ReelsEngine & Disposable {
  const flat = reelsets.flat();
  const cellSet = (c: GridCell): ReelSet | undefined => reelsets[c.reel]?.[c.row];
  const symAt = (c: GridCell) => cellSet(c)?.reels[0]?.getSymbolAt(0);
  let spins: Array<Promise<unknown>> = [];
  // Captured at spin() so a column's start and stop share one cadence.
  let reveal: SpinReveal = revealFor('normal');
  // When spin() kicked off, so setResult can guarantee a minimum spin-up before
  // landing. Against a localhost RGS the network resolves in ~5ms, so setResult
  // would otherwise land on a reel that has barely begun accelerating — a race
  // that leaves pixi-reels' spin promise unresolved (the round hangs). The floor
  // also gives the reels a visible spin instead of a same-frame snap.
  let spinStartedAt = 0;
  const MIN_SPIN_MS = 320;

  return {
    async spin() {
      const speed = getSpeed();
      reveal = revealFor(speed);
      spinStartedAt = performance.now();
      // Hand the speed to pixi-reels — it drives the native accel/spin/decel/
      // bounce. Must be set before spin() (takes effect next spin).
      for (const rs of flat) rs.setSpeed(speed);

      if (reveal.startGap === 0) {
        // Turbo: every reel starts on the same frame.
        spins = [Promise.all(flat.map((rs) => rs.spin()))];
      } else {
        // Normal: each column begins a beat after the one to its left.
        spins = reelsets.map(
          (col, c) =>
            new Promise<void>((resolve) => {
              gsap.delayedCall(c * reveal.startGap, () => {
                void Promise.all(col.map((rs) => rs.spin())).then(() => resolve());
              });
            }),
        );
      }
    },

    async setResult(grid: Grid) {
      // Hand each column its target; pixi-reels does the deceleration + bounce.
      // Columns land all together (turbo) or left → right (normal). No manual
      // squish on top — the native landing bounce is the only landing motion.
      // Floor the spin-up: never land before MIN_SPIN_MS has elapsed since spin()
      // (see spinStartedAt) so the reels are reliably spinning when setResult hits.
      const floorS = Math.max(0, MIN_SPIN_MS - (performance.now() - spinStartedAt)) / 1000;
      for (let c = 0; c < reelsets.length; c++) {
        const col = reelsets[c];
        if (!col) continue;
        const columnIndex = c;
        const land = (): void => {
          let landed = false;
          for (let r = 0; r < col.length; r++) {
            const rs = col[r];
            const sym = grid[columnIndex]?.[r];
            if (!rs || sym === undefined) continue;
            rs.setResult([{ visible: [sym] }]);
            landed = true;
          }
          // One stop hit per column (normal) or one for the whole board (turbo).
          if (landed && (reveal.perColumnSound || columnIndex === 0)) sfx.play('reelStop', columnIndex);
        };
        const delay = floorS + columnIndex * reveal.stopGap;
        if (delay <= 0) land();
        else gsap.delayedCall(delay, land);
      }
      await Promise.all(spins);
      spins = [];
    },

    setAnticipation() {
      // This game's server doesn't direct per-cell teasers.
    },

    forceStop() {
      for (const rs of flat) rs.skipSpin();
    },

    spotlight(cells: GridCell[]) {
      // Pulse each winning cell in place (no per-cell dim — that reads odd on a grid).
      for (const c of cells) void symAt(c)?.playWin();
    },

    clearSpotlight() {
      // playWin is a one-shot; nothing to clear.
    },

    async vortexSpawn(col: number) {
      // The Vortex swirls a full column of digits into existence. The reels have
      // already landed on the column's digits; this is the flourish that sells
      // it: rotating energy rings sweep the column, then each digit warps in with
      // a particle stream + spark burst.
      const cells: GridCell[] = [0, 1, 2].map((row) => ({ reel: col, row }));
      const syms = cells.map((c) => symAt(c));
      const centers = syms.map((s) => (s ? overlay.toLocal(globalCenter(s.view)) : null));
      const mid = centers[1] ?? centers.find((c) => c) ?? new Point(0, 0);

      sfx.play('vortex');

      // Three concentric energy rings (arcs with a gap, so the rotation reads).
      const rings: Graphics[] = [];
      for (let i = 0; i < 3; i++) {
        const r = 26 + i * 14;
        const g = new Graphics()
          .arc(0, 0, r, 0, Math.PI * 1.6)
          .stroke({ width: 3 - i * 0.6, color: i === 1 ? PALETTE.digitWin : PALETTE.field, alpha: 0.9, cap: 'round' });
        g.position.set(mid.x, mid.y);
        g.scale.set(0.2);
        g.alpha = 0;
        overlay.addChild(g);
        rings.push(g);
      }

      // Start the row's digits collapsed so they warp in with the swirl.
      for (const s of syms) if (s) s.view.scale.set(0.01);

      await new Promise<void>((resolve) => {
        const tl = gsap.timeline({
          onComplete: () => {
            for (const g of rings) if (!g.destroyed) g.destroy();
            for (const s of syms) if (s && !s.view.destroyed) s.view.scale.set(1);
            resolve();
          },
        });

        // 1) Rings bloom outward while spinning, then fade.
        rings.forEach((g, i) => {
          const at = i * 0.05;
          tl.to(g, { alpha: 0.95, rotation: Math.PI * 2.5, duration: 0.55, ease: 'power2.out' }, at);
          tl.to(g.scale, { x: 2.4, y: 2.4, duration: 0.6, ease: 'power2.out' }, at);
          tl.to(g, { alpha: 0, duration: 0.28, ease: 'power2.in' }, 0.42 + at);
        });

        // 2) Each digit warps in: a converging particle stream + beam from the
        //    swirl centre, an overshoot scale-pop, and a spark burst on arrival.
        centers.forEach((c, i) => {
          const sym = syms[i];
          if (!c || !sym) return;
          const at = 0.14 + i * 0.09;
          tl.add(() => {
            beam(overlay, mid, c);
            streamDots(overlay, mid, c);
          }, at);
          tl.fromTo(
            sym.view.scale,
            { x: 0.01, y: 0.01 },
            { x: 1, y: 1, duration: 0.36, ease: 'back.out(2.6)', onComplete: () => burst(overlay, c) },
            at + 0.08,
          );
        });
      });
    },

    dispose() {
      for (const rs of flat) rs.destroy();
      if (!overlay.destroyed) overlay.destroy({ children: true });
    },
  };
}
