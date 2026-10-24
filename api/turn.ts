/**
 * GET /api/turn: short-lived TURN credentials from Cloudflare Realtime, as an RTCIceServer[].
 *
 * The API token stays on the server; browsers only ever see credentials that expire after TTL.
 * Needs two environment variables (Vercel → Settings → Environment Variables):
 *   CLOUDFLARE_TURN_KEY_ID         the TURN key's id
 *   CLOUDFLARE_TURN_KEY_API_TOKEN  the TURN key's API token
 * Without them it answers 503 and the app falls back to direct (STUN-only) connections.
 */

/** Long enough for a game night. */
const TTL_SECONDS = 6 * 60 * 60;

type IceServer = { urls: string | string[]; username?: string; credential?: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Only our own pages may ask: stops other sites from spending our relay bandwidth. */
function sameSite(request: Request): boolean {
  const from = request.headers.get('origin') ?? request.headers.get('referer');
  if (!from) return false;
  try {
    return new URL(from).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Browsers block port 53, and trying it only slows connection setup down. */
function dropPort53(servers: IceServer[]): IceServer[] {
  return servers
    .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length > 0);
}

export async function GET(request: Request): Promise<Response> {
  if (!sameSite(request)) return json({ error: 'forbidden' }, 403);

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !token) return json({ error: 'TURN is not configured' }, 503);

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  if (!res.ok) {
    console.error('Cloudflare TURN error', res.status, await res.text());
    return json({ error: 'TURN provider error' }, 502);
  }
  const body = (await res.json()) as { iceServers?: IceServer | IceServer[] };
  const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
  return json(dropPort53(servers));
}
