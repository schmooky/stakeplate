import { describe, it, expect } from 'vitest';
import { FSM, defaultPhases, type PhaseContext } from '../src/engine/index';
import { InstantTicker } from '../src/engine/ticker';
import { RootStore } from '../src/stores/index';
import { MockNetworkManager } from '../src/rgs/MockNetworkManager';
import type { NetworkManager } from '../src/rgs/network';
import { mockHud, type RecordingHud } from '../src/testing/index';
import { modeCostOf, type GameConfig } from '../src/game/config';

type Data = { won: number };

function makeGame(net: NetworkManager, balance = 100): { stores: RootStore; hud: RecordingHud; fsm: FSM<Data, null> } {
  const config: GameConfig = { title: 'T', modes: { base: 1, bonus: 185 } };
  const stores = new RootStore();
  stores.balance.setBet(1);
  stores.balance.setBalance(balance);
  const hud = mockHud();
  const fsm = new FSM<Data, null>(defaultPhases<Data, null>());
  const ctx: PhaseContext<Data, null> = {
    config,
    stores,
    network: net,
    hud,
    ticker: new InstantTicker(),
    view: null,
    audio: null,
    interpretBook: (_raw, info) => ({ won: info.totalWin }),
    fsm,
    round: null,
    modeCost: (mode) => modeCostOf(config, mode),
  };
  fsm.bind(ctx);
  return { stores, hud, fsm };
}

describe('engine — a full round runs headless (Idle → Spin → Present → Settle → Idle)', () => {
  it('debits the stake, settles the win, fires reportRound, lands on idle', async () => {
    const net = new MockNetworkManager({ balance: 100, modes: { base: 1 } }).forceRound({ win: 5 });
    const { stores, hud, fsm } = makeGame(net, 100);
    await fsm.transition('idle');
    await fsm.transition('spin');
    expect(fsm.current).toBe('idle');
    expect(stores.balance.balance).toBe(104); // 100 − 1 + 5 (server-authoritative)
    expect(stores.balance.lastWin).toBe(5);
    expect(stores.ui.spinning).toBe(false);
    expect(hud.reportedRounds()).toEqual([{ win: 5, bet: 1 }]);
  });

  it('a bonus buy charges the mode cost (185×)', async () => {
    const net = new MockNetworkManager({ balance: 1000, modes: { base: 1, bonus: 185 } }).forceRound({ win: 0 });
    const { stores, fsm } = makeGame(net, 1000);
    stores.ui.setOneShotMode('bonus');
    await fsm.transition('spin');
    expect(stores.balance.balance).toBe(1000 - 185);
  });

  it('an RGS error refunds the stake, shows the code, returns to idle', async () => {
    const net: NetworkManager = {
      authenticate: async () => ({ balance: { amount: 0, currency: 'USD' }, config: {} as never, round: null }),
      play: async () => {
        throw new Error('play failed ERR_IPB');
      },
      endRound: async () => ({ balance: { amount: 0, currency: 'USD' } }),
    };
    const { stores, hud, fsm } = makeGame(net, 50);
    await fsm.transition('spin');
    expect(fsm.current).toBe('idle');
    expect(stores.balance.balance).toBe(50); // refunded
    expect(hud.calls.some((c) => c.m === 'showRgsError' && c.args[0] === 'ERR_IPB')).toBe(true);
  });
});
