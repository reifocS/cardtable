import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './turn';

const req = (origin?: string) =>
  new Request('https://cardtable.example/api/turn', { headers: origin ? { origin } : {} });

describe('/api/turn', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key123';
    process.env.CLOUDFLARE_TURN_KEY_API_TOKEN = 'secret';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  });

  it('refuses requests from other sites', async () => {
    expect((await GET(req('https://evil.example'))).status).toBe(403);
    expect((await GET(req())).status).toBe(403);
  });

  it('answers an empty list when not configured', async () => {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    const res = await GET(req('https://cardtable.example'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('asks Cloudflare with the secret and returns ice servers without port 53', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
            username: 'u',
            credential: 'c',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('https://cardtable.example'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(await res.json()).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
  });

  it('reports provider failures as 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await GET(req('https://cardtable.example'))).status).toBe(502);
  });
});
