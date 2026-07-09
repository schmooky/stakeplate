import { describe, it, expect } from 'vitest';
import { buildRules, STAKE_DISCLAIMER } from '../src/rules/index';
import { findForbiddenPhrases, type BlockSpec } from '@open-slot-ui/core';

const built = buildRules({
  about: 'A slot with a bonus.',
  howToPlay: ['Set your bet.', 'Spin.'],
  features: [{ title: 'Wild', text: 'Substitutes for all.' }],
  paytable: [{ kind: 'paytable', id: 'pt', rows: [{ symbol: 'A', payouts: '3: 5×' }] }],
  stats: { rtp: '96.00%', volatility: 'High', maxWin: '5,000×' },
});

const find = <K extends BlockSpec['kind']>(id: string, kind: K): Extract<BlockSpec, { kind: K }> =>
  built.menu.rules!.find((b) => b.id === id && b.kind === kind) as Extract<BlockSpec, { kind: K }>;

describe('buildRules — the compliant rules skeleton', () => {
  it('emits a User Interaction Guide (a steps list) describing every standard control', () => {
    const guide = find('r-ctrl', 'steps');
    expect(guide.items.length).toBeGreaterThanOrEqual(6);
    expect(guide.items.some((s) => /spin/i.test(s))).toBe(true);
    expect(guide.items.some((s) => /autoplay/i.test(s))).toBe(true);
    expect(guide.items.some((s) => /sound/i.test(s))).toBe(true);
  });

  it('emits a Game info grid with RTP + max win (from the report)', () => {
    const info = find('r-info', 'stat-grid');
    expect(info.items).toContainEqual({ label: 'RTP', value: '96.00%' });
    expect(info.items).toContainEqual({ label: 'Max win', value: '5,000×' });
  });

  it('emits the EXACT Stake disclaimer under a General heading', () => {
    const disc = find('r-general', 'text');
    expect(disc.text).toBe(STAKE_DISCLAIMER);
    expect(disc.text).toMatch(/malfunction voids all wins and plays/i);
    expect(disc.text).toMatch(/Remote Game Server/);
    // the disclaimer is legal-exact — it is NOT given a social override
    expect(built.socialEn[STAKE_DISCLAIMER]).toBeUndefined();
  });

  it('every core SOCIAL override is free of forbidden phrases (Stake.us gate)', () => {
    for (const [key, social] of Object.entries(built.socialEn)) {
      const matches = findForbiddenPhrases(social);
      expect(matches, `social of "${key}" → "${social}" trips: ${matches.map((m) => m.term).join(', ')}`).toEqual([]);
    }
  });

  it('can omit the disclaimer', () => {
    const b = buildRules({ disclaimer: false });
    expect(b.menu.rules!.some((x) => x.id === 'r-general')).toBe(false);
  });
});
