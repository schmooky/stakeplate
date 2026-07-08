// DigitSymbol — a single digit (0–9) rendered as a sharp, heavy font glyph.
// No texture: a high-resolution Pixi Text + GSAP squish on win.
import { gsap } from 'gsap';
import { Text } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';
import { DIGIT_FONT, PALETTE } from './palette';

export interface DigitSymbolOptions {
  digit: number;
}

export class DigitSymbol extends ReelSymbol {
  private readonly text: Text;
  private win: gsap.core.Timeline | null = null;

  constructor(opts: DigitSymbolOptions) {
    super();
    this.text = new Text({
      text: String(opts.digit),
      style: {
        fontFamily: DIGIT_FONT,
        fontWeight: '700',
        fontSize: 96,
        fill: PALETTE.digit,
        align: 'center',
      },
      resolution: Math.max(2, Math.ceil(window.devicePixelRatio || 1) + 1),
    });
    this.text.anchor.set(0.5);
    this.view.addChild(this.text);
  }

  protected onActivate(): void {
    this.killWin();
    this.view.alpha = 1; // the magnet-pull hides the real digit; restore on pool reuse
    this.text.scale.set(1);
    this.text.alpha = 1;
    this.text.style.fill = PALETTE.digit;
  }

  protected onDeactivate(): void {
    this.killWin();
  }

  resize(width: number, height: number): void {
    this.text.position.set(width / 2, height / 2);
    this.text.style.fontSize = Math.round(Math.min(width, height) * 0.64);
  }

  async playWin(): Promise<void> {
    this.killWin();
    await new Promise<void>((resolve) => {
      this.text.style.fill = PALETTE.digitWin;
      this.win = gsap
        .timeline({
          onComplete: () => {
            this.text.style.fill = PALETTE.digit;
            resolve();
          },
        })
        .to(this.text.scale, { x: 0.76, y: 1.24, duration: 0.07, ease: 'power3.out' })
        .to(this.text.scale, { x: 1.24, y: 0.82, duration: 0.08, ease: 'power2.inOut' })
        .to(this.text.scale, { x: 1, y: 1, duration: 0.36, ease: 'elastic.out(1, 0.4)' });
    });
  }

  stopAnimation(): void {
    this.killWin();
    this.text.scale.set(1);
    this.text.style.fill = PALETTE.digit;
  }

  private killWin(): void {
    if (this.win) {
      this.win.kill();
      this.win = null;
    }
  }
}
