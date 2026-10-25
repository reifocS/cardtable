/**
 * GET /api/deck?url=<deck page>: a decklist as text, from a deck-building site.
 *
 * Archidekt has a public JSON API. Moxfield, MTGGoldfish, TappedOut and Magic Ville block server
 * requests, so for those the answer explains how to copy the list instead.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Only our own pages may ask (see api/turn.ts). */
function sameSite(request: Request): boolean {
  const from = request.headers.get('origin') ?? request.headers.get('referer');
  if (!from) return false;
  try {
    return new URL(from).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

interface ArchidektDeck {
  name: string;
  categories: { name: string; includedInDeck: boolean }[];
  cards: {
    quantity: number;
    categories: string[] | null;
    card: { collectorNumber?: string; edition?: { editioncode?: string }; oracleCard: { name: string } };
  }[];
}

/** Archidekt deck JSON → a decklist our parser reads (Commander / Deck / Sideboard sections). */
export function archidektToText(deck: ArchidektDeck): string {
  const excluded = new Set(deck.categories.filter((c) => !c.includedInDeck).map((c) => c.name));
  const sections: Record<'Commander' | 'Deck' | 'Sideboard', string[]> = { Commander: [], Deck: [], Sideboard: [] };
  for (const entry of deck.cards) {
    const cats = entry.categories ?? [];
    if (cats.includes('Maybeboard') || (cats.length && cats.every((c) => excluded.has(c)))) continue;
    const section = cats.includes('Commander') ? 'Commander' : cats.includes('Sideboard') ? 'Sideboard' : 'Deck';
    const { oracleCard, edition, collectorNumber } = entry.card;
    const printing = edition?.editioncode && collectorNumber ? ` (${edition.editioncode.toUpperCase()}) ${collectorNumber}` : '';
    sections[section].push(`${entry.quantity} ${oracleCard.name}${printing}`);
  }
  return (Object.entries(sections) as [string, string[]][])
    .filter(([, lines]) => lines.length)
    .map(([name, lines]) => `${name}\n${lines.join('\n')}`)
    .join('\n\n');
}

const BLOCKED: Record<string, string> = {
  'moxfield.com': 'Moxfield',
  'mtggoldfish.com': 'MTGGoldfish',
  'tappedout.net': 'TappedOut',
};

/** How to get a list out of a blocked site, when its export isn't simply called Export. */
const HOW_TO: Record<string, string> = {
  'magic-ville.com': 'Magic Ville doesn\'t allow this. On the deck page, click "Appr." next to Export, copy the list, and paste it here.',
};

export async function GET(request: Request): Promise<Response> {
  if (!sameSite(request)) return json({ error: 'forbidden' }, 403);
  let page: URL;
  try {
    page = new URL(new URL(request.url).searchParams.get('url') ?? '');
  } catch {
    return json({ error: 'That is not a link.' }, 400);
  }
  const host = page.hostname.replace(/^www\./, '');

  const archidekt = host === 'archidekt.com' && page.pathname.match(/\/decks\/(\d+)/);
  if (archidekt) {
    const res = await fetch(`https://archidekt.com/api/decks/${archidekt[1]}/`, { headers: { 'User-Agent': 'cardtable' } });
    if (res.status === 404) return json({ error: 'Deck not found (is it private?).' }, 404);
    if (!res.ok) return json({ error: `Archidekt answered ${res.status}.` }, 502);
    const deck = (await res.json()) as ArchidektDeck;
    return json({ name: deck.name, text: archidektToText(deck) });
  }

  if (HOW_TO[host]) return json({ error: HOW_TO[host] }, 422);
  const site = BLOCKED[host];
  if (site) return json({ error: `${site} doesn't allow this. On ${site}, use Export and copy the list as text, then paste it here.` }, 422);
  return json({ error: 'Only Archidekt links can be fetched. For other sites, copy the list as text and paste it here.' }, 422);
}
