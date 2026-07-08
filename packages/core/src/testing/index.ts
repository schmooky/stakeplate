// @stakeplate/core/testing — the dev kit. The InstantTicker + MockNetworkManager (both
// re-exported) let a whole round run headless + deterministically; `mockHud()` is a
// no-op HudPort that records calls so tests can assert on what the engine drove.

import type { HudPort, ReplayInfo } from '../engine/hud-port';

export { InstantTicker } from '../engine/ticker';
export { MockNetworkManager } from '../rgs/MockNetworkManager';
export type { ScriptedRound, MockOptions } from '../rgs/MockNetworkManager';

/** A recording no-op HudPort — inspect `.calls` in tests. */
export interface RecordingHud extends HudPort {
  readonly calls: Array<{ m: string; args: unknown[] }>;
  reportedRounds(): Array<{ win: number; bet: number }>;
}

export function mockHud(): RecordingHud {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  const rec = (m: string) => (...args: unknown[]) => {
    calls.push({ m, args });
  };
  return {
    calls,
    setBalance: rec('setBalance'),
    setBet: rec('setBet'),
    setTotalWin: rec('setTotalWin'),
    setFreeSpins: rec('setFreeSpins'),
    reportRound: rec('reportRound'),
    showRgsError: rec('showRgsError'),
    showError: rec('showError'),
    setReplay: rec('setReplay'),
    replayStart: rec('replayStart') as (info: ReplayInfo, onPlay?: () => void) => void,
    replayEnd: rec('replayEnd') as (info: ReplayInfo, onReplay: () => void) => void,
    lockInput: rec('lockInput'),
    unlockInput: rec('unlockInput'),
    on: (_type: string, _fn: (p: unknown) => void) => () => {},
    reportedRounds() {
      return calls.filter((c) => c.m === 'reportRound').map((c) => ({ win: c.args[0] as number, bet: c.args[1] as number }));
    },
  };
}
