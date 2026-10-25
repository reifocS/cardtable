/**
 * Dev-only game presets: ready-made tables to check the UI for visual regressions at a glance.
 * Built with the real ops, from a fixed seed, so a preset looks the same every time.
 * Load one from the lobby (dev builds only) or with ?preset=<id>.
 */
import { parseDeck } from '../cards/deckParser';
import { lookupKey, resolveCards } from '../cards/scryfall';
import { apply, type Op } from '../core/ops';
import { TABLE, addPlayer, createGame, zoneId } from '../core/state';
import type { CardFace, CardId, GameState, PlayerId } from '../core/types';
import type { Store } from '../ui/store';

/** Small deterministic RNG (mulberry32), so shuffles are the same on every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Faces = Map<string, CardFace[]>;

interface Play {
  x: number;
  /** 0 = row toward the middle of the table, 240 = row nearest the player. */
  y: number;
  tap?: boolean;
  faceDown?: boolean;
  counters?: Record<string, number>;
  from?: string;
}

/** Builds a game by applying ops, as players would. */
class Builder {
  s: GameState = createGame();
  private rng: () => number;

  constructor(
    private faces: Faces,
    seed = 7,
  ) {
    this.rng = seeded(seed);
  }

  op(actor: PlayerId, op: Op) {
    this.s = apply(this.s, actor, op, this.rng);
    return this;
  }

  player(name: string): PlayerId {
    const s = structuredClone(this.s);
    const id = addPlayer(s, name);
    this.s = s;
    return id;
  }

  deck(p: PlayerId, text: string) {
    const out = { main: [] as CardFace[][], side: [] as CardFace[][], commander: [] as CardFace[][] };
    for (const l of parseDeck(text)) {
      const faces = this.faces.get(lookupKey(l)) ?? [{ name: l.name, text: l.image ? undefined : '(offline: text card)' }];
      for (let i = 0; i < l.count; i++) out[l.section].push(faces);
    }
    return this.op(p, { type: 'loadDeck', ...out });
  }

  /** First card of `p` named `name` (prefix match, for double-faced names) in zone `role`. */
  find(p: PlayerId, name: string, role = 'library'): CardId {
    const z = this.s.zones[zoneId(p, role)];
    const id = z?.cards.find((c) => this.s.cards[c].faces[0]?.name.startsWith(name));
    if (!id) throw new Error(`Preset: no "${name}" in ${p}'s ${role}`);
    return id;
  }

  play(p: PlayerId, name: string, at: Play): CardId {
    const id = this.find(p, name, at.from);
    this.op(p, { type: 'move', cards: [id], to: zoneId(p, 'battlefield'), positions: { [id]: [at.x, at.y] }, faceDown: at.faceDown });
    if (at.tap) this.op(p, { type: 'tap', cards: [id], value: true });
    for (const [key, n] of Object.entries(at.counters ?? {})) this.op(p, { type: 'counter', cards: [id], key, delta: n });
    return id;
  }

  /** A row of cards, left to right. */
  row(p: PlayerId, names: string[], y: number, opts: Omit<Play, 'x' | 'y'> & { start?: number; step?: number } = {}) {
    const { start = 30, step = 120, ...rest } = opts;
    return names.map((n, i) => this.play(p, n, { ...rest, x: start + i * step, y }));
  }

  to(p: PlayerId, names: string[], role: string, from = 'library') {
    for (const n of names) this.op(p, { type: 'move', cards: [this.find(p, n, from)], to: zoneId(p, role) });
    return this;
  }

  draw(p: PlayerId, n: number) {
    return this.op(p, { type: 'moveTop', from: zoneId(p, 'library'), to: zoneId(p, 'hand'), n });
  }

  token(p: PlayerId, name: string, text: string, x: number, y: number) {
    return this.op(p, { type: 'create', zone: zoneId(p, 'battlefield'), token: true, cards: [[{ name, text }]], positions: [[x, y]] });
  }
}

// ---- decklists ----------------------------------------------------------------------------------

const WHITE = `Commander
1 Atraxa, Praetors' Voice

Deck
14 Plains
4 Serra Angel
4 Wedding Announcement
2 The Wandering Emperor
2 Elspeth Resplendent
2 Wrath of God
2 Sol Ring`;

const RED = `Commander
1 Krenko, Mob Boss

Deck
14 Mountain
4 Goblin Guide
4 Monastery Swiftspear
4 Lightning Bolt
2 Shivan Dragon
2 Bonesplitter
2 Fire // Ice`;

const BLUE = `Commander
1 Brazen Borrower

Deck
14 Island
4 Delver of Secrets
4 Snapcaster Mage
4 Counterspell
2 Arcane Signet`;

const BLACK = `14 Swamp
4 Dark Ritual
4 Duress
4 Thoughtseize
4 Tarmogoyf`;

const GREEN = `14 Forest
4 Llanowar Elves
4 Grizzly Bears
4 Rancor
2 Command Tower`;

const DECKS = [WHITE, RED, BLUE, BLACK, GREEN];

// ---- presets ------------------------------------------------------------------------------------

export interface DevPreset {
  id: string;
  name: string;
  covers: string;
  decks: string[];
  build(b: Builder): PlayerId;
  /** Every seat is played from this browser (two-seat practice). */
  controlsAll?: boolean;
  /** Open UI state once the table is up (a viewer, the zoomed board…). */
  after?(ctx: { me: PlayerId; state: GameState; dispatch: (op: Op) => void; set: (s: Partial<Store>) => void }): void;
}

/** Midgame board for a white or red player. */
function duelBoards(b: Builder, me: PlayerId, opp: PlayerId) {
  b.row(me, ['Plains', 'Plains', 'Plains', 'Plains'], 240, { start: 40, step: 95 });
  b.play(me, 'Plains', { x: 420, y: 240, tap: true });
  b.play(me, 'Sol Ring', { x: 540, y: 240 });
  const angel = b.play(me, 'Serra Angel', { x: 120, y: 0, counters: { '+1/+1': 2 } });
  b.play(me, 'Wedding Announcement', { x: 300, y: 0 });
  b.op(me, { type: 'transform', cards: [b.find(me, 'Wedding Announcement', 'battlefield')] });
  b.play(me, 'The Wandering Emperor', { x: 470, y: 0, counters: { Loyalty: 4 } });
  b.play(me, 'Serra Angel', { x: 650, y: 0, faceDown: true });
  b.token(me, 'Human', 'Creature — Human 1/1', 820, 0);
  b.to(me, ['Wrath of God', 'Plains'], 'graveyard');
  b.to(me, ['Elspeth Resplendent'], 'exile');
  b.draw(me, 6);

  b.row(opp, ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'], 240, { start: 60, step: 100 });
  const guide = b.play(opp, 'Goblin Guide', { x: 200, y: 0, tap: true });
  const splitter = b.find(opp, 'Bonesplitter');
  b.op(opp, { type: 'attach', cards: [splitter], to: guide });
  b.play(opp, 'Monastery Swiftspear', { x: 380, y: 0 });
  b.play(opp, 'Shivan Dragon', { x: 600, y: 0 });
  b.to(opp, ['Lightning Bolt', 'Lightning Bolt', 'Fire // Ice'], 'graveyard');
  b.draw(opp, 5);
  // A spell waiting on the stack, aimed at my Angel.
  const bolt = b.find(opp, 'Lightning Bolt');
  b.op(opp, { type: 'move', cards: [bolt], to: zoneId(TABLE, 'stack') });
  b.op(opp, { type: 'arrow', from: bolt, to: angel });
  b.op(opp, { type: 'tracker', player: me, key: 'Life', delta: -7 });
}

export const PRESETS: DevPreset[] = [
  {
    id: 'empty',
    name: 'Empty table',
    covers: 'First screen: import hint, empty piles and hand',
    decks: [],
    build: (b) => b.player('Alice'),
  },
  {
    id: 'duel',
    name: 'Duel, midgame',
    covers: 'Tapped, counters, face down, token, attachment, transformed DFC, piles, a spell on the stack, arrow, log',
    decks: [WHITE, RED],
    build(b) {
      const me = b.player('Alice');
      const bob = b.player('Bob');
      b.deck(me, WHITE).deck(bob, RED);
      duelBoards(b, me, bob);
      b.op(me, { type: 'setPlaymat', mat: 'medieval' }).op(bob, { type: 'setPlaymat', mat: 'futuristic' });
      b.op(me, { type: 'setSleeve', sleeve: 'midnight' }).op(bob, { type: 'setSleeve', sleeve: 'crimson' });
      return me;
    },
  },
  {
    id: 'commander4',
    name: 'Commander, 4 players',
    covers: 'Commanders, tax, commander damage, poison and energy, long names, busy boards, reveals, four playmats and sleeves',
    decks: [WHITE, RED, BLUE, BLACK],
    build(b) {
      const me = b.player('Alice');
      const bob = b.player('Bob');
      const carol = b.player('Carol Longname-Hyphenated');
      const dan = b.player('Dan');
      b.deck(me, WHITE).deck(bob, RED).deck(carol, BLUE).deck(dan, BLACK);
      duelBoards(b, me, bob);
      const looks = [[me, 'medieval', 'midnight'], [bob, 'futuristic', 'crimson'], [carol, 'arcane', 'emerald'], [dan, 'stone', 'circuit']] as const;
      for (const [p, mat, sleeve] of looks) b.op(p, { type: 'setPlaymat', mat }).op(p, { type: 'setSleeve', sleeve });
      const krenko = b.play(bob, 'Krenko', { x: 820, y: 0, from: 'command' });
      b.op(bob, { type: 'commanderDamage', player: me, from: krenko, delta: 9 });
      b.row(carol, ['Island', 'Island', 'Island', 'Island', 'Island', 'Island'], 240, { step: 110 });
      b.row(carol, ['Delver of Secrets', 'Snapcaster Mage', 'Delver of Secrets'], 0, { start: 120, step: 200 });
      b.op(carol, { type: 'transform', cards: [b.find(carol, 'Delver of Secrets', 'battlefield')] });
      b.play(carol, 'Brazen Borrower', { x: 800, y: 60, from: 'command' });
      b.op(carol, { type: 'move', cards: [b.find(carol, 'Brazen Borrower', 'battlefield')], to: zoneId(carol, 'command') });
      b.op(carol, { type: 'setTracker', player: carol, key: 'Poison', value: 3 }).op(carol, { type: 'setTracker', player: carol, key: 'Energy', value: 5 });
      b.draw(carol, 6);
      b.op(carol, { type: 'reveal', cards: [b.s.zones[zoneId(carol, 'hand')].cards[0]], to: '*' });
      b.row(dan, ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'], 240, { step: 100, tap: true });
      b.row(dan, ['Tarmogoyf', 'Tarmogoyf', 'Tarmogoyf'], 0, { start: 200, step: 260, counters: { '-1/-1': 1 } });
      b.to(dan, ['Thoughtseize', 'Duress', 'Dark Ritual', 'Dark Ritual'], 'graveyard');
      b.draw(dan, 4);
      b.op(me, { type: 'passTurn' }).op(bob, { type: 'passTurn' });
      return me;
    },
  },
  {
    id: 'crowded',
    name: 'Crowded board',
    covers: 'Overflow stress: 40 cards on my board, 25 in hand, 30 in graveyard',
    decks: [GREEN, GREEN, GREEN, BLACK],
    build(b) {
      const me = b.player('Alice');
      const bob = b.player('Bob');
      b.deck(me, `${GREEN}\n${GREEN}\n${GREEN}\n${GREEN}`).deck(bob, BLACK);
      const lib = () => b.s.zones[zoneId(me, 'library')].cards;
      const ids = lib().slice(0, 40);
      const positions: Record<CardId, [number, number]> = Object.fromEntries(
        ids.map((id, i) => [id, [(i % 20) * 62, i < 20 ? 240 : (i % 3) * 40]]),
      );
      b.op(me, { type: 'move', cards: ids, to: zoneId(me, 'battlefield'), positions });
      b.op(me, { type: 'tap', cards: ids.filter((_, i) => i % 4 === 0), value: true });
      b.op(me, { type: 'counter', cards: ids.slice(20, 30), key: '+1/+1', delta: 3 });
      b.draw(me, 25);
      b.op(me, { type: 'moveTop', from: zoneId(me, 'library'), to: zoneId(me, 'graveyard'), n: 30 });
      b.row(bob, ['Swamp', 'Swamp', 'Swamp'], 240);
      return me;
    },
  },
  {
    id: 'six',
    name: 'Six players',
    covers: 'Extreme layout: five opponent headers and boards side by side',
    decks: DECKS,
    build(b) {
      const names = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank Withaverylongname'];
      const ids = names.map((n) => b.player(n));
      // One basic land type per decklist, in DECKS order.
      const lands = ['Plains', 'Mountain', 'Island', 'Swamp', 'Forest'];
      ids.forEach((p, i) => {
        b.deck(p, DECKS[i % DECKS.length]);
        b.row(p, Array(5).fill(lands[i % lands.length]), 240, { step: 140, tap: i % 2 === 1 });
        b.draw(p, 7);
      });
      b.row(ids[1], ['Goblin Guide', 'Monastery Swiftspear'], 0, { start: 300, step: 300 });
      b.row(ids[4], ['Grizzly Bears', 'Llanowar Elves', 'Grizzly Bears'], 0, { start: 150, step: 300 });
      return ids[0];
    },
  },
  {
    id: 'anygame',
    name: 'Another game (text cards)',
    covers: 'Any-TCG case: cards with no image, long text, custom counters',
    decks: [],
    build(b) {
      const me = b.player('Ash');
      const misty = b.player('Misty');
      const card = (name: string, text: string) => [{ name, text }];
      const deck = [
        card('Pikachu', 'Basic Pokémon · 60 HP\nThunder Shock: flip a coin. If heads, the Defending Pokémon is now Paralyzed.'),
        card('Charmander', 'Basic Pokémon · 70 HP\nEmber: discard an Energy attached to this Pokémon.'),
        card('Lightning Energy', 'Basic Energy'),
        card('Professor’s Research', 'Trainer · Supporter\nDiscard your hand and draw 7 cards.'),
      ];
      const main = Array.from({ length: 40 }, (_, i) => deck[i % deck.length]);
      b.op(me, { type: 'loadDeck', main, side: [], commander: [] }).op(misty, { type: 'loadDeck', main, side: [], commander: [] });
      b.op(me, { type: 'setTracker', player: me, key: 'Prizes', value: 6 }).op(misty, { type: 'setTracker', player: misty, key: 'Prizes', value: 4 });
      b.row(me, ['Pikachu', 'Charmander'], 0, { start: 200, step: 300, counters: { Damage: 20 } });
      b.row(me, ['Lightning Energy', 'Lightning Energy'], 240, { start: 200, step: 120 });
      b.row(misty, ['Charmander', 'Pikachu', 'Pikachu'], 0, { start: 150, step: 250 });
      b.draw(me, 7).draw(misty, 7);
      return me;
    },
  },
  {
    id: 'selfplay',
    name: 'Two-seat practice',
    covers: 'Playing both sides: seat switcher in the top bar (or `)',
    decks: [WHITE, RED],
    controlsAll: true,
    build: (b) => PRESETS.find((p) => p.id === 'duel')!.build(b),
  },
  {
    id: 'viewer',
    name: 'Library search open',
    covers: 'Zone viewer with filter over a midgame duel',
    decks: [WHITE, RED],
    build(b) {
      const me = b.player('Alice');
      const bob = b.player('Bob');
      b.deck(me, WHITE).deck(bob, RED);
      duelBoards(b, me, bob);
      return me;
    },
    after({ me, dispatch, set }) {
      const zone = zoneId(me, 'library');
      dispatch({ type: 'peek', zone });
      set({ viewer: { zone, peeked: true } });
    },
  },
  {
    id: 'focus',
    name: 'Opponent board in big',
    covers: 'Zoomable opponent board over a 4-player game',
    decks: [WHITE, RED, BLUE, BLACK],
    build: (b) => PRESETS.find((p) => p.id === 'commander4')!.build(b),
    after({ state, me, set }) {
      set({ focus: state.seats.find((p) => p !== me) ?? null });
    },
  },
];

const FACES_CACHE = 'cardtable:dev:faces';

/** Card faces for every decklist, from Scryfall once, then from a local cache. */
async function loadFaces(decks: string[]): Promise<Faces> {
  let cache: Record<string, CardFace[]> = {};
  try {
    cache = JSON.parse(localStorage.getItem(FACES_CACHE) ?? '{}');
  } catch {
    // Corrupt cache: refetch.
  }
  const lines = decks.flatMap(parseDeck).filter((l) => !l.image);
  const missing = lines.filter((l) => !cache[lookupKey(l)]);
  if (missing.length) {
    try {
      const { found } = await resolveCards(missing);
      for (const [k, v] of found) cache[k] = v;
      localStorage.setItem(FACES_CACHE, JSON.stringify(cache));
    } catch (e) {
      console.warn('Presets: Scryfall unavailable, using text cards', e);
    }
  }
  return new Map(Object.entries(cache));
}

/** Builds a preset with the given faces (an empty map gives text cards, as offline). */
export function buildWith(p: DevPreset, faces: Faces = new Map()): { state: GameState; me: PlayerId } {
  const b = new Builder(faces);
  const me = p.build(b);
  return { state: b.s, me };
}

export async function buildPreset(p: DevPreset): Promise<{ state: GameState; me: PlayerId }> {
  return buildWith(p, await loadFaces(p.decks));
}
