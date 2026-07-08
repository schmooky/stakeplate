// @stakeplate/core/audio — a thin PRE-WIRING over @schmooky/zvuk. The core stands up the
// standard slot bus graph (nine buses in TWO groups) + master, binds the two groups to the
// HUD's Music/Effects sliders (persisted) and mutes on the Sound toggle, and ducks music
// while chosen sfx play. The game just declares sounds and calls `audio.play('win','wins')`.
//
//   master
//   ├── MUSIC group  (Music slider) → music · ambience
//   └── EFFECTS group (Effects slider) → reels · symbols · anticipation · wins ·
//                                        voiceover · ui · reverb
//
// Groups are zvuk BusGroups (a logical handle: a slider sets every member's level). Keep the
// per-sound mix in the sound volumes; the sliders scale the whole group.

import { createEngine, Ducker, type Engine, type Bus, type BusConfig, type BusGroup } from '@schmooky/zvuk';
import type { BootedHud } from '@open-slot-ui/pixi';
import type { AudioPort } from '../engine/fsm';
import { bindMixerToHud, type MixerLike, type MixerGroup } from './bind';

export { bindMixerToHud, type MixerLike, type MixerGroup } from './bind';

/** Buses in the MUSIC group (driven by the Music slider). */
export type MusicBus = 'music' | 'ambience';
/** Buses in the EFFECTS group (driven by the Effects slider). */
export type SfxBus = 'reels' | 'symbols' | 'anticipation' | 'wins' | 'voiceover' | 'ui' | 'reverb';
export type BusName = MusicBus | SfxBus;

const MUSIC_BUSES: MusicBus[] = ['music', 'ambience'];
const SFX_BUSES: SfxBus[] = ['reels', 'symbols', 'anticipation', 'wins', 'voiceover', 'ui', 'reverb'];

export interface GameAudioOptions {
  /** Initial MUSIC-group level (music + ambience), 0..1. Default 0.8. */
  music?: number;
  /** Initial EFFECTS-group level (reels…reverb), 0..1. Default 1. */
  effects?: number;
  masterHeadroom?: number;
  /** Duck the MUSIC group while THESE sfx buses are active (default `['wins']`; `null` = off). */
  duckMusicFrom?: SfxBus | SfxBus[] | null;
  duckAmount?: number;
}

/**
 * A sound to load onto a bus, or a music track (intro/loop/outro → the `music` bus).
 * For a PLAIN loop with no authored intro/outro, set `loopCrossfadeMs`: zvuk equal-power
 * crossfades the loop boundary so a single file loops seamlessly (no click, no stinger/tail
 * needed) — just the crossfade window in ms.
 */
export type SoundEntry =
  | { name: string; kind?: 'sound'; url: string | string[]; bus?: BusName }
  | { name: string; kind: 'music'; loop: string | string[]; intro?: string | string[]; outro?: string | string[]; loopCrossfadeMs?: number };

/** The pre-wired game mixer. Satisfies {@link AudioPort} + {@link MixerLike}. */
export class GameAudio implements AudioPort, MixerLike {
  readonly engine: Engine<BusName>;
  private readonly musicGroup: BusGroup;
  private readonly effectsGroup: BusGroup;
  private readonly duckFrom: SfxBus[];
  private readonly duckAmount: number;
  private unlocked = false;
  private currentMusic: { stop(opts?: { fade?: number }): void } | null = null;

  constructor(opts: GameAudioOptions = {}) {
    const musicLevel = opts.music ?? 0.8;
    const fxLevel = opts.effects ?? 1;
    const buses = {} as Record<BusName, BusConfig>;
    for (const b of MUSIC_BUSES) buses[b] = { level: musicLevel };
    for (const b of SFX_BUSES) buses[b] = { level: fxLevel };
    this.engine = createEngine<BusName>({
      buses,
      master: { headroom: opts.masterHeadroom ?? -3, limiter: { threshold: -1 } },
    });
    this.musicGroup = this.engine.busGroup('music', MUSIC_BUSES.map((b) => this.engine.bus(b)));
    this.effectsGroup = this.engine.busGroup('effects', SFX_BUSES.map((b) => this.engine.bus(b)));
    const df = opts.duckMusicFrom === undefined ? (['wins'] as SfxBus[]) : opts.duckMusicFrom;
    this.duckFrom = df == null ? [] : Array.isArray(df) ? df : [df];
    this.duckAmount = opts.duckAmount ?? 0.5;
  }

  /** Resume the AudioContext from a user gesture + arm ducking. Idempotent. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    await this.engine.unlock();
    this.unlocked = true;
    // Duck music + ambience while each chosen sfx bus is active.
    for (const src of this.duckFrom) {
      for (const target of MUSIC_BUSES) {
        const ducker = new Ducker(this.engine.context, this.engine.bus(src), { amount: this.duckAmount, attack: 0.05, release: 0.3 });
        this.engine.bus(target).addFx(ducker);
      }
    }
  }

  // ── MixerLike (the HUD sliders + mute drive these) ────────────────────────────
  setGroupLevel(group: MixerGroup, level: number): void {
    (group === 'music' ? this.musicGroup : this.effectsGroup).level = level;
  }
  getGroupLevel(group: MixerGroup): number {
    return (group === 'music' ? this.musicGroup : this.effectsGroup).level;
  }
  setMuted(muted: boolean): void {
    this.musicGroup.muted = muted;
    this.effectsGroup.muted = muted;
  }

  /** A single bus (for per-sound routing, sends, FX inserts). */
  bus(name: BusName): Bus {
    return this.engine.bus(name);
  }
  /** A volume group handle (`'music'` or `'effects'`). */
  group(name: MixerGroup): BusGroup {
    return name === 'music' ? this.musicGroup : this.effectsGroup;
  }

  /** Preload a manifest of sounds + music onto their buses. */
  async load(entries: SoundEntry[]): Promise<void> {
    await Promise.all(
      entries.map((e) =>
        'kind' in e && e.kind === 'music'
          ? this.engine.loadMusic(
              e.name,
              { loop: e.loop, ...(e.intro ? { intro: e.intro } : {}), ...(e.outro ? { outro: e.outro } : {}) },
              e.loopCrossfadeMs != null ? { loopCrossfade: e.loopCrossfadeMs / 1000 } : undefined,
            )
          : this.engine.loadSound(e.name, e.url, { bus: e.bus ?? 'ui' }),
      ),
    );
  }

  play(name: string, opts?: { bus?: BusName; volume?: number }): void {
    this.engine.sound(name).play({ ...(opts?.bus ? { bus: opts.bus } : {}), ...(opts?.volume != null ? { volume: opts.volume } : {}) });
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
 * Bind the HUD's sound controls to the audio groups (Music slider → music group, Effects →
 * effects group, persisted; Sound toggle → mute). Returns a disposer. `createStakeGame` calls
 * this for you (via {@link bindMixerToHud}) when you pass `audio`; use it directly only to opt
 * out or wire a mixer the core didn't get.
 */
export function bindAudioToHud(audio: GameAudio, hud: BootedHud, opts: { storageKey?: string } = {}): () => void {
  return bindMixerToHud(audio, hud, opts);
}
