// @stakeplate/core/audio — a thin PRE-WIRING over @schmooky/zvuk. The core stands up a
// standard bus graph (master → music / sfx / ambience), binds it to the HUD's Sound
// toggle + Music/Effects sliders (persisted), and ducks music while win/sfx play. The
// game just declares sounds and calls `audio.play('win')` — volume/mute/ducking work.

import { createEngine, Ducker, type Engine, type Bus } from '@schmooky/zvuk';
import type { BootedHud } from '@open-slot-ui/pixi';
import type { AudioPort } from '../engine/fsm';

export interface GameAudioOptions {
  /** Initial bus levels (0..1). */
  buses?: { music?: number; sfx?: number; ambience?: number };
  masterHeadroom?: number;
  /** Duck the `music` bus while THIS bus is active (default `'sfx'`; `null` = no ducking). */
  duckMusicFrom?: string | null;
  duckAmount?: number;
}

/** A sound to load onto a bus, or a music track (intro/loop/outro). */
export type SoundEntry =
  | { name: string; kind?: 'sound'; url: string | string[]; bus?: string }
  | { name: string; kind: 'music'; loop: string | string[]; intro?: string | string[]; outro?: string | string[] };

/** The pre-wired game mixer. Satisfies {@link AudioPort} (play/music/stopMusic). */
export class GameAudio implements AudioPort {
  readonly engine: Engine;
  private readonly duckFrom: string | null;
  private readonly duckAmount: number;
  private unlocked = false;
  private currentMusic: { stop(opts?: { fade?: number }): void } | null = null;

  constructor(opts: GameAudioOptions = {}) {
    this.engine = createEngine({
      buses: {
        music: { level: opts.buses?.music ?? 0.8 },
        sfx: { level: opts.buses?.sfx ?? 1 },
        ambience: { level: opts.buses?.ambience ?? 0.6 },
      },
      master: { headroom: opts.masterHeadroom ?? -3, limiter: { threshold: -1 } },
    });
    this.duckFrom = opts.duckMusicFrom === undefined ? 'sfx' : opts.duckMusicFrom;
    this.duckAmount = opts.duckAmount ?? 0.5;
  }

  /** Resume the AudioContext from a user gesture + arm ducking. Idempotent. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    await this.engine.unlock();
    this.unlocked = true;
    if (this.duckFrom) {
      const ducker = new Ducker(this.engine.context, this.engine.bus(this.duckFrom), { amount: this.duckAmount, attack: 0.05, release: 0.3 });
      this.engine.bus('music').addFx(ducker);
    }
  }

  bus(name: string): Bus {
    return this.engine.bus(name);
  }

  /** Preload a manifest of sounds + music onto their buses. */
  async load(entries: SoundEntry[]): Promise<void> {
    await Promise.all(
      entries.map((e) =>
        'kind' in e && e.kind === 'music'
          ? this.engine.loadMusic(e.name, { loop: e.loop, ...(e.intro ? { intro: e.intro } : {}), ...(e.outro ? { outro: e.outro } : {}) })
          : this.engine.loadSound(e.name, e.url, { bus: e.bus ?? 'sfx' }),
      ),
    );
  }

  play(name: string, opts?: { bus?: string; volume?: number }): void {
    this.engine.sound(name).play({ bus: opts?.bus ?? 'sfx', ...(opts?.volume != null ? { volume: opts.volume } : {}) });
  }

  music(name: string, opts?: { fadeIn?: number }): void {
    this.currentMusic?.stop({ fade: 0.3 });
    this.currentMusic = this.engine.music(name).play({ fadeIn: opts?.fadeIn ?? 0.4 });
  }

  stopMusic(opts?: { fade?: number }): void {
    this.currentMusic?.stop({ fade: opts?.fade ?? 0.3 });
    this.currentMusic = null;
  }
}

export function createGameAudio(opts?: GameAudioOptions): GameAudio {
  return new GameAudio(opts);
}

/**
 * Bind the HUD's sound controls to the audio buses: the **Music slider → music bus**,
 * the **Effects slider → sfx bus** (persisted to localStorage + restored), and the
 * **Sound toggle → mute** (all buses). Returns a disposer. Zero wiring in the game.
 */
export function bindAudioToHud(audio: GameAudio, hud: BootedHud, opts: { storageKey?: string } = {}): () => void {
  const key = opts.storageKey ?? 'stakeplate.mixer';
  const namedBuses = ['music', 'sfx', 'ambience'];
  const save = (): void => {
    try {
      localStorage.setItem(key, JSON.stringify({ music: audio.bus('music').level, sfx: audio.bus('sfx').level }));
    } catch {
      /* storage may be unavailable */
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}') as Record<string, number>;
    for (const [b, v] of Object.entries(saved)) if (typeof v === 'number') audio.bus(b).level = v;
  } catch {
    /* ignore */
  }

  const disposers: Array<() => void> = [];
  disposers.push(
    hud.on('valueChanged', (p) => {
      const v = p as { id?: string; value?: number };
      if (v?.id === 'music' && typeof v.value === 'number') { audio.bus('music').level = v.value; save(); }
      if (v?.id === 'sfx' && typeof v.value === 'number') { audio.bus('sfx').level = v.value; save(); }
    }),
  );
  // Sound toggle → mute every named bus.
  const muted = hud.ui.muted;
  disposers.push(muted.subscribe((m: boolean) => { for (const b of namedBuses) audio.bus(b).muted = m; }));
  return () => { for (const d of disposers.splice(0)) d(); };
}
