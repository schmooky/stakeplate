// DotSymbol — the blank/empty cell, drawn as a small blue pyramidal gem: a
// rhombus split into four facets (lit from the top) so it reads as a faceted
// 3D pyramid, not a flat diamond. Slow breathing pulse keeps the grid alive.
// Gems never pay.
import { gsap } from 'gsap';
import { Container, Graphics } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';
import { PALETTE } from './palette';

export class DotSymbol extends ReelSymbol {
  private readonly node = new Container();
  private readonly gem = new Graphics();
  private breathe: gsap.core.Tween | null = null;

  constructor() {
    super();
    this.node.addChild(this.gem);
    this.view.addChild(this.node);
  }

  protected onActivate(): void {
    this.view.alpha = 1;
    this.startBreathe();
  }

  protected onDeactivate(): void {
    this.breathe?.kill();
    this.breathe = null;
    this.node.scale.set(1);
  }

  resize(width: number, height: number): void {
    const size = Math.min(width, height);
    this.node.position.set(width / 2, height / 2);

    const hw = size * 0.16; // half width
    const hh = size * 0.22; // half height (taller than wide → gem)
    const T: [number, number] = [0, -hh];
    const R: [number, number] = [hw, 0];
    const B: [number, number] = [0, hh];
    const L: [number, number] = [-hw, 0];
    const C: [number, number] = [0, 0];

    this.gem.clear();
    // Four facets meeting at the centre ridge — top facets lighter (lit), bottom darker.
    this.gem.poly([...T, ...R, ...C]).fill({ color: PALETTE.gemTop }); // top-right, lightest
    this.gem.poly([...T, ...L, ...C]).fill({ color: PALETTE.gemLeft });
    this.gem.poly([...R, ...B, ...C]).fill({ color: PALETTE.gemRight });
    this.gem.poly([...L, ...B, ...C]).fill({ color: PALETTE.gemBottom }); // shadow facet, darkest
    // Crisp rhombus outline.
    this.gem
      .poly([...T, ...R, ...B, ...L])
      .stroke({ width: Math.max(1, size * 0.011), color: PALETTE.gemEdge, alpha: 0.55, join: 'round' });
    // Faint ridge lines (apex → corners) to sell the pyramid facets.
    this.gem
      .moveTo(...T)
      .lineTo(...C)
      .moveTo(...L)
      .lineTo(...R)
      .stroke({ width: Math.max(1, size * 0.006), color: PALETTE.gemEdge, alpha: 0.22 });
  }

  private startBreathe(): void {
    this.breathe?.kill();
    // Stagger the phase a touch so a grid of gems doesn't pulse in lockstep.
    this.node.scale.set(0.94);
    this.breathe = gsap.to(this.node.scale, {
      x: 1.06,
      y: 1.06,
      duration: 1.6 + Math.random() * 0.8,
      delay: Math.random() * 0.8,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }

  async playWin(): Promise<void> {
    // Gems never win.
  }

  stopAnimation(): void {}
}
