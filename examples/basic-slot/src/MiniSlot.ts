// A deliberately tiny pixi scene — a 3×3 symbol grid on its own (opaque) canvas behind
// the transparent HUD. The game's Present phase calls `play(grid, win)` to spin + land.
// This is the ONLY rendering a game author writes; the core does everything else.

import { Application, Container, Graphics, Text } from 'pixi.js';

const SYMBOLS = ['🍒', '🍋', '⭐', '💎', '🔔', '7️⃣'];
const rnd = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

interface Tile {
  cell: Container;
  bg: Graphics;
  txt: Text;
}

export class MiniSlot {
  readonly app = new Application();
  private readonly root = new Container();
  /** The highlighted rectangle the reels are contain-fitted into + its label. */
  private readonly fitArea = new Graphics();
  private readonly fitLabel = new Text({ text: 'fit-scale area', style: { fontSize: 13, fontFamily: 'system-ui', fontWeight: '700', fill: 0xffc935 } });
  private readonly tiles: Tile[][] = [];
  private size = 100;
  private readonly ready: Promise<void>;

  constructor(host: HTMLElement) {
    this.ready = this.init(host);
  }

  private async init(host: HTMLElement): Promise<void> {
    await this.app.init({ background: 0x141821, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
    this.root.addChild(this.fitArea); // behind the reels
    for (let c = 0; c < 3; c++) {
      this.tiles[c] = [];
      for (let r = 0; r < 3; r++) {
        const bg = new Graphics();
        const txt = new Text({ text: rnd(SYMBOLS), style: { fontSize: 64 } });
        txt.anchor.set(0.5);
        const cell = new Container();
        cell.addChild(bg, txt);
        this.root.addChild(cell);
        this.tiles[c]![r] = { cell, bg, txt };
      }
    }
    this.fitLabel.alpha = 0.9;
    this.root.addChild(this.fitLabel); // on top, always legible
    // Size the renderer to the HOST element (which fills the viewport). We read
    // getBoundingClientRect(), not clientWidth/`resizeTo: window` — in embedded/iframe
    // contexts (like this preview) clientWidth and window.innerWidth can read 0 while
    // getBoundingClientRect() still returns the true box, which otherwise leaves the
    // canvas at Pixi's 800×600 default and misaligned with the HUD. Observing the host
    // keeps the scene and the HUD exactly the same size, so the centred reels line up
    // with the centred controls.
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      const w = Math.round(r.width) || window.innerWidth || 800;
      const h = Math.round(r.height) || window.innerHeight || 600;
      this.app.renderer.resize(w, h);
      this.layout();
    };
    new ResizeObserver(resize).observe(host);
    window.addEventListener('resize', resize);
    resize();
  }

  private drawTile(t: Tile, win: boolean): void {
    const s = this.size;
    t.bg.clear().roundRect(0, 0, s, s, s * 0.14).fill(win ? 0x2a2213 : 0x1e2530).stroke({ width: 3, color: win ? 0xffc935 : 0x3a4658 });
    t.txt.position.set(s / 2, s / 2);
    t.txt.style.fontSize = s * 0.5;
  }

  private layout(): void {
    const W = this.app.screen.width;
    const H = this.app.screen.height;

    // The reel viewport: the rectangle the 3×3 grid is CONTAIN-fitted into and centred
    // within. Inset from the edges, sitting in the space above the HUD controls (which
    // live in the bottom ~quarter). Highlighted below so the fit-scale area is visible.
    const areaX = W * 0.08;
    const areaW = W * 0.84;
    const areaY = H * 0.07;
    const areaH = H * 0.68 - areaY;

    // Contain-fit the grid (3 cells + 2 gaps of 12%·cell each way), then centre it.
    const gapRatio = 0.12;
    const units = 3 + 2 * gapRatio;
    this.size = Math.min(areaW / units, areaH / units);
    const gap = this.size * gapRatio;
    const gridW = 3 * this.size + 2 * gap;
    const gridH = 3 * this.size + 2 * gap;
    const x0 = areaX + (areaW - gridW) / 2;
    const y0 = areaY + (areaH - gridH) / 2;

    this.fitArea
      .clear()
      .roundRect(areaX, areaY, areaW, areaH, 14)
      .fill({ color: 0xffc935, alpha: 0.06 })
      .stroke({ width: 2, color: 0xffc935, alpha: 0.7 });
    this.fitLabel.position.set(areaX + 10, areaY + 8);

    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        const t = this.tiles[c]![r]!;
        t.cell.position.set(x0 + c * (this.size + gap), y0 + r * (this.size + gap));
        this.drawTile(t, false);
      }
  }

  /**
   * Spin the reels, then land on `grid`; highlight tiles on a win. The spin DURATION is the
   * injected `wait` — pass `ctx.turbo.delay` so the core's turbo speed + slam-stop drive it
   * (and the round always resolves, even when the tab is hidden and rAF is paused).
   */
  async play(grid: string[][], win: boolean, wait: (ms: number) => Promise<void>): Promise<void> {
    await this.ready;
    let spinning = true;
    const shuffle = (): void => {
      if (!spinning) return;
      for (const col of this.tiles) for (const t of col) t.txt.text = rnd(SYMBOLS);
      requestAnimationFrame(shuffle);
    };
    shuffle();
    await wait(650);
    spinning = false;
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        const t = this.tiles[c]![r]!;
        t.txt.text = grid[c]?.[r] ?? rnd(SYMBOLS);
        this.drawTile(t, win);
      }
  }

  reset(): void {
    for (const col of this.tiles) for (const t of col) this.drawTile(t, false);
  }
}
