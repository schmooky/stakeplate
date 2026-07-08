// DicePresenter — the one surface between the FSM and the three.js DiceScene.
// Translates flow into scene calls; holds no game rules.

import type { CascadeDie } from '@/domain/types';
import type { DiceScene, Tally } from '@/view/DiceScene';
import type { Disposable } from '@/utils/Disposable';

export class DicePresenter implements Disposable {
  constructor(private readonly scene: DiceScene) {}

  /** Poof the current dice away (the spin-time clear). */
  async clear(): Promise<void> {
    await this.scene.clear();
  }

  /** Play back the server-resolved cascade. Resolves when it fully settles. */
  async play(cascade: CascadeDie[]): Promise<void> {
    await this.scene.playCascade(cascade);
  }

  setTurbo(on: boolean): void {
    this.scene.setTurbo(on);
  }

  /** Live cascade tally (dropped / winSum / mult), for the on-screen badges. */
  onTally(fn: (t: Tally) => void): void {
    this.scene.onTally = fn;
  }

  dispose(): void {
    this.scene.dispose();
  }
}
