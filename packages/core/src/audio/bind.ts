// The mixer↔HUD binding, with NO @schmooky/zvuk dependency — so `createStakeGame` can
// auto-wire audio without pulling zvuk into every game's bundle. It talks to the mixer
// through a minimal structural port (`MixerLike`), which @stakeplate/core/audio's
// `GameAudio` satisfies. `@open-slot-ui/pixi` is imported type-only (erased at build).

import type { BootedHud } from '@open-slot-ui/pixi';

/** The minimal mixer surface the HUD binding needs (GameAudio satisfies it structurally). */
export interface MixerLike {
  bus(name: string): { level: number; muted: boolean };
  /** Resume the AudioContext from a user gesture. Present on GameAudio. */
  unlock?(): Promise<void> | void;
}

const NAMED_BUSES = ['music', 'sfx', 'ambience'];

/**
 * Bind the HUD sound controls to a mixer: the **Music slider → `music` bus**, the
 * **Effects slider → `sfx` bus** (persisted to localStorage + restored), and the
 * **Sound toggle → mute** (all buses). Returns a disposer.
 */
export function bindMixerToHud(mixer: MixerLike, hud: BootedHud, opts: { storageKey?: string } = {}): () => void {
  const key = opts.storageKey ?? 'stakeplate.mixer';
  const save = (): void => {
    try {
      localStorage.setItem(key, JSON.stringify({ music: mixer.bus('music').level, sfx: mixer.bus('sfx').level }));
    } catch {
      /* storage may be unavailable */
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, number>;
    for (const [b, v] of Object.entries(saved)) if (typeof v === 'number') mixer.bus(b).level = v;
  } catch {
    /* ignore */
  }

  const disposers: Array<() => void> = [];
  disposers.push(
    hud.on('valueChanged', (p) => {
      const v = p as { id?: string; value?: number };
      if ((v?.id === 'music' || v?.id === 'sfx') && typeof v.value === 'number') {
        mixer.bus(v.id).level = v.value;
        save();
      }
    }),
  );
  disposers.push(hud.ui.muted.subscribe((m: boolean) => { for (const b of NAMED_BUSES) mixer.bus(b).muted = m; }));
  return () => { for (const d of disposers.splice(0)) d(); };
}
