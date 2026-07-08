// reelDecor — the primitive reel housing. Two layers:
//   • back:  a recessed dark "well" behind each cell, so cells read as sunken
//            windows on the flat Stake field.
//   • front: a per-cell cylinder shade (a vertical dark→clear→dark gradient that
//            makes the spinning symbol look like it's wrapping over a drum) plus
//            a glassy top sheen, and a single rounded rail framing the whole
//            board. No textures — all Graphics + one FillGradient per cell.
//
// Z-order in MainScene: back → reelsets → front → magnet-pull overlay.

import { Container, FillGradient, Graphics } from 'pixi.js';
import { PALETTE } from '@/view/symbols/palette';

export interface ReelDecorOpts {
  columns: number;
  rows: number;
  cellSize: number;
  cellGap: number;
  /** Local px where cell (0,0) starts — equals the frame padding. */
  origin: number;
  /** Outer frame size (grid + 2×origin). */
  frameW: number;
  frameH: number;
}

export interface ReelDecor {
  back: Container;
  front: Container;
}

const CELL_RADIUS = 14;

/** A vertical "cylinder" shade for one cell: dark top & bottom, clear middle. */
function cylinderShade(size: number): Graphics {
  const grad = new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: 'rgba(0,0,0,0.62)' },
      { offset: 0.16, color: 'rgba(0,0,0,0.14)' },
      { offset: 0.5, color: 'rgba(0,0,0,0)' },
      { offset: 0.84, color: 'rgba(0,0,0,0.14)' },
      { offset: 1, color: 'rgba(0,0,0,0.62)' },
    ],
  });
  return new Graphics().roundRect(0, 0, size, size, CELL_RADIUS).fill(grad);
}

export function buildReelDecor(o: ReelDecorOpts): ReelDecor {
  const back = new Container();
  back.label = 'reel-decor-back';
  const front = new Container();
  front.label = 'reel-decor-front';

  const step = o.cellSize + o.cellGap;

  for (let c = 0; c < o.columns; c++) {
    for (let r = 0; r < o.rows; r++) {
      const x = o.origin + c * step;
      const y = o.origin + r * step;

      // Recessed well behind the symbol.
      back.addChild(
        new Graphics()
          .roundRect(x, y, o.cellSize, o.cellSize, CELL_RADIUS)
          .fill({ color: PALETTE.cellWell })
          .stroke({ width: 1.5, color: PALETTE.cellEdge, alpha: 0.85 }),
      );

      // Cylinder shade (own Graphics so the gradient maps to this cell's box).
      const shade = cylinderShade(o.cellSize);
      shade.position.set(x, y);

      // Glassy top sheen — a faint highlight over the upper third.
      const sheen = new Graphics()
        .roundRect(x + 6, y + 5, o.cellSize - 12, o.cellSize * 0.42, 11)
        .fill({ color: 0xffffff, alpha: 0.035 });

      front.addChild(shade, sheen);
    }
  }

  // Rounded rail around the whole board: a dark outer shadow + a lighter inner
  // edge, for a beveled-metal frame look.
  const frame = new Graphics();
  frame
    .roundRect(2, 2, o.frameW - 4, o.frameH - 4, 22)
    .stroke({ width: 4, color: PALETTE.rail, alpha: 0.7 })
    .roundRect(5, 5, o.frameW - 10, o.frameH - 10, 19)
    .stroke({ width: 2, color: PALETTE.railHi, alpha: 0.9 });
  front.addChild(frame);

  return { back, front };
}
