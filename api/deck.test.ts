import { afterEach, describe, expect, it, vi } from 'vitest';
import { archidektToText, GET } from './deck';
import { parseDeck } from '../src/cards/deckParser';

const req = (url: string) =>
  new Request(`https://cardtable.example/api/deck?url=${encodeURIComponent(url)}`, { headers: { origin: 'https://cardtable.example' } });

const DECK = {
  name: 'Fungus',
  categories: [
    { name: 'Commander', includedInDeck: true },
    { name: 'Ramp', includedInDeck: true },
    { name: 'Maybeboard', includedInDeck: false },
    { name: 'Ideas', includedInDeck: false },
  ],
  cards: [
    { quantity: 1, categories: ['Commander'], card: { collectorNumber: '227', edition: { editioncode: 'tsp' }, oracleCard: { name: 'Thelon of Havenwood' } } },
    { quantity: 30, categories: null, card: { oracleCard: { name: 'Forest' } } },
    { quantity: 1, categories: ['Ramp'], card: { collectorNumber: '1', edition: { editioncode: 'lea' }, oracleCard: { name: 'Sol Ring' } } },
    { quantity: 2, categories: ['Sideboard'], card: { oracleCard: { name: 'Naturalize' } } },
    { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Nope' } } },
    { quantity: 1, categories: ['Ideas'], card: { oracleCard: { name: 'Also nope' } } },
  ],
};

describe('/api/deck', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns an Archidekt deck into sections our parser reads, skipping the maybeboard', () => {
    const text = archidektToText(DECK);
    expect(parseDeck(text).map((l) => [l.section, l.count, l.name, l.set])).toEqual([
      ['commander', 1, 'Thelon of Havenwood', 'tsp'],
      ['main', 30, 'Forest', undefined],
      ['main', 1, 'Sol Ring', 'lea'],
      ['side', 2, 'Naturalize', undefined],
    ]);
  });

  it('fetches Archidekt decks by link', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(DECK));
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('https://archidekt.com/decks/1/fun_with_fungus'));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://archidekt.com/api/decks/1/');
    expect(await res.json()).toMatchObject({ name: 'Fungus' });
  });

  it('explains how to copy from sites that block it, and refuses other origins', async () => {
    const mox = await GET(req('https://www.moxfield.com/decks/abc'));
    expect(mox.status).toBe(422);
    expect((await mox.json()).error).toMatch(/Moxfield.*Export/);
    const mv = await GET(req('https://www.magic-ville.com/fr/decks/showdeck?ref=1110782'));
    expect(mv.status).toBe(422);
    expect((await mv.json()).error).toMatch(/Magic Ville.*Appr\./);
    expect((await GET(new Request('https://cardtable.example/api/deck?url=x'))).status).toBe(403);
  });
});
