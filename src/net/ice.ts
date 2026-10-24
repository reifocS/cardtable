/**
 * ICE servers for WebRTC. STUN finds a direct route; when networks block that (strict NATs,
 * corporate or mobile networks), a TURN relay carries the traffic instead.
 *
 * Production builds ask our own /api/turn (Cloudflare credentials, see api/turn.ts). Override with:
 *   VITE_TURN_CREDENTIALS_URL  URL returning an RTCIceServer[] (e.g. Metered's credentials API)
 *   VITE_ICE_SERVERS           RTCIceServer[] as JSON
 * If none answers, connections stay direct (STUN only).
 */
const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

let cached: Promise<RTCIceServer[]> | null = null;

async function load(): Promise<RTCIceServer[]> {
  const url = import.meta.env.VITE_TURN_CREDENTIALS_URL ?? (import.meta.env.PROD ? '/api/turn' : undefined);
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) return [...STUN, ...((await res.json()) as RTCIceServer[])];
    } catch (e) {
      console.warn('TURN credentials unavailable, direct connections only', e);
    }
  }
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (raw) {
    try {
      return [...STUN, ...(JSON.parse(raw) as RTCIceServer[])];
    } catch (e) {
      console.warn('VITE_ICE_SERVERS is not valid JSON', e);
    }
  }
  return STUN;
}

export function iceServers() {
  cached ??= load();
  return cached;
}

/** How an open connection is routed: 'direct' (same network or punched through) or 'relay' (via TURN). */
export async function routeOf(pc: RTCPeerConnection | undefined): Promise<'direct' | 'relay' | null> {
  if (!pc) return null;
  const stats = await pc.getStats();
  for (const report of stats.values()) {
    if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
      const local = stats.get(report.localCandidateId);
      return local?.candidateType === 'relay' ? 'relay' : 'direct';
    }
  }
  return null;
}
