// Network factory — picks an adapter from the runtime config.

import { GAME } from '@/config/gameConfig';
import { RUNTIME } from '@/config/runtime';
import { MockNetworkManager } from './MockNetworkManager';
import { StakeNetworkManager } from './StakeNetworkManager';
import type { NetworkManager } from './types';

export function createNetwork(): NetworkManager {
  if (RUNTIME.network === 'stake') {
    return new StakeNetworkManager({ rgsUrl: RUNTIME.rgsUrl, sessionId: RUNTIME.sessionId });
  }
  return new MockNetworkManager({ startingBalance: GAME.startingBalance });
}
