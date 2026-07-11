// Input sounds — bind the HUD's control events to one-shot cues so every button press,
// bet step, autoplay start, turbo toggle and slam-stop makes a sound, with zero per-game
// wiring. Purely the HUD event surface (no zvuk here); the sounds must already be loaded on
// the mixer. `createStakeGame` calls this for you when an `AudioSpec.inputSounds` map is
// given; call it directly to wire a custom set.

import type { BootedHud } from '@open-slot-ui/pixi';
import type { AudioPort } from '../engine/fsm';

/** Cue name per HUD input event. Any omitted → that input stays silent. */
export interface InputSoundMap {
  /** Spin button press (and each autoplay/hold re-spin fires `spinRequested`). */
  spin?: string;
  /** Bet +/- (the bet stepper's `valueChanged`). */
  bet?: string;
  /** Autoplay engaged (count picked). */
  autoplay?: string;
  /** Turbo cycler toggled. */
  turbo?: string;
  /** Any switch toggled (turbo/sound/…) — a generic UI click. */
  toggle?: string;
  /** Slam-stop (tap-to-skip the spin). */
  skip?: string;
}

export interface InputSoundOptions {
  /** Bus to route the cues to (default `'ui'`). */
  bus?: string;
}

/**
 * Wire the HUD input events to sounds. Returns a disposer. Safe to call with a partial map —
 * only the mapped inputs subscribe.
 */
export function bindInputSounds(
  audio: AudioPort,
  hud: BootedHud,
  map: InputSoundMap,
  opts: InputSoundOptions = {},
): () => void {
  const bus = opts.bus ?? 'ui';
  const play = (name?: string): void => { if (name) audio.play(name, { bus }); };
  const d: Array<() => void> = [];

  if (map.spin) d.push(hud.on('spinRequested', () => play(map.spin)));
  if (map.autoplay) d.push(hud.on('autoplayStarted', () => play(map.autoplay)));
  if (map.skip) d.push(hud.on('skipRequested', () => play(map.skip)));
  if (map.bet) {
    d.push(hud.on('valueChanged', (p: unknown) => {
      const v = p as { id?: string };
      if (v?.id === 'bet-stepper') play(map.bet);
    }));
  }
  if (map.turbo) d.push(hud.on('turboChanged', () => play(map.turbo)));
  if (map.toggle) d.push(hud.on('toggled', () => play(map.toggle)));

  return () => { for (const dispose of d.splice(0)) dispose(); };
}
