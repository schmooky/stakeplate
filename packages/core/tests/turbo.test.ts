import { describe, it, expect } from 'vitest';
import { TurboClock } from '../src/engine/turbo';

describe('TurboClock — turbo speed + slam-stop', () => {
  it('scales delay by the current level speed', async () => {
    const t = new TurboClock([1, 0.5, 0.1]);
    expect(t.level).toBe(0);
    expect(t.speed).toBe(1);
    t.setLevel(1);
    expect(t.speed).toBe(0.5);
    const start = performance.now();
    await t.delay(100); // 100 × 0.5 = ~50ms
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(120);
  });

  it('clamps the level to the configured speeds', () => {
    const t = new TurboClock([1, 0.4]);
    t.setLevel(5);
    expect(t.level).toBe(1);
    t.setLevel(-3);
    expect(t.level).toBe(0);
  });

  it('slam-stop resolves in-flight + subsequent delays instantly until reset', async () => {
    const t = new TurboClock();
    const p = t.delay(10_000);
    t.skip();
    await p; // resolved immediately by the slam-stop
    expect(t.skipped).toBe(true);
    const start = performance.now();
    await t.delay(10_000); // still instant while skipped
    expect(performance.now() - start).toBeLessThan(30);
    t.resetSkip();
    expect(t.skipped).toBe(false);
  });
});
