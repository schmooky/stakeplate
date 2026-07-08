// The mixer↔HUD binding, with NO @schmooky/zvuk dependency — so `createStakeGame` can
// auto-wire audio without pulling zvuk into every game's bundle. It talks to the mixer
// through a minimal structural port (`MixerLike`), which @stakeplate/core/audio's
// `GameAudio` satisfies. `@open-slot-ui/pixi` is imported type-only (erased at build).

import type { BootedHud } from '@open-slot-ui/pixi';

/** The two volume groups the HUD's two sliders drive. */
export type MixerGroup = 'music' | 'effects';

/**
 * The minimal mixer surface the HUD binding needs. The HUD has exactly two sliders —
 * **Music** and **Effects** — so the port is group-level, not per-bus. GameAudio satisfies
 * it structurally.
 */
export interface MixerLike {
  /** Set a group's level (0..1) — applies to every bus in the group. */
  setGroupLevel(group: MixerGroup, level: number): void;
  /** Read a group's level (average across its buses). */
  getGroupLevel(group: MixerGroup): number;
  /** Mute/unmute everything (the Sound toggle). */
  setMuted(muted: boolean): void;
  /** Resume the AudioContext from a user gesture. Present on GameAudio. */
  unlock?(): Promise<void> | void;
}

/**
 * Bind the HUD sound controls to a mixer: the **Music slider → `music` group**, the
 * **Effects slider → `effects` group** (both persisted to localStorage + restored), and the
 * **Sound toggle → mute** everything. Returns a disposer.
 */
export function bindMixerToHud(mixer: MixerLike, hud: BootedHud, opts: { storageKey?: string } = {}): () => void {
  const key = opts.storageKey ?? 'stakeplate.mixer';
  const save = (): void => {
    try {
      localStorage.setItem(key, JSON.stringify({ music: mixer.getGroupLevel('music'), effects: mixer.getGroupLevel('effects') }));
    } catch {
      /* storage may be unavailable */
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as { music?: number; effects?: number };
    if (typeof saved.music === 'number') mixer.setGroupLevel('music', saved.music);
    if (typeof saved.effects === 'number') mixer.setGroupLevel('effects', saved.effects);
  } catch {
    /* ignore */
  }

  const disposers: Array<() => void> = [];
  disposers.push(
    hud.on('valueChanged', (p) => {
      const v = p as { id?: string; value?: number };
      if (typeof v?.value !== 'number') return;
      // HUD control ids: 'music' → music group, 'sfx' (the Effects slider) → effects group.
      if (v.id === 'music') { mixer.setGroupLevel('music', v.value); save(); }
      if (v.id === 'sfx') { mixer.setGroupLevel('effects', v.value); save(); }
    }),
  );
  disposers.push(hud.ui.muted.subscribe((m: boolean) => mixer.setMuted(m)));
  return () => { for (const d of disposers.splice(0)) d(); };
}
