// Network factory — picks an adapter based on the runtime config.
//
// To plug in a custom transport without editing this file, register a
// factory under your own RUNTIME.network value, or simply pass a
// pre-built NetworkManager instance to compose() — see composition.ts.

import { GAME } from '@/config/gameConfig';
import { getReplayParams } from '@/config/replay';
import { RUNTIME } from '@/config/runtime';
import { HttpNetworkManager } from './HttpNetworkManager';
import { MockNetworkManager } from './MockNetworkManager';
import { ReplayNetworkManager } from './ReplayNetworkManager';
import { StakeNetworkManager } from './StakeNetworkManager';
import type { NetworkManager } from './types';
import { WebSocketNetworkManager } from './WebSocketNetworkManager';

export function createNetwork(): NetworkManager {
  // Stake "bet replay" launch overrides every transport: a read-only,
  // session-less render of one historical round (see config/replay.ts).
  const replay = getReplayParams();
  if (replay) {
    return new ReplayNetworkManager({ params: replay, columns: GAME.columns, rows: GAME.rows });
  }

  switch (RUNTIME.network) {
    case 'http': {
      if (!RUNTIME.apiUrl) {
        throw new Error('[network] VITE_NETWORK=http but VITE_API_URL is not set');
      }
      return new HttpNetworkManager({
        baseUrl: RUNTIME.apiUrl,
        ...(RUNTIME.token ? { token: RUNTIME.token } : {}),
      });
    }
    case 'ws': {
      if (!RUNTIME.wsUrl) {
        throw new Error('[network] VITE_NETWORK=ws but VITE_WS_URL is not set');
      }
      return new WebSocketNetworkManager({
        url: RUNTIME.wsUrl,
        ...(RUNTIME.token ? { token: RUNTIME.token } : {}),
      });
    }
    case 'stake':
      return new StakeNetworkManager({
        rgsUrl: RUNTIME.rgsUrl,
        sessionId: RUNTIME.sessionId,
        columns: GAME.columns,
        rows: GAME.rows,
      });
    case 'mock':
      return new MockNetworkManager({
        symbolIds: GAME.symbolIds,
        columns: GAME.columns,
        rows: GAME.rows,
      });
    default: {
      const exhaustive: never = RUNTIME.network;
      throw new Error(`[network] unknown adapter: ${exhaustive as string}`);
    }
  }
}
