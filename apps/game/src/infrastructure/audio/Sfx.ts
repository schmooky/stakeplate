// Sfx — a tiny WebAudio synthesizer for the game's sound effects.
//
// No sourced audio: every sound is generated on the fly from oscillators +
// noise + gain envelopes, matching the "pure primitives" ethos. One shared
// AudioContext, one master gain wired to the UI's sound toggle + SFX volume.
//
// Browsers gate audio on a user gesture, so the context is created lazily on
// the first pointer/key event (and on the splash tap). Everything no-ops until
// then, and no-ops entirely when sound is disabled.

export type SfxName = 'click' | 'spin' | 'reelStop' | 'land' | 'win' | 'bigWin' | 'tick' | 'vortex';

interface ToneOpts {
  freq: number;
  freqTo?: number;
  type?: OscillatorType;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.8;
  private installed = false;

  /** Attach one-shot gesture listeners that unlock the audio context. */
  init(): void {
    if (this.installed) return;
    this.installed = true;
    const unlock = (): void => {
      this.ensure();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null; // SSR / test env — no audio
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  // ---- primitives -----------------------------------------------------------

  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'triangle';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqTo), t0 + o.dur);
    const peak = o.gain ?? 0.12;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(dur: number, gain: number, cutoff: number, delay = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---- voices ---------------------------------------------------------------

  /** `play('reelStop', i)` — i lifts the pitch per reel for a little melody. */
  play(name: SfxName, index = 0): void {
    if (!this.enabled) return;
    if (!this.ensure()) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 520, freqTo: 360, type: 'triangle', dur: 0.06, gain: 0.07 });
        break;
      case 'spin':
        this.tone({ freq: 180, freqTo: 520, type: 'sawtooth', dur: 0.26, gain: 0.05 });
        this.noise(0.3, 0.04, 1400);
        break;
      case 'reelStop':
        this.tone({ freq: 300 + index * 26, freqTo: 200 + index * 20, type: 'triangle', dur: 0.07, gain: 0.06 });
        this.noise(0.04, 0.03, 2600);
        break;
      case 'land':
        this.tone({ freq: 140, freqTo: 80, type: 'sine', dur: 0.18, gain: 0.1 });
        break;
      case 'tick':
        this.tone({ freq: 880 + index * 40, type: 'square', dur: 0.03, gain: 0.03 });
        break;
      case 'win': {
        // Pleasant two-note bell.
        this.tone({ freq: 523.25, type: 'sine', dur: 0.5, gain: 0.12 });
        this.tone({ freq: 783.99, type: 'sine', dur: 0.6, gain: 0.1, delay: 0.08 });
        break;
      }
      case 'bigWin': {
        // Rising arpeggio C–E–G–C.
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          this.tone({ freq: f, type: 'sine', dur: 0.55, gain: 0.12, delay: i * 0.09 });
        });
        this.noise(0.5, 0.03, 5000, 0.0);
        break;
      }
      case 'vortex': {
        // Vortex swirl: a rising whoosh + shimmer that resolves upward.
        this.tone({ freq: 120, freqTo: 520, type: 'sawtooth', dur: 0.45, gain: 0.07 });
        this.tone({ freq: 240, freqTo: 880, type: 'sine', dur: 0.5, gain: 0.06 });
        this.noise(0.45, 0.035, 1600);
        break;
      }
    }
  }

  click(): void {
    this.play('click');
  }
}

export const sfx = new Sfx();
