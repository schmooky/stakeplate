// ReelsSafeFrame — a SmartContainer that fits the reel grid into the reel SAFE
// rect, so the reels are ALWAYS clear of the HUD controls on every device.
//
// The rect comes from a provider (set by MainScene) that derives it from the
// live open-ui control bounds; when no provider is set yet it falls back to the
// legacy layout module.

import type { Container } from 'pixi.js';
import type { Rect } from '@/hud/layout';
import { computeLayout } from '@/hud/layout';
import { resizeObject } from '@/view/smart/ResizeObserver';
import { SmartContainer } from '@/view/smart/SmartContainer';

export class ReelsSafeFrame extends SmartContainer {
  private content: Container | null = null;
  /** Supplies the safe rect to fit into. When unset, falls back to the legacy
   *  layout module. Set by MainScene once the open-ui HUD bounds are known. */
  private safeProvider: (() => Rect) | null = null;

  /** @param gridW @param gridH natural (unscaled) size of the reel grid content. */
  constructor(
    private readonly gridW: number,
    private readonly gridH: number,
  ) {
    // The base fit data is unused — onResize() does the real placement from the
    // safe rect — but SmartContainer requires both orientations.
    super({
      portraitData: { safeWidth: gridW, safeHeight: gridH, fitContain: true },
      landscapeData: { safeWidth: gridW, safeHeight: gridH, fitContain: true },
    });
    this.label = 'reels-frame'; // pixi-test-label
  }

  setContent(container: Container): void {
    if (this.content) this.removeChild(this.content);
    this.content = container;
    this.addChild(container);
    this.relayout();
  }

  /** Set the provider for the reel safe rect, then reflow into it. */
  setSafeAreaProvider(fn: (() => Rect) | null): void {
    this.safeProvider = fn;
    this.relayout();
  }

  /** The rect the reels are currently fit into (for the debug overlay). */
  currentSafeArea(): Rect {
    return this.safeProvider?.() ?? computeLayout(resizeObject.width, resizeObject.height).reelSafe;
  }

  protected override onResize(): void {
    if (!this.content) return;
    const safe = this.currentSafeArea();

    // Contain the grid inside the safe rect, centred, never upscaling past a
    // comfortable cap so a single 3×3 board doesn't balloon on huge screens.
    const fit = safe.w > 0 && safe.h > 0 ? Math.min(safe.w / this.gridW, safe.h / this.gridH) : 1;
    this.scale.set(fit);
    this.position.set(
      safe.x + (safe.w - this.gridW * fit) / 2,
      safe.y + (safe.h - this.gridH * fit) / 2,
    );
  }
}
