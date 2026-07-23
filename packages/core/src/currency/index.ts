// @stakeplate/core/currency — currency resolution with the 3-decimal fiat the
// @open-slot-ui table doesn't (yet) carry patched in.
//
// The lib's `resolveCurrency` knows the common codes (USD 2dp, JPY 0dp, BTC 8dp, the
// Kuwaiti/Bahraini/Jordanian dinars KWD/BHD/JOD 3dp, the Stake social coins, …). For a
// code it DOESN'T know it falls back to 2 decimals — which silently truncates the sub-unit
// of the other three-decimal currencies. That matters: e.g. the Omani Rial's minimal
// stake 0.01 at the lowest ×0.2 coefficient is a 0.002 win, which renders as "0.00" at
// two decimals. `currencyFor` passes the correct precision (+ a sensible symbol) through
// `resolveCurrency`'s overrides so the full digits show end-to-end (bet, balance, net,
// win plaque, buy modal, replay).

import { resolveCurrency, type CurrencySpec } from '@open-slot-ui/core';

/** Three-decimal fiat missing from the @open-slot-ui currency table — the Gulf/Arab
 *  dinars & rials (the lib already covers KWD/BHD/JOD). `symbol` follows the lib's short
 *  latinised convention for the region (KWD→"KD", …). */
export const EXTRA_DECIMALS: Readonly<Record<string, { decimals: number; symbol: string }>> = {
  OMR: { decimals: 3, symbol: 'OMR' }, // Omani Rial
  TND: { decimals: 3, symbol: 'DT' },  // Tunisian Dinar
  LYD: { decimals: 3, symbol: 'LD' },  // Libyan Dinar
  IQD: { decimals: 3, symbol: 'IQD' }, // Iraqi Dinar
};

/** Symbol-only fixes required by Stake's RGS-communication approval guidelines, layered on
 *  top of the @open-slot-ui table (which is otherwise correct on precision + symbol side).
 *  Danish Krone must read "KR" — the lib ships lowercase "kr". Taiwan Dollar already resolves
 *  to the accepted "NT$", so it needs no override. */
export const SYMBOL_OVERRIDES: Readonly<Record<string, string>> = {
  DKK: 'KR', // Danish Krone → "KR"
};

/**
 * `resolveCurrency`, but with the missing 3-decimal dinars/rials patched in and the
 * approval-mandated symbol fixes applied. Use this everywhere a currency code becomes a
 * `CurrencySpec` so precision + symbol are correct for every code — `createStakeGame`
 * routes all of its resolution through here.
 */
export function currencyFor(code: string): CurrencySpec {
  const up = code ? code.toUpperCase() : '';
  const symbol = up ? SYMBOL_OVERRIDES[up] : undefined;
  const overrides = { ...(up ? EXTRA_DECIMALS[up] : undefined), ...(symbol ? { symbol } : undefined) };
  return Object.keys(overrides).length ? resolveCurrency(code, overrides) : resolveCurrency(code);
}
