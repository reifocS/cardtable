import { describe, expect, it } from 'vitest';
import { parseDeck } from '../cards/deckParser';
import { applyPatch, diffState } from './diff';
import { Engine } from './engine';
import { apply } from './ops';
import { zoneId } from './state';
import { redact } from './visibility';

const faces = (n: number, prefix = 'Card') => Array.from({ length: n }, (_, i) => [{ name: `${prefix} ${i + 1}` }]);

function twoPlayers() {
  const e = new Engine();
  const a = e.join('Alice');
  const b = e.join('Bob');
  e.dispatch(a, { type: 'loadDeck', main: faces(40, 'A'), side: faces(2, 'SB'), commander: [] });
  e.dispatch(b, { type: 'loadDeck', main: faces(40, 'B'), side: [], commander: [] });
  return { e, a, b };
}

describe('ops', () => {
  it('loads decks into libraries and draws', () => {
    const { e, a } = twoPlayers();
    expect(e.state.zones[zoneId(a, 'library')].cards).toHaveLength(40);
    expect(e.state.zones[zoneId(a, 'sideboard')].cards).toHaveLength(2);
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 7 });
    expect(e.state.zones[zoneId(a, 'hand')].cards).toHaveLength(7);
    expect(e.state.zones[zoneId(a, 'library')].cards).toHaveLength(33);
    expect(e.state.log.at(-1)?.text).toBe('drew 7 cards');
  });

  it('merges consecutive single draws into one line', () => {
    const { e, a } = twoPlayers();
    for (let i = 0; i < 3; i++) e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 1 });
    expect(e.state.log.at(-1)?.text).toBe('drew 3 cards');
    expect(e.state.log.filter((l) => l.text.startsWith('drew'))).toHaveLength(1);
  });

  it('never mutates the previous state', () => {
    const { e, a } = twoPlayers();
    const before = e.state;
    const snapshot = JSON.stringify(before);
    apply(before, a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 3 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('moves to the battlefield, taps, and resets state when leaving it', () => {
    const { e, a } = twoPlayers();
    const id = e.state.zones[zoneId(a, 'library')].cards[0];
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'battlefield'), positions: { [id]: [100, 50] } });
    e.dispatch(a, { type: 'tap', cards: [id] });
    e.dispatch(a, { type: 'counter', cards: [id], key: '+1/+1', delta: 2 });
    let c = e.state.cards[id];
    expect([c.x, c.y, c.rotation, c.counters['+1/+1']]).toEqual([100, 50, 90, 2]);
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'graveyard') });
    c = e.state.cards[id];
    expect([c.rotation, c.counters]).toEqual([0, {}]);
    expect(e.state.log.at(-1)?.text).toMatch(/^moved A \d+ from Battlefield to Graveyard$/);
  });

  it('inserts at an index within the same zone', () => {
    const { e, a } = twoPlayers();
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 3 });
    const [x, y, z] = e.state.zones[zoneId(a, 'hand')].cards;
    e.dispatch(a, { type: 'move', cards: [z], to: zoneId(a, 'hand'), index: 0 });
    expect(e.state.zones[zoneId(a, 'hand')].cards).toEqual([z, x, y]);
  });

  it('merges consecutive life changes into one log line', () => {
    const { e, a } = twoPlayers();
    for (let i = 0; i < 3; i++) e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -1 });
    expect(e.state.players[a].trackers.Life).toBe(17);
    expect(e.state.log.at(-1)?.text).toBe('Life: 20 → 17');
    expect(e.state.log.filter((l) => l.text.startsWith('Life'))).toHaveLength(1);
  });

  it('sets life to 40 with a commander', () => {
    const e = new Engine();
    const a = e.join('Alice');
    e.dispatch(a, { type: 'loadDeck', main: faces(99), side: [], commander: faces(1, 'Cmdr') });
    expect(e.state.players[a].trackers.Life).toBe(40);
    expect(e.state.zones[zoneId(a, 'command')].cards).toHaveLength(1);
  });

  it('mulligans back to seven', () => {
    const { e, a } = twoPlayers();
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 7 });
    e.dispatch(a, { type: 'mulligan' });
    expect(e.state.zones[zoneId(a, 'hand')].cards).toHaveLength(7);
    expect(e.state.zones[zoneId(a, 'library')].cards).toHaveLength(33);
  });

  it('resets a deck: tokens disappear, cards go home', () => {
    const { e, a } = twoPlayers();
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'battlefield'), n: 5 });
    e.dispatch(a, { type: 'create', zone: zoneId(a, 'battlefield'), cards: [[{ name: 'Goblin' }]], token: true });
    e.dispatch(a, { type: 'resetDeck' });
    expect(e.state.zones[zoneId(a, 'battlefield')].cards).toHaveLength(0);
    expect(e.state.zones[zoneId(a, 'library')].cards).toHaveLength(40);
    expect(e.state.zones[zoneId(a, 'sideboard')].cards).toHaveLength(2);
  });

  it('passes the turn around the table and clears arrows', () => {
    const { e, a, b } = twoPlayers();
    const [c1] = e.state.zones[zoneId(a, 'library')].cards;
    e.dispatch(a, { type: 'arrow', from: c1, to: b });
    expect(e.state.arrows).toHaveLength(1);
    e.dispatch(a, { type: 'passTurn' });
    expect(e.state.turn.player).toBe(b);
    expect(e.state.arrows).toHaveLength(0);
    e.dispatch(b, { type: 'passTurn' });
    expect(e.state.turn.player).toBe(a);
  });
});

describe('commander', () => {
  function commanderGame() {
    const e = new Engine();
    const a = e.join('Alice');
    const b = e.join('Bob');
    e.dispatch(a, { type: 'loadDeck', main: faces(99), side: [], commander: [[{ name: 'Atraxa' }]] });
    const [cmdr] = e.state.zones[zoneId(a, 'command')].cards;
    return { e, a, b, cmdr };
  }

  it('adds 2 tax each time the commander goes from command zone to battlefield, and keeps it', () => {
    const { e, a, cmdr } = commanderGame();
    e.dispatch(a, { type: 'move', cards: [cmdr], to: zoneId(a, 'battlefield') });
    expect(e.state.cards[cmdr].tax).toBe(2);
    expect(e.state.log.at(-1)?.text).toBe('moved Atraxa from Command to Battlefield (commander tax now 2)');
    e.dispatch(a, { type: 'move', cards: [cmdr], to: zoneId(a, 'command') });
    e.dispatch(a, { type: 'move', cards: [cmdr], to: zoneId(a, 'battlefield') });
    expect(e.state.cards[cmdr].tax).toBe(4);
    e.dispatch(a, { type: 'commanderTax', cards: [cmdr], delta: -2 });
    expect(e.state.cards[cmdr].tax).toBe(2);
    e.dispatch(a, { type: 'resetDeck' });
    expect(e.state.cards[cmdr].tax).toBeUndefined();
  });

  it('commander damage accumulates per source, lowers life, and merges in the log', () => {
    const { e, a, b, cmdr } = commanderGame();
    e.dispatch(b, { type: 'loadDeck', main: faces(99), side: [], commander: [[{ name: 'Krenko' }]] });
    for (let i = 0; i < 3; i++) e.dispatch(a, { type: 'commanderDamage', player: b, from: cmdr, delta: 7 });
    expect(e.state.players[b].commanderDamage?.[cmdr]).toBe(21);
    expect(e.state.players[b].trackers.Life).toBe(19);
    expect(e.state.log.at(-1)?.text).toBe('Atraxa → Bob: 21 commander damage (lethal) · Life 40 → 19');
    e.dispatch(a, { type: 'commanderDamage', player: b, from: cmdr, delta: -30 });
    expect(e.state.players[b].commanderDamage?.[cmdr]).toBe(0);
    expect(e.state.players[b].trackers.Life).toBe(40);
  });
});

describe('visibility', () => {
  it('hides libraries from everyone and hands from opponents', () => {
    const { e, a, b } = twoPlayers();
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 2 });
    const [h1] = e.state.zones[zoneId(a, 'hand')].cards;
    const [l1] = e.state.zones[zoneId(a, 'library')].cards;
    const forA = redact(e.state, a);
    const forB = redact(e.state, b);
    expect(forA.cards[h1].faces).toHaveLength(1);
    expect(forB.cards[h1].faces).toHaveLength(0);
    expect(forA.cards[l1].faces).toHaveLength(0);
    // Sideboard is owner-only
    const [sb] = e.state.zones[zoneId(a, 'sideboard')].cards;
    expect(forA.cards[sb].faces).toHaveLength(1);
    expect(forB.cards[sb].faces).toHaveLength(0);
  });

  it('lets the owner peek at face-down cards, and reveals work until the card moves', () => {
    const { e, a, b } = twoPlayers();
    const [id] = e.state.zones[zoneId(a, 'library')].cards;
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'battlefield'), faceDown: true });
    expect(redact(e.state, a).cards[id].faces).toHaveLength(1);
    expect(redact(e.state, b).cards[id].faces).toHaveLength(0);
    expect(e.state.log.at(-1)?.text).toBe('moved a card from Library to Battlefield');
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'hand') });
    e.dispatch(a, { type: 'reveal', cards: [id], to: '*' });
    expect(redact(e.state, b).cards[id].faces).toHaveLength(1);
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'library') });
    expect(redact(e.state, b).cards[id].faces).toHaveLength(0);
  });

  it('peeks the top of the library only for the peeker', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    e.dispatch(a, { type: 'peek', zone: lib, n: 3 });
    const top = e.state.zones[lib].cards;
    expect(top.slice(0, 4).map((id) => redact(e.state, a).cards[id].faces.length)).toEqual([1, 1, 1, 0]);
    expect(redact(e.state, b).cards[top[0]].faces).toHaveLength(0);
    e.dispatch(a, { type: 'unpeek', zone: lib });
    expect(redact(e.state, a).cards[top[0]].faces).toHaveLength(0);
  });
});

describe('engine', () => {
  it('undoes only your own latest action', () => {
    const { e, a, b } = twoPlayers();
    e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -3 });
    e.dispatch(b, { type: 'undo' });
    expect(e.state.players[a].trackers.Life).toBe(17);
    e.dispatch(a, { type: 'undo' });
    expect(e.state.players[a].trackers.Life).toBe(20);
    expect(e.state.log.at(-1)?.text).toBe('undid their last action');
  });

  it('reconnects a player to their seat', () => {
    const e = new Engine();
    const a = e.join('Alice');
    e.setConnected(a, false);
    expect(e.join('Alice', a)).toBe(a);
    expect(e.state.seats).toEqual([a]);
    expect(e.state.players[a].connected).toBe(true);
  });

  it('ignores ops on unknown zones', () => {
    const { e, a } = twoPlayers();
    const before = e.state;
    e.dispatch(a, { type: 'shuffle', zone: 'nope' });
    expect(e.state).toBe(before);
  });
});

describe('parseDeck', () => {
  it('reads Arena exports with sections and printings', () => {
    const deck = parseDeck(`Commander
1 Atraxa, Praetors' Voice (2X2) 190

Deck
4 Lightning Bolt (M10) 146
2x Counterspell *F*

Sideboard
3 Duress`);
    expect(deck).toEqual([
      { count: 1, name: "Atraxa, Praetors' Voice", set: '2x2', cn: '190', section: 'commander' },
      { count: 4, name: 'Lightning Bolt', set: 'm10', cn: '146', section: 'main' },
      { count: 2, name: 'Counterspell', section: 'main' },
      { count: 3, name: 'Duress', section: 'side' },
    ]);
  });

  it('treats a blank line as the MTGO sideboard separator, and SB: lines', () => {
    const deck = parseDeck('4 Island\n\n2 Negate\nSB: 1 Duress');
    expect(deck.map((l) => [l.name, l.section])).toEqual([
      ['Island', 'main'],
      ['Negate', 'side'],
      ['Duress', 'side'],
    ]);
  });

  it('accepts image URLs for any game', () => {
    const deck = parseDeck('3 Pikachu | https://x.test/pika.png\nhttps://x.test/cards/Charizard%20EX.jpg?v=2');
    expect(deck).toEqual([
      { count: 3, name: 'Pikachu', image: 'https://x.test/pika.png', section: 'main' },
      { count: 1, name: 'Charizard EX', image: 'https://x.test/cards/Charizard%20EX.jpg?v=2', section: 'main' },
    ]);
  });
});

describe('diff', () => {
  it('patches reproduce every redacted view exactly', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const ops: [string, Parameters<Engine['dispatch']>[1]][] = [
      [a, { type: 'moveTop', from: lib, to: zoneId(a, 'hand'), n: 7 }],
      [a, { type: 'moveTop', from: lib, to: zoneId(a, 'battlefield'), n: 2 }],
      [b, { type: 'tracker', player: a, key: 'Life', delta: -3 }],
      [a, { type: 'peek', zone: lib, n: 3 }],
      [a, { type: 'create', zone: zoneId(a, 'battlefield'), cards: [[{ name: 'Goblin' }]], token: true }],
      [a, { type: 'undo' }],
      [a, { type: 'shuffle', zone: lib }],
      [b, { type: 'passTurn' }],
      [a, { type: 'resetDeck' }],
    ];
    for (const viewer of [a, b]) {
      let client = redact(e.state, viewer);
      const replay = new Engine(structuredClone(e.state));
      for (const [actor, op] of ops) {
        const before = redact(replay.state, viewer);
        replay.dispatch(actor, op);
        const after = redact(replay.state, viewer);
        client = applyPatch(client, diffState(before, after));
        expect(client).toEqual(after);
      }
    }
  });

  it('sends nothing but the length when nothing changed', () => {
    const { e, a } = twoPlayers();
    expect(diffState(redact(e.state, a), redact(e.state, a))).toEqual({ logLength: e.state.log.length });
  });
});
