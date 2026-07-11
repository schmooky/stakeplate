import { describe, it, expect } from 'vitest';
import { currencyFor, EXTRA_DECIMALS } from '../src/currency';
import { formatAmount } from '@open-slot-ui/core';

describe('currencyFor — 3-decimal fiat the lib table lacks', () => {
  it('resolves OMR (and the other dinars/rials) to 3 decimals', () => {
    for (const code of Object.keys(EXTRA_DECIMALS)) {
      expect(currencyFor(code).decimals, code).toBe(3);
      expect(currencyFor(code.toLowerCase()).decimals, code).toBe(3); // case-insensitive
    }
  });

  it('renders a sub-unit OMR win (min bet 0.01 × min coef 0.2 = 0.002) without truncating', () => {
    const omr = currencyFor('OMR');
    expect(formatAmount(0.002, omr)).toMatch(/0\.002/); // NOT "0.00"
    expect(formatAmount(0.01, omr)).toMatch(/0\.010/);
  });

  it('passes known codes straight through the lib table', () => {
    expect(currencyFor('USD').decimals).toBe(2);
    expect(currencyFor('JPY').decimals).toBe(0);
    expect(currencyFor('KWD').decimals).toBe(3); // lib already knows this one
  });

  it('falls back to 2 decimals for an unknown code', () => {
    expect(currencyFor('ABC').decimals).toBe(2);
  });
});
