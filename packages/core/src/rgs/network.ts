// The transport seam. Adapters return RAW protocol shapes; the engine applies the
// game's `interpretBook` and owns the round lifecycle (settle / resume).

import type { AuthenticateResponse, EndRoundResponse, PlayResponse, ReplayParams, Round } from './protocol';
import type { RuntimeConfig } from './runtime';
import { StakeNetworkManager } from './StakeNetworkManager';
import { MockNetworkManager } from './MockNetworkManager';

export interface PlayArgs {
  /** Base bet in MAJOR units (the transport converts to API units). */
  bet: number;
  /** Mode key — base / a boost / a bonus buy. The platform applies its cost. */
  mode: string;
  /** Currency code; defaults to the one learned at authenticate. */
  currency?: string;
}

export interface NetworkManager {
  authenticate(): Promise<AuthenticateResponse>;
  play(args: PlayArgs): Promise<PlayResponse>;
  endRound(): Promise<EndRoundResponse>;
  /** Optional — fetch a recorded round for read-only replay. */
  replay?(params: ReplayParams): Promise<Round>;
  dispose?(): void;
}

/**
 * Pick the transport from the launch runtime:
 *
 *   - a supplied `mock` instance, or `?mock=true`  → the in-process mock RGS (no backend)
 *   - a real `rgs_url` was provided                → the REAL Stake RGS. This INCLUDES a
 *       `?demo=true` fun-play launch: a Stake demo session still authenticates + plays
 *       against `rgs_url`, so `demo` must NOT force the mock.
 *   - `?demo=true` with NO host                    → the mock (bare local click-around)
 *   - otherwise                                    → the real transport at the default
 *       (local emulator) host
 *
 * This is the key fix over the old `demo → mock`: Stake's own local-redirect dev tool opens
 * `…?rgs_url=rgsd.stake-engine.com&sessionID=…&demo=true`. Under the old rule that demo
 * session was hijacked by the in-process mock and never reached the RGS; now it authorizes
 * on Stake, pulls the real balance/config, and spins/buys with real requests.
 */
export function createNetwork(runtime: RuntimeConfig, mock?: MockNetworkManager): NetworkManager {
  if (mock) return mock;
  if (runtime.mock) return new MockNetworkManager();
  if (runtime.rgsUrlProvided) return stakeTransport(runtime);
  if (runtime.demo) return new MockNetworkManager();
  return stakeTransport(runtime);
}

function stakeTransport(runtime: RuntimeConfig): StakeNetworkManager {
  return new StakeNetworkManager({
    rgsUrl: runtime.rgsUrl,
    sessionId: runtime.sessionId,
    language: runtime.language,
  });
}
