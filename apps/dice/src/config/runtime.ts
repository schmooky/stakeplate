// Runtime config — picks the transport and where it points. URL params win over
// env vars. The dice RGS emulator runs on its own port (4758).

export type NetworkKind = 'mock' | 'stake';

export interface RuntimeConfig {
  network: NetworkKind;
  rgsUrl: string;
  sessionId: string;
}

const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

function param(name: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

function pick<T extends string>(values: readonly T[], raw: string | undefined, fallback: T): T {
  return raw && (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export const RUNTIME: RuntimeConfig = {
  network: pick(['mock', 'stake'] as const, param('network') ?? env.VITE_NETWORK, 'stake'),
  rgsUrl: param('rgsUrl') ?? param('rgs_url') ?? env.VITE_RGS_URL ?? 'http://localhost:4758',
  sessionId: param('sessionID') ?? param('sessionId') ?? env.VITE_SESSION_ID ?? 'dev',
};
