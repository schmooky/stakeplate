// HUD layout — the single source of truth for where every control sits, derived
// 1:1 from the Figma exports (measured off the 2× design PNGs). Two reference
// canvases: desktop 1920×1080 (landscape) and mobile 360×779 (portrait).
//
// Positioning model: each control is anchored to a screen corner/edge with a
// design-space centre + size. Screen position = anchorCorner + (designCentre −
// designCorner) × uiScale. At the reference resolution uiScale = 1, so every
// control lands EXACTLY on its Figma coordinate; at other sizes the groups stay
// hugged to their corners (left group bottom-left, action cluster bottom-centre,
// bet group bottom-right) so the UI never overlaps the reels and never "rots".
//
// `computeLayout` also derives the reel SAFE rect — the largest box above the
// control band and between the side columns — which the reels are fit into
// (MainScene + SmartContainer). Both the HUD and the reels read this one module,
// so they provably cannot overlap (asserted in tests/hud/layout.test.ts).

export type Anchor = 'BL' | 'BR' | 'BC';

export interface ControlSpec {
  id: ControlId;
  /** Design-space centre (in the mode's reference canvas). */
  cx: number;
  cy: number;
  /** Design-space size (hit/box size). */
  w: number;
  h: number;
  anchor: Anchor;
}

export type ControlId = 'menu' | 'balance' | 'bet' | 'auto' | 'spin' | 'turbo' | 'plus' | 'minus';

export interface ModeSpec {
  name: 'desktop' | 'mobile';
  ref: { w: number; h: number };
  /** Outer margin (design px) kept around the reel safe area. */
  margin: number;
  controls: ControlSpec[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  mode: 'desktop' | 'mobile';
  scale: number;
  viewport: { w: number; h: number };
  controls: Record<ControlId, Rect>;
  /** Centre points (screen px) — handy for tests/animation. */
  centers: Record<ControlId, { x: number; y: number }>;
  /** The box the reels are fit into. Never intersects a control rect. */
  reelSafe: Rect;
}

// ---- Reference specs (measured from the Figma PNGs) --------------------------

export const DESKTOP: ModeSpec = {
  name: 'desktop',
  ref: { w: 1920, h: 1080 },
  margin: 28,
  controls: [
    { id: 'menu', cx: 220, cy: 760, w: 80, h: 80, anchor: 'BL' },
    { id: 'balance', cx: 258, cy: 936, w: 250, h: 150, anchor: 'BL' },
    { id: 'auto', cx: 756, cy: 968, w: 80, h: 80, anchor: 'BC' },
    { id: 'spin', cx: 960, cy: 940, w: 184, h: 184, anchor: 'BC' },
    { id: 'turbo', cx: 1164, cy: 968, w: 80, h: 80, anchor: 'BC' },
    { id: 'bet', cx: 1665, cy: 928, w: 165, h: 150, anchor: 'BR' },
    { id: 'plus', cx: 1808, cy: 902, w: 62, h: 62, anchor: 'BR' },
    { id: 'minus', cx: 1801, cy: 986, w: 62, h: 62, anchor: 'BR' },
  ],
};

export const MOBILE: ModeSpec = {
  name: 'mobile',
  ref: { w: 360, h: 779 },
  margin: 14,
  controls: [
    { id: 'auto', cx: 93, cy: 608, w: 44, h: 44, anchor: 'BC' },
    { id: 'spin', cx: 180, cy: 608, w: 100, h: 100, anchor: 'BC' },
    { id: 'turbo', cx: 266, cy: 608, w: 44, h: 44, anchor: 'BC' },
    { id: 'menu', cx: 326, cy: 616, w: 52, h: 52, anchor: 'BC' },
    { id: 'minus', cx: 144, cy: 690, w: 40, h: 40, anchor: 'BC' },
    { id: 'plus', cx: 214, cy: 690, w: 40, h: 40, anchor: 'BC' },
    // Read-outs: the box is left-aligned (balance) / right-aligned (bet), so its
    // centre sits half a box-width inside the corner to keep the value on screen.
    { id: 'balance', cx: 66, cy: 727, w: 110, h: 70, anchor: 'BL' },
    { id: 'bet', cx: 293, cy: 727, w: 110, h: 70, anchor: 'BR' },
  ],
};

// ---- Pure layout computation -------------------------------------------------

const MIN_SCALE = 0.55;
const MAX_SCALE = 1.35;

/** Pick the reference spec for a viewport: landscape → desktop, portrait → mobile. */
export function pickMode(vw: number, vh: number): ModeSpec {
  return vw >= vh ? DESKTOP : MOBILE;
}

function anchorCorner(anchor: Anchor, ref: { w: number; h: number }, vw: number, vh: number) {
  // returns [designCornerX, designCornerY, screenCornerX, screenCornerY]
  switch (anchor) {
    case 'BL':
      return [0, ref.h, 0, vh] as const;
    case 'BR':
      return [ref.w, ref.h, vw, vh] as const;
    case 'BC':
      return [ref.w / 2, ref.h, vw / 2, vh] as const;
  }
}

export function computeLayout(vw: number, vh: number): Layout {
  const spec = pickMode(vw, vh);
  const { ref, margin } = spec;
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(vw / ref.w, vh / ref.h)));

  const controls = {} as Record<ControlId, Rect>;
  const centers = {} as Record<ControlId, { x: number; y: number }>;
  for (const c of spec.controls) {
    const [dcx, dcy, scx, scy] = anchorCorner(c.anchor, ref, vw, vh);
    const cxS = scx + (c.cx - dcx) * s;
    const cyS = scy + (c.cy - dcy) * s;
    const w = c.w * s;
    const h = c.h * s;
    controls[c.id] = { x: cxS - w / 2, y: cyS - h / 2, w, h };
    centers[c.id] = { x: cxS, y: cyS };
  }

  // ---- derive the reel safe rect ----
  const m = margin * s;
  const cxLo = vw * 0.2;
  const cxHi = vw * 0.8;

  // bandTop: top of the lowest "central" control band (the action cluster / row).
  let bandTop = vh;
  for (const c of spec.controls) {
    const r = controls[c.id];
    const ccx = r.x + r.w / 2;
    if (ccx >= cxLo && ccx <= cxHi) bandTop = Math.min(bandTop, r.y);
  }

  const top = m;
  let left = m;
  let right = vw - m;
  for (const c of spec.controls) {
    const r = controls[c.id];
    const ccx = r.x + r.w / 2;
    // Only controls that vertically overlap the reel area can bound its sides.
    if (r.y >= bandTop) continue;
    if (ccx < cxLo) left = Math.max(left, r.x + r.w + m);
    else if (ccx > cxHi) right = Math.min(right, r.x - m);
  }

  // Centre the reel area horizontally on screen: use the tighter of the two
  // side insets on BOTH sides, so the reels sit centred (not pushed toward
  // whichever side happens to have fewer controls). Symmetric ⇒ still a subset
  // of [left, right], so it never overlaps a control.
  const inset = Math.max(left, vw - right);
  const reelSafe: Rect = {
    x: inset,
    y: top,
    w: Math.max(0, vw - 2 * inset),
    h: Math.max(0, bandTop - m - top),
  };

  return { mode: spec.name, scale: s, viewport: { w: vw, h: vh }, controls, centers, reelSafe };
}

/** Do two rects overlap (strictly positive intersection area)? */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
