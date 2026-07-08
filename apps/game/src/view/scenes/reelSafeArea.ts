// Reel SAFE area — the band the reels are allowed to occupy: below the top
// status bar (NET / RTP / SESSION readouts) and above the bottom control
// cluster (spin button, autoplay, turbo, bet steppers…). The reels fit-scale
// into this rect so they never collide with the open-ui HUD on any viewport.
//
// It is derived from the LIVE open-ui control bounds (hud.snapshot()), so it
// tracks the HUD wherever it actually renders — unlike the legacy slotplate
// layout module, which described a Preact HUD this game no longer ships.

import type { Rect } from '@/hud/layout';

/** A control's screen-space box (open-ui `ControlSnapshot.bounds`). */
export interface ControlBound {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the reel safe rect from the HUD's control bounds and the viewport.
 *
 * - Top edge: just below the lowest of the top-bar readouts (upper fifth of
 *   the screen). Falls back to a small top margin when none are present.
 * - Bottom edge: just above the highest control in the bottom cluster (lower
 *   ~45% of the screen) — i.e. the top of the spin button row. Falls back to
 *   85% of the height when the HUD hasn't mounted yet (or in headless stubs).
 * - Sides: a symmetric margin so the reels sit centred.
 */
export function computeReelSafeArea(bounds: ControlBound[], vw: number, vh: number): Rect {
  const margin = Math.round(Math.min(vw, vh) * 0.03);
  const boxed = bounds.filter((b) => b && b.height > 0 && b.width > 0);
  const cy = (b: ControlBound): number => b.y + b.height / 2;

  const topBar = boxed.filter((b) => cy(b) < vh * 0.2);
  const statusBottom = topBar.length ? Math.max(...topBar.map((b) => b.y + b.height)) : 0;

  const bottomCluster = boxed.filter((b) => cy(b) > vh * 0.55);
  const clusterTop = bottomCluster.length ? Math.min(...bottomCluster.map((b) => b.y)) : vh * 0.85;

  const top = statusBottom + margin;
  const bottom = clusterTop - margin;
  return {
    x: margin,
    y: top,
    w: Math.max(0, vw - 2 * margin),
    h: Math.max(0, bottom - top),
  };
}
