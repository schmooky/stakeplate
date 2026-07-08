// Runtime config — environment + URL knobs that pick which transport
// the client uses, where it points, and what credentials it carries.
//
// `GAME` (./gameConfig.ts) is *build-time* shape: grid dims, symbol ids.
// `RUNTIME` (this file) is *deploy-time* wiring: server URL, network
// kind, auth token. Anything that should differ between dev / staging /
// integration / production goes here.
//
// Vite reads `import.meta.env.VITE_*` from `.env*` files at build time.
// See `.env.example` for the full list and defaults.
//
// URL params win over env vars — handy for QA links and operator overrides.

export type NetworkKind = 'mock' | 'http' | 'ws' | 'stake';

export interface RuntimeConfig {
  /** Which transport to instantiate. Defaults to 'stake'. */
  network: NetworkKind;
  /** Base URL for HTTP transport (e.g. https://rgs.example.com/api). */
  apiUrl: string;
  /** WebSocket URL for WS transport (wss://...). */
  wsUrl: string;
  /** Stake Engine RGS base URL (the local emulator in dev, a Carrot RGS in prod). */
  rgsUrl: string;
  /** Stake session id (lobby-supplied; any stable string works in dev). */
  sessionId: string;
  /** Lobby-supplied auth token (sessionToken / token URL params, or VITE_AUTH_TOKEN). */
  token: string | undefined;
  /** Free-form lobby/operator id passed to the server. */
  lobbyId: string | undefined;
}

const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

function param(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get(name);
  return value ?? undefined;
}

function pick<T extends string>(values: readonly T[], raw: string | undefined, fallback: T): T {
  if (raw && (values as readonly string[]).includes(raw)) return raw as T;
  return fallback;
}

const NETWORKS = ['mock', 'http', 'ws', 'stake'] as const;

export const RUNTIME: RuntimeConfig = {
  network: pick(NETWORKS, param('network') ?? env.VITE_NETWORK, 'stake'),
  apiUrl: param('apiUrl') ?? env.VITE_API_URL ?? '',
  wsUrl: param('wsUrl') ?? env.VITE_WS_URL ?? '',
  // Local dev default. Port 4757 is lucky-magnet's own — kept distinct from the
  // common 4747 so its emulator never collides with a sibling project's.
  rgsUrl: param('rgsUrl') ?? param('rgs_url') ?? env.VITE_RGS_URL ?? 'http://localhost:4757',
  sessionId: param('sessionID') ?? param('sessionId') ?? env.VITE_SESSION_ID ?? 'dev',
  token: param('token') ?? param('sessionToken') ?? env.VITE_AUTH_TOKEN,
  lobbyId: param('lobbyId') ?? env.VITE_LOBBY_ID,
};
