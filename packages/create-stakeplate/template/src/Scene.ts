// Your pixi scene — a 3×3 symbol grid, contain-fitted and centred. This is the ONLY rendering
// you write; the core does the HUD, boot, RGS handshake and the round loop. Swap the emoji for
// pixi-reels boards + your art when you build the real game.

import { Application, Container, Graphics, Text } from 'pixi.js';

const SYMBOLS = ['🍒', '🍋', '⭐', '💎', '🔔', '7️⃣'];
const rnd = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

interface Tile {
  cell: Container;
  bg: Graphics;
  txt: Text;
}

export class Scene {
  readonly app = new Application();
  private readonly root = new Container();
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
    // Size the renderer to the HOST element (which fills the viewport). getBoundingClientRect()
    // is more reliable than `resizeTo: window` in embedded/iframe contexts (like the Stake shell),
    // where window.innerWidth can momentarily read 0.
    const resize = (): void => {
      const b = host.getBoundingClientRect();
      this.app.renderer.resize(Math.round(b.width) || window.innerWidth || 800, Math.round(b.height) || window.innerHeight || 600);
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
    // Contain-fit the 3×3 grid into a viewport above the HUD controls, then centre it.
    const areaX = W * 0.08;
    const areaW = W * 0.84;
    const areaY = H * 0.07;
    const areaH = H * 0.68 - areaY;
    const gapRatio = 0.12;
    const units = 3 + 2 * gapRatio;
    this.size = Math.min(areaW / units, areaH / units);
    const gap = this.size * gapRatio;
    const gridW = 3 * this.size + 2 * gap;
    const gridH = 3 * this.size + 2 * gap;
    const x0 = areaX + (areaW - gridW) / 2;
    const y0 = areaY + (areaH - gridH) / 2;
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        const t = this.tiles[c]![r]!;
        t.cell.position.set(x0 + c * (this.size + gap), y0 + r * (this.size + gap));
        this.drawTile(t, false);
      }
  }

  /**
   * Spin the reels, then land on `grid`; highlight the tiles on a win. The spin DURATION is
   * the injected `wait` — pass `ctx.turbo.delay` so the core's turbo speed + slam-stop drive it.
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
}
