import { describe, it, expect } from 'vitest';
import { bindInputSounds } from '../src/audio/inputs';
import type { AudioPort } from '../src/engine/fsm';

// A minimal event-bus HUD + recording AudioPort — no zvuk / Web Audio needed.
function fakeHud() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  return {
    on(type: string, fn: (p: unknown) => void) {
      (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type: string, p?: unknown) { handlers.get(type)?.forEach((fn) => fn(p)); },
  };
}
function fakeAudio() {
  const plays: Array<{ name: string; bus?: string }> = [];
  const port: AudioPort = { play: (name, opts) => plays.push({ name, bus: opts?.bus }), music: () => {}, stopMusic: () => {} };
  return { port, plays };
}

describe('bindInputSounds', () => {
  it('plays the mapped cue on each HUD input event, on the ui bus', () => {
    const hud = fakeHud();
    const { port, plays } = fakeAudio();
    bindInputSounds(port, hud as never, { spin: 'click', bet: 'tick', autoplay: 'auto', turbo: 'tg', skip: 'sk' });
    hud.emit('spinRequested');
    hud.emit('valueChanged', { id: 'bet-stepper', value: 2 });
    hud.emit('valueChanged', { id: 'not-the-bet' }); // ignored — wrong control
    hud.emit('autoplayStarted');
    hud.emit('turboChanged', { index: 1 });
    hud.emit('skipRequested');
    expect(plays.map((p) => p.name)).toEqual(['click', 'tick', 'auto', 'tg', 'sk']);
    expect(plays.every((p) => p.bus === 'ui')).toBe(true);
  });

  it('subscribes only for mapped inputs and the disposer detaches', () => {
    const hud = fakeHud();
    const { port, plays } = fakeAudio();
    const off = bindInputSounds(port, hud as never, { spin: 'click' });
    hud.emit('autoplayStarted'); // not mapped → silent
    expect(plays).toHaveLength(0);
    hud.emit('spinRequested');
    expect(plays).toHaveLength(1);
    off();
    hud.emit('spinRequested'); // detached
    expect(plays).toHaveLength(1);
  });
});
