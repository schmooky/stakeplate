import { describe, it, expect } from 'vitest';
import { blockingBeat } from '../src/engine/beat';
import { InstantTicker } from '../src/engine/ticker';
import { TurboClock } from '../src/engine/turbo';

const clock = () => ({ ticker: new InstantTicker(), turbo: new TurboClock() });

describe('blockingBeat — lead → show → hold → hide → trail', () => {
  it('runs the phases in order and waits the full duration', async () => {
    const ctx = clock();
    const log: string[] = [];
    await blockingBeat(ctx, {
      leadMs: 500,
      holdMs: 1500,
      trailMs: 300,
      show: () => log.push('show'),
      hide: () => log.push('hide'),
    });
    expect(log).toEqual(['show', 'hide']);
    // InstantTicker advances its clock by each awaited delay → lead+hold+trail seconds.
    expect(ctx.ticker.now()).toBeCloseTo((500 + 1500 + 300) / 1000, 5);
  });

  it('shows before hiding and holds in between (hide optional)', async () => {
    const ctx = clock();
    let shownAt = -1;
    let now = 0;
    const t = ctx.ticker;
    const orig = t.delay.bind(t);
    t.delay = (ms) => { now += ms; return orig(ms); };
    await blockingBeat(ctx, { holdMs: 1000, show: () => { shownAt = now; } });
    expect(shownAt).toBe(0); // shown immediately (no lead), then held 1000ms
    expect(now).toBe(1000);
  });

  it("timing:'turbo' routes through the turbo clock (slam-stop skips it)", async () => {
    const ctx = clock();
    ctx.turbo.skip(); // pretend the player slam-stopped
    const start = performance.now();
    let shown = false;
    await blockingBeat(ctx, { leadMs: 5000, holdMs: 5000, timing: 'turbo', show: () => { shown = true; } });
    expect(shown).toBe(true);
    expect(performance.now() - start).toBeLessThan(50); // resolved instantly
  });
});
