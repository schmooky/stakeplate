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
 * Pick the transport from the runtime: `?demo=true` (or a supplied `mock`) → the
 * in-process mock RGS; otherwise the real Stake transport.
 */
export function createNetwork(runtime: RuntimeConfig, mock?: MockNetworkManager): NetworkManager {
  if (runtime.demo || mock) return mock ?? new MockNetworkManager();
  return new StakeNetworkManager({
    rgsUrl: runtime.rgsUrl,
    sessionId: runtime.sessionId,
    language: runtime.language,
  });
}
