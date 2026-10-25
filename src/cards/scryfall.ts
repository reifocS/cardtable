import type { CardFace } from '../core/types';
import { frontName, norm } from './deckParser';

const API = 'https://api.scryfall.com';
const BATCH = 75;

interface ScryCard {
  name: string;
  set: string;
  set_name?: string;
  collector_number: string;
  type_line?: string;
  oracle_text?: string;
  cmc?: number;
  id?: string;
  all_parts?: { id: string; name: string; component: string }[];
  image_uris?: { normal: string; large: string };
  card_faces?: { name: string; type_line?: string; oracle_text?: string; image_uris?: { normal: string; large: string } }[];
}

export function facesOf(c: ScryCard): CardFace[] {
  const faces = rawFaces(c).map((f) => (c.cmc === undefined ? f : { ...f, cost: c.cmc }));
  const tokens = c.all_parts?.filter((p) => p.component === 'token' && p.id !== c.id);
  if (tokens?.length) faces[0].tokens = [...new Map(tokens.map((t) => [t.name, { id: t.id, name: t.name }])).values()];
  return faces;
}

function rawFaces(c: ScryCard): CardFace[] {
  if (c.card_faces?.[0]?.image_uris) {
    return c.card_faces.map((f) => ({
      name: f.name,
      image: f.image_uris?.normal,
      imageLarge: f.image_uris?.large,
      type: f.type_line,
      text: f.oracle_text,
    }));
  }
  // Split and adventure cards: one image, the faces' text joined.
  const text = c.oracle_text ?? c.card_faces?.map((f) => f.oracle_text).join('\n//\n');
  return [{ name: c.name, image: c.image_uris?.normal, imageLarge: c.image_uris?.large, type: c.type_line, text }];
}

export interface Lookup {
  name: string;
  set?: string;
  cn?: string;
}

export const lookupKey = (l: Lookup) => (l.set && l.cn ? `set:${l.set}:${l.cn}` : `name:${norm(l.name)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function collection(identifiers: object[]): Promise<{ data: ScryCard[]; not_found: object[] }> {
  const res = await fetch(`${API}/cards/collection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identifiers }),
  });
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  return res.json();
}

/**
 * Resolves card names (optionally with set/collector number) to faces.
 * Tries the exact printing first, then falls back to the name alone.
 */
export async function resolveCards(
  lookups: Lookup[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ found: Map<string, CardFace[]>; missing: string[] }> {
  const byKey = new Map<string, ScryCard>();
  const register = (c: ScryCard) => {
    byKey.set(`set:${c.set}:${c.collector_number}`, c);
    byKey.set(`name:${norm(c.name)}`, c);
    for (const f of c.card_faces ?? []) if (!byKey.has(`name:${norm(f.name)}`)) byKey.set(`name:${norm(f.name)}`, c);
  };
  const keyOf = lookupKey;
  const find = (l: Lookup) =>
    (l.set && l.cn && byKey.get(`set:${l.set}:${l.cn}`)) || byKey.get(`name:${norm(l.name)}`) || byKey.get(`name:${norm(frontName(l.name))}`);

  const unique = [...new Map(lookups.map((l) => [keyOf(l), l])).values()];
  const run = async (list: Lookup[], ident: (l: Lookup) => object) => {
    for (let i = 0; i < list.length; i += BATCH) {
      const res = await collection(list.slice(i, i + BATCH).map(ident));
      res.data.forEach(register);
      onProgress?.(Math.min(i + BATCH, list.length), list.length);
      if (i + BATCH < list.length) await sleep(100);
    }
  };

  await run(unique, (l) => (l.set && l.cn ? { set: l.set, collector_number: l.cn } : { name: l.name }));
  const retry = unique.filter((l) => !find(l));
  if (retry.length) await run(retry, (l) => ({ name: frontName(l.name) }));

  const found = new Map<string, CardFace[]>();
  const missing: string[] = [];
  for (const l of unique) {
    const c = find(l);
    if (c) found.set(keyOf(l), facesOf(c));
    else missing.push(l.name);
  }
  return { found, missing };
}

/** One card by its Scryfall id (e.g. a related token). */
export async function fetchCard(id: string): Promise<CardFace[]> {
  const res = await fetch(`${API}/cards/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  return facesOf(await res.json());
}

export interface Printing {
  faces: CardFace[];
  set: string;
  cn: string;
  label: string;
}

const NORMAL = 'https://cards.scryfall.io/normal/';

/**
 * Every size a face's image comes in, as a srcset, so the browser downloads the smallest that's
 * sharp where the card is shown. Scryfall serves each image at fixed widths; other images have one.
 */
export function imageSet(face: CardFace): string | undefined {
  if (!face.image?.startsWith(NORMAL)) return undefined;
  const small = face.image.replace(NORMAL, 'https://cards.scryfall.io/small/');
  return `${small} 146w, ${face.image} 488w${face.imageLarge ? `, ${face.imageLarge} 672w` : ''}`;
}

/** Cards resolved from Scryfall, whose other printings can be listed. */
export const isScryfallCard = (faces: CardFace[]) => !!faces[0]?.image?.startsWith('https://cards.scryfall.io/');

/** Every printing of a card with an image, newest first (the first page: plenty, except for basic lands). */
export async function printingsOf(name: string): Promise<Printing[]> {
  const q = `!"${frontName(name).replace(/"/g, '')}"`;
  const res = await fetch(`${API}/cards/search?unique=prints&order=released&dir=desc&q=${encodeURIComponent(q)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  const body: { data: ScryCard[] } = await res.json();
  return body.data
    .map((c) => ({ faces: facesOf(c), set: c.set, cn: c.collector_number, label: `${c.set_name ?? c.set.toUpperCase()} · #${c.collector_number}` }))
    .filter((p) => p.faces[0].image);
}

/** Full-text Scryfall search, tokens included. */
export async function searchCards(query: string): Promise<CardFace[][]> {
  const res = await fetch(`${API}/cards/search?include_extras=true&q=${encodeURIComponent(query)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
  const body: { data: ScryCard[] } = await res.json();
  return body.data.slice(0, 60).map(facesOf);
}
