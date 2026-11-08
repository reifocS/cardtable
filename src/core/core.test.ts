import { describe, expect, it } from 'vitest';
import { parseDeck, withPrinting } from '../cards/deckParser';
import { imageSet } from '../cards/scryfall';
import { firesOn, triggersOf } from '../cards/triggers';
import { manaOf, poolOf } from '../cards/mana';
import { applyPatch, diffState } from './diff';
import { Engine } from './engine';
import { LIMITS, apply, cleanFace } from './ops';
import { TABLE, createGame, migrateGame, zoneId } from './state';
import type { Preset } from './types';
import { redact } from './visibility';

const faces = (n: number, prefix = 'Card') => Array.from({ length: n }, (_, i) => [{ name: `${prefix} ${i + 1}` }]);

function twoPlayers() {
  const e = new Engine();
  const a = e.join('Alice');
  const b = e.join('Bob');
  e.dispatch(a, { type: 'loadDeck', sections: { main: faces(40, 'A'), side: faces(2, 'SB'), commander: [] } });
  e.dispatch(b, { type: 'loadDeck', sections: { main: faces(40, 'B'), side: [], commander: [] } });
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
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(99), side: [], commander: faces(1, 'Cmdr') } });
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

  it('lets anyone choose the starting player, or pick one at random', () => {
    const { e, a, b } = twoPlayers();
    e.dispatch(a, { type: 'passTurn' });
    e.dispatch(a, { type: 'setTurn', player: b, restart: true });
    expect(e.state.turn).toEqual({ player: b, number: 1 });
    expect(e.state.log.at(-1)?.text).toBe('Bob goes first');
    e.dispatch(b, { type: 'setTurn', player: a });
    expect(e.state.turn).toEqual({ player: a, number: 1 });
    e.dispatch(a, { type: 'setTurn', player: 'random', restart: true });
    expect([a, b]).toContain(e.state.turn.player);
    expect(e.state.log.at(-1)?.text).toMatch(/goes first \(picked at random\)$/);
  });

  it('discards or reveals a random card, with the host picking', () => {
    const { e, a, b } = twoPlayers();
    const hand = zoneId(a, 'hand');
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: hand, n: 5 });
    e.dispatch(b, { type: 'random', zone: hand, action: 'discard' });
    expect(e.state.zones[hand].cards).toHaveLength(4);
    expect(e.state.zones[zoneId(a, 'graveyard')].cards).toHaveLength(1);
    expect(e.state.log.at(-1)?.text).toMatch(/^discarded A \d+ at random from Alice's Hand$/);
    e.dispatch(a, { type: 'random', zone: hand, action: 'reveal' });
    const revealed = e.state.zones[hand].cards.filter((id) => e.state.cards[id].revealedTo.includes('*'));
    expect(revealed).toHaveLength(1);
    expect(redact(e.state, b).cards[revealed[0]].faces).toHaveLength(1);
  });

  it('passes the turn around the table and clears arrows', () => {
    const { e, a, b } = twoPlayers();
    const [c1] = e.state.zones[zoneId(a, 'library')].cards;
    e.dispatch(a, { type: 'arrow', from: c1, to: b });
    expect(e.state.arrows).toHaveLength(1);
    e.dispatch(b, { type: 'removeArrow', from: c1, to: b });
    expect(e.state.arrows).toHaveLength(0);
    e.dispatch(a, { type: 'arrow', from: c1, to: b });
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
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(99), side: [], commander: [[{ name: 'Atraxa' }]] } });
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
    e.dispatch(b, { type: 'loadDeck', sections: { main: faces(99), side: [], commander: [[{ name: 'Krenko' }]] } });
    for (let i = 0; i < 3; i++) e.dispatch(a, { type: 'commanderDamage', player: b, from: cmdr, delta: 7 });
    expect(e.state.players[b].commanderDamage?.[cmdr]).toBe(21);
    expect(e.state.players[b].trackers.Life).toBe(19);
    expect(e.state.log.at(-1)?.text).toBe('Atraxa → Bob: 21 commander damage (lethal) · Life 40 → 19');
    e.dispatch(a, { type: 'commanderDamage', player: b, from: cmdr, delta: -30 });
    expect(e.state.players[b].commanderDamage?.[cmdr]).toBe(0);
    expect(e.state.players[b].trackers.Life).toBe(40);
  });
});

describe('attach', () => {
  function board() {
    const { e, a, b } = twoPlayers();
    const bf = zoneId(a, 'battlefield');
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: bf, n: 3 });
    const [host, aura, sword] = e.state.zones[bf].cards;
    return { e, a, b, bf, host, aura, sword };
  }

  it('tucks attachments behind the host and moves them with it', () => {
    const { e, a, bf, host, aura, sword } = board();
    e.dispatch(a, { type: 'attach', cards: [aura, sword], to: host });
    const z = () => e.state.zones[bf].cards;
    expect(z().indexOf(aura)).toBeLessThan(z().indexOf(host));
    expect(z().indexOf(sword)).toBeLessThan(z().indexOf(host));
    expect(e.state.cards[aura].y).toBeLessThan(e.state.cards[host].y);
    e.dispatch(a, { type: 'move', cards: [host], to: bf, positions: { [host]: [500, 200] } });
    const h = e.state.cards[host];
    expect([e.state.cards[aura].x, e.state.cards[sword].x]).toEqual([h.x, h.x]);
    expect(e.state.cards[sword].attachedTo).toBe(host);
    expect(z().at(-1)).toBe(host);
  });

  it('detaches when moved alone, or when the host leaves the battlefield', () => {
    const { e, a, bf, host, aura, sword } = board();
    e.dispatch(a, { type: 'attach', cards: [aura, sword], to: host });
    e.dispatch(a, { type: 'move', cards: [aura], to: bf, positions: { [aura]: [800, 100] } });
    expect(e.state.cards[aura].attachedTo).toBeUndefined();
    e.dispatch(a, { type: 'move', cards: [host], to: zoneId(a, 'graveyard') });
    expect(e.state.cards[sword].attachedTo).toBeUndefined();
    expect(e.state.cards[sword].zone).toBe(bf);
  });

  it('pulls a card from elsewhere onto the host battlefield, and detaches on request', () => {
    const { e, a, b, host } = board();
    const [stolen] = e.state.zones[zoneId(b, 'library')].cards;
    e.dispatch(a, { type: 'attach', cards: [stolen], to: host });
    expect(e.state.cards[stolen].zone).toBe(zoneId(a, 'battlefield'));
    e.dispatch(a, { type: 'attach', cards: [stolen], to: null });
    expect(e.state.cards[stolen].attachedTo).toBeUndefined();
  });
});

describe('table tools', () => {
  it('notes a card, and drops the note when it leaves the battlefield', () => {
    const { e, a } = twoPlayers();
    const [id] = e.state.zones[zoneId(a, 'library')].cards;
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'battlefield') });
    e.dispatch(a, { type: 'annotate', cards: [id], text: '  chosen color: blue  ' });
    expect(e.state.cards[id].note).toBe('chosen color: blue');
    expect(e.state.log.at(-1)?.text).toMatch(/: “chosen color: blue”$/);
    e.dispatch(a, { type: 'move', cards: [id], to: zoneId(a, 'graveyard') });
    expect(e.state.cards[id].note).toBeUndefined();
  });

  it('keeps the library top face up for its owner, or for everyone', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    e.dispatch(a, { type: 'setTopVisible', zone: lib, value: 'owner' });
    const top = () => e.state.zones[lib].cards[0];
    expect(redact(e.state, a).cards[top()].faces).toHaveLength(1);
    expect(redact(e.state, b).cards[top()].faces).toHaveLength(0);
    e.dispatch(a, { type: 'setTopVisible', zone: lib, value: 'all' });
    e.dispatch(a, { type: 'moveTop', from: lib, to: zoneId(a, 'hand'), n: 1 });
    // The next card becomes the visible top; the second one stays hidden.
    expect(redact(e.state, b).cards[top()].faces).toHaveLength(1);
    expect(redact(e.state, b).cards[e.state.zones[lib].cards[1]].faces).toHaveLength(0);
    e.dispatch(a, { type: 'setTopVisible', zone: lib, value: null });
    expect(redact(e.state, a).cards[top()].faces).toHaveLength(0);
  });

  it('draws from the bottom and sorts a hand', () => {
    const { e, a } = twoPlayers();
    const lib = zoneId(a, 'library');
    const bottom = e.state.zones[lib].cards.at(-1);
    e.dispatch(a, { type: 'moveTop', from: lib, to: zoneId(a, 'hand'), n: 1, fromBottom: true });
    expect(e.state.zones[zoneId(a, 'hand')].cards).toEqual([bottom]);
    expect(e.state.log.at(-1)?.text).toBe('drew a card from the bottom');
    e.dispatch(a, { type: 'moveTop', from: lib, to: zoneId(a, 'hand'), n: 4 });
    e.dispatch(a, { type: 'sortZone', zone: zoneId(a, 'hand'), by: 'name' });
    const names = e.state.zones[zoneId(a, 'hand')].cards.map((id) => e.state.cards[id].faces[0].name);
    expect(names).toEqual([...names].sort());
  });
});

describe('playmats', () => {
  it('accepts theme ids and https images only', () => {
    const { e, a } = twoPlayers();
    const set = (mat: string) => {
      e.dispatch(a, { type: 'setPlaymat', mat });
      return e.state.players[a].playmat;
    };
    expect(set('tavern')).toBe('tavern');
    expect(set('url:https://example.com/mat.jpg')).toBe('url:https://example.com/mat.jpg');
    expect(set('url:javascript:alert(1)')).toBe('url:https://example.com/mat.jpg');
    // Quotes or parentheses could break out of the CSS url(): rejected.
    expect(set('url:https://x.test/a.png"), url("evil')).toBe('url:https://example.com/mat.jpg');
    expect(set('Not A Theme!')).toBe('url:https://example.com/mat.jpg');
    // Sleeves go through the same check.
    e.dispatch(a, { type: 'setSleeve', sleeve: 'crimson' });
    e.dispatch(a, { type: 'setSleeve', sleeve: 'url:data:text/html,x' });
    expect(e.state.players[a].sleeve).toBe('crimson');
  });
});

describe('setFaces', () => {
  it('changes your own cards, and every copy (hidden ones too) on request', () => {
    const e = new Engine();
    const a = e.join('Alice');
    const b = e.join('Bob');
    const bolt = [{ name: 'Bolt', image: 'https://img.example/old' }];
    e.dispatch(a, { type: 'loadDeck', sections: { main: [bolt, bolt, bolt, [{ name: 'Other' }]] } });
    const lib = e.state.zones[zoneId(a, 'library')];
    e.dispatch(a, { type: 'moveTop', from: lib.id, to: zoneId(a, 'hand'), n: 4 });
    const hand = e.state.zones[zoneId(a, 'hand')].cards;
    const one = hand.find((id) => e.state.cards[id].faces[0].name === 'Bolt')!;
    const art = (id: string) => e.state.cards[id].faces[0].image;

    e.dispatch(b, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'https://img.example/bob' }] });
    expect(art(one)).toBe('https://img.example/old');
    e.dispatch(a, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'https://img.example/new' }] });
    expect(hand.filter((id) => art(id) === 'https://img.example/new')).toEqual([one]);

    // Put two copies back in the library: the player can't see them, the host still finds them.
    e.dispatch(a, { type: 'move', cards: hand.filter((id) => id !== one), to: lib.id });
    e.dispatch(a, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'https://img.example/v3' }, { name: 'Back' }], sameName: true });
    const bolts = Object.values(e.state.cards).filter((c) => c.faces[0].name === 'Bolt');
    expect(bolts.map((c) => c.faces[0].image)).toEqual(['https://img.example/v3', 'https://img.example/v3', 'https://img.example/v3']);
    expect(Object.values(e.state.cards).find((c) => c.faces[0].name === 'Other')?.faces).toHaveLength(1);
    expect(e.state.log.at(-1)?.text).toBe('changed the art of a card and 2 other copies');

    e.dispatch(a, { type: 'transform', cards: [one] });
    e.dispatch(a, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt' }] });
    expect(e.state.cards[one].face).toBe(0);
  });
});

describe('stack', () => {
  it('is a public table zone: casting is logged and everyone sees the spell', () => {
    const { e, a, b } = twoPlayers();
    const stack = zoneId(TABLE, 'stack');
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'hand'), n: 1 });
    const [spell] = e.state.zones[zoneId(a, 'hand')].cards;
    e.dispatch(a, { type: 'move', cards: [spell], to: stack });
    expect(e.state.zones[stack].cards).toEqual([spell]);
    expect(e.state.log.at(-1)?.text).toMatch(/^cast A \d+$/);
    expect(redact(e.state, b).cards[spell].faces).toHaveLength(1);
    e.dispatch(a, { type: 'move', cards: [spell], to: zoneId(a, 'graveyard') });
    expect(e.state.log.at(-1)?.text).toMatch(/^moved A \d+ from the Stack to Graveyard$/);
  });

  it('is added to games saved before it existed', () => {
    const old = createGame();
    delete old.zones[zoneId(TABLE, 'stack')];
    // A copy: createGame shares the built-in preset object.
    old.preset = { ...old.preset, shared: undefined };
    const e = new Engine(old);
    expect(e.state.zones[zoneId(TABLE, 'stack')]).toMatchObject({ owner: TABLE, visibility: 'public' });
    expect(migrateGame(e.state)).toBe(e.state);
  });

  it('upgrades old saves to the current built-in preset', () => {
    const old = createGame();
    const { parts, deckSections, commander, ...before } = old.preset;
    old.preset = { ...before, shared: [{ role: 'stack', name: 'Stack', kind: 'pile', visibility: 'public' }] } as typeof old.preset;
    delete old.zones[zoneId(TABLE, 'stack')].verb;
    const e = new Engine(old);
    expect(e.state.preset).toMatchObject({ parts, deckSections, commander });
    expect(e.state.zones[zoneId(TABLE, 'stack')].verb).toBe('cast');
  });
});

describe('other games', () => {
  // Nothing from Magic: a draw pile, a hand, a table, a discard pile, a score.
  const CARDS: Preset = {
    id: 'test-game',
    name: 'Some card game',
    handSize: 5,
    trackers: { Score: 0 },
    zones: [
      { role: 'draw', name: 'Draw pile', kind: 'pile', visibility: 'hidden' },
      { role: 'hand', name: 'Hand', kind: 'fan', visibility: 'owner' },
      { role: 'table', name: 'Table', kind: 'free', visibility: 'public' },
      { role: 'discard', name: 'Discard', kind: 'pile', visibility: 'public' },
      { role: 'bench', name: 'Bench', kind: 'pile', visibility: 'public' },
    ],
    parts: { deck: 'draw', hand: 'hand', play: 'table', discard: 'discard' },
    deckSections: { main: 'draw', side: 'bench' },
  };

  it('runs on the parts its preset names', () => {
    const e = new Engine(createGame(CARDS));
    const a = e.join('Ana');
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(30), side: faces(2), commander: faces(1) } });
    expect(e.state.log.at(-1)?.text).toBe('loaded a deck: 30 cards (2 in Bench)');
    expect(e.state.zones[zoneId(a, 'draw')].cards).toHaveLength(30);
    e.dispatch(a, { type: 'mulligan' });
    expect(e.state.zones[zoneId(a, 'hand')].cards).toHaveLength(5);
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'draw'), to: zoneId(a, 'hand'), n: 1 });
    expect(e.state.log.at(-1)?.text).toBe('drew a card');
    e.dispatch(a, { type: 'random', zone: zoneId(a, 'hand'), action: 'discard' });
    expect(e.state.zones[zoneId(a, 'discard')].cards).toHaveLength(1);

    const [c] = e.state.zones[zoneId(a, 'hand')].cards;
    e.dispatch(a, { type: 'move', cards: [c], to: zoneId(a, 'table') });
    e.dispatch(a, { type: 'tap', cards: [c] });
    e.dispatch(a, { type: 'untapAll' });
    expect(e.state.cards[c].rotation).toBe(0);
    expect(e.state.log.at(-1)?.text).toBe('untapped everything on Table');

    // No commander rules in this game.
    e.dispatch(a, { type: 'commanderTax', cards: [c], delta: 2 });
    e.dispatch(a, { type: 'commanderDamage', player: a, from: c, delta: 3 });
    expect(e.state.cards[c].tax).toBeUndefined();
    expect(e.state.players[a].trackers).toEqual({ Score: 0 });
  });

  it('turns actions off when a preset leaves a part out', () => {
    const bare: Preset = { ...CARDS, parts: {}, deckSections: { main: 'draw' } };
    const e = new Engine(createGame(bare));
    const a = e.join('Ana');
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(10) } });
    const before = e.state;
    e.dispatch(a, { type: 'mulligan' });
    e.dispatch(a, { type: 'untapAll' });
    e.dispatch(a, { type: 'random', zone: zoneId(a, 'draw'), action: 'discard' });
    expect(e.state.zones).toEqual(before.zones);
    // Moving cards by hand still works: it's not a draw, just a move.
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'draw'), to: zoneId(a, 'hand'), n: 2 });
    expect(e.state.log.at(-1)?.text).toBe('moved 2 cards from Draw pile to Hand');
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

describe('searches', () => {
  const seenBy = (e: Engine, viewer: string, id: string) => redact(e.state, viewer).cards[id].faces.length > 0;

  it('stay closed when an action is undone', () => {
    const { e, a } = twoPlayers();
    const lib = zoneId(a, 'library');
    const top = e.state.zones[lib].cards[0];
    e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -1 });
    e.dispatch(a, { type: 'peek', zone: lib });
    e.dispatch(a, { type: 'unpeek', zone: lib });
    e.dispatch(a, { type: 'undo' });
    expect(seenBy(e, a, top)).toBe(false);
    expect(e.state.players[a].trackers.Life).toBe(20);
  });

  it('stay open when an action is undone, on the cards still there', () => {
    const { e, a } = twoPlayers();
    const lib = zoneId(a, 'library');
    const [first, second] = e.state.zones[lib].cards;
    e.dispatch(a, { type: 'peek', zone: lib, n: 2 });
    e.dispatch(a, { type: 'move', cards: [first], to: zoneId(a, 'hand') });
    e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -1 });
    e.dispatch(a, { type: 'undo' });
    expect(e.state.zones[lib].peeks?.[a]).toEqual([second]);
  });

  it("closing one doesn't hide what was revealed to you", () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const top = e.state.zones[lib].cards[0];
    e.dispatch(a, { type: 'reveal', cards: [top], to: b });
    e.dispatch(b, { type: 'peek', zone: lib, n: 1 });
    e.dispatch(b, { type: 'unpeek', zone: lib });
    expect(seenBy(e, b, top)).toBe(true);
  });

  it('end with a shuffle, and with leaving the zone', () => {
    const { e, a } = twoPlayers();
    const lib = zoneId(a, 'library');
    const top = e.state.zones[lib].cards[0];
    e.dispatch(a, { type: 'peek', zone: lib, n: 1 });
    e.dispatch(a, { type: 'move', cards: [top], to: zoneId(a, 'hand') });
    e.dispatch(a, { type: 'move', cards: [top], to: lib, index: 0 });
    expect(seenBy(e, a, top)).toBe(false);
    e.dispatch(a, { type: 'peek', zone: lib });
    e.dispatch(a, { type: 'shuffle', zone: lib });
    expect(e.state.zones[lib].peeks).toBeUndefined();
  });

  it('a mulligan forgets what was revealed in the library, like a shuffle', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const card = e.state.zones[lib].cards[20];
    e.dispatch(a, { type: 'reveal', cards: [card], to: '*' });
    e.dispatch(a, { type: 'mulligan', n: 0 });
    expect(seenBy(e, b, card)).toBe(false);
  });
});

describe('arranging the top of a library', () => {
  it('scries: top in order, bottom at the end, without naming the cards', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const [x, y, z] = e.state.zones[lib].cards;
    e.dispatch(a, { type: 'peek', zone: lib, n: 3 });
    e.dispatch(a, { type: 'arrange', zone: lib, as: 'scry', to: { top: [z, x], bottom: [y] } });
    const cards = e.state.zones[lib].cards;
    expect(cards.slice(0, 2)).toEqual([z, x]);
    expect(cards.at(-1)).toBe(y);
    expect(cards).toHaveLength(40);
    expect(e.state.zones[lib].peeks).toBeUndefined();
    expect(e.state.log.at(-1)?.text).toBe('scried 3: 2 on top, 1 on the bottom');
    expect(e.state.log.at(-2)?.text).not.toMatch(/looked at/);
    expect(redact(e.state, b).cards[z].faces).toHaveLength(0);
  });

  it('surveils into the graveyard, naming what goes there, and undoes in one step', () => {
    const { e, a } = twoPlayers();
    const lib = zoneId(a, 'library');
    const before = [...e.state.zones[lib].cards];
    const [x, y] = before;
    e.dispatch(a, { type: 'peek', zone: lib, n: 2 });
    e.dispatch(a, { type: 'arrange', zone: lib, as: 'surveil', to: { top: [y], graveyard: [x] } });
    expect(e.state.zones[zoneId(a, 'graveyard')].cards).toEqual([x]);
    expect(e.state.zones[lib].cards[0]).toBe(y);
    expect(e.state.log.at(-1)?.text).toBe(`surveilled 2: 1 on top, ${e.state.cards[x].faces[0].name} into the graveyard`);
    e.dispatch(a, { type: 'undo' });
    expect(e.state.zones[lib].cards).toEqual(before);
  });

  it('only touches cards being looked at', () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const [x, , , w] = e.state.zones[lib].cards;
    e.dispatch(a, { type: 'peek', zone: lib, n: 3 });
    const before = [...e.state.zones[lib].cards];
    e.dispatch(a, { type: 'arrange', zone: lib, to: { bottom: [w] } });
    e.dispatch(b, { type: 'arrange', zone: lib, to: { bottom: [x] } });
    e.dispatch(a, { type: 'arrange', zone: lib, to: { top: [x], bottom: [x] } });
    expect(e.state.zones[lib].cards).toEqual(before);
  });

  it("puts into your hand only from your own library, and can bottom in a random order", () => {
    const { e, a, b } = twoPlayers();
    const lib = zoneId(a, 'library');
    const [x, y, z] = e.state.zones[lib].cards;
    e.dispatch(b, { type: 'peek', zone: lib, n: 3 });
    e.dispatch(b, { type: 'arrange', zone: lib, to: { hand: [x] } });
    expect(e.state.cards[x].zone).toBe(lib);
    e.dispatch(a, { type: 'peek', zone: lib, n: 3 });
    e.dispatch(a, { type: 'arrange', zone: lib, to: { hand: [x], bottom: [y, z] }, randomBottom: true });
    expect(e.state.cards[x].zone).toBe(zoneId(a, 'hand'));
    expect(new Set(e.state.zones[lib].cards.slice(-2))).toEqual(new Set([y, z]));
    expect(e.state.log.at(-1)?.text).toBe('looked at the top 3 of Library: 2 on the bottom in a random order, a card into their hand');
  });
});

describe('cascade and discover', () => {
  function withLibrary(cards: { name: string; type: string; cost: number }[]) {
    const e = new Engine();
    const a = e.join('Alice');
    e.dispatch(a, { type: 'loadDeck', sections: { main: cards.map((c) => [c]), side: [], commander: [] } });
    const lib = zoneId(a, 'library');
    // Put the library back in list order: the deck was shuffled on load.
    const byName = (n: string) => Object.values(e.state.cards).find((c) => c.faces[0].name === n)!.id;
    e.state.zones[lib].cards = cards.map((c) => byName(c.name));
    return { e, a, lib, byName };
  }
  const deck = [
    { name: 'Forest', type: 'Basic Land — Forest', cost: 0 },
    { name: 'Craterhoof', type: 'Creature — Beast', cost: 8 },
    { name: 'Llanowar Elves', type: 'Creature — Elf Druid', cost: 1 },
    { name: 'Island', type: 'Basic Land — Island', cost: 0 },
  ];

  it('exiles until a nonland card that fits, then casts it and bottoms the rest', () => {
    const { e, a, lib, byName } = withLibrary(deck);
    e.dispatch(a, { type: 'revealUntil', zone: lib, max: 3, as: 'cascade' });
    const r = e.state.zones[lib].reveal!;
    expect(r.hit).toBe(byName('Llanowar Elves'));
    expect(r.misses).toEqual([byName('Forest'), byName('Craterhoof')]);
    expect(e.state.zones[zoneId(a, 'exile')].cards[0]).toBe(r.hit);
    expect(e.state.log.at(-1)?.text).toBe('cascaded: hit Llanowar Elves past 2 cards');
    e.dispatch(a, { type: 'finishReveal', zone: lib, hit: 'cast' });
    expect(e.state.cards[byName('Llanowar Elves')].zone).toBe(zoneId(TABLE, 'stack'));
    expect(e.state.zones[lib].cards).toHaveLength(3);
    expect(new Set(e.state.zones[lib].cards.slice(1))).toEqual(new Set([byName('Forest'), byName('Craterhoof')]));
    expect(e.state.zones[lib].reveal).toBeUndefined();
  });

  it('discover can put the card into your hand; without a fit everything goes back', () => {
    const { e, a, lib, byName } = withLibrary(deck);
    e.dispatch(a, { type: 'revealUntil', zone: lib, max: 1, as: 'discover' });
    e.dispatch(a, { type: 'finishReveal', zone: lib, hit: 'hand' });
    expect(e.state.cards[byName('Llanowar Elves')].zone).toBe(zoneId(a, 'hand'));
    e.dispatch(a, { type: 'revealUntil', zone: lib, max: 0, as: 'discover' });
    expect(e.state.zones[lib].reveal?.hit).toBeNull();
    expect(e.state.zones[lib].cards).toHaveLength(0);
    e.dispatch(a, { type: 'finishReveal', zone: lib, hit: 'bottom' });
    expect(e.state.zones[lib].cards).toHaveLength(3);
  });

  it("only from your own library, one at a time", () => {
    const { e, a, lib } = withLibrary(deck);
    const b = e.join('Bob');
    e.dispatch(b, { type: 'revealUntil', zone: lib, max: 3 });
    expect(e.state.zones[lib].reveal).toBeUndefined();
    e.dispatch(a, { type: 'revealUntil', zone: lib, max: 3 });
    const exiled = e.state.zones[zoneId(a, 'exile')].cards.length;
    e.dispatch(a, { type: 'revealUntil', zone: lib, max: 3 });
    expect(e.state.zones[zoneId(a, 'exile')].cards).toHaveLength(exiled);
  });
});

describe('proliferate', () => {
  it('adds one of each kind of counter, and to players counters but not life', () => {
    const { e, a, b } = twoPlayers();
    const bf = zoneId(a, 'battlefield');
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: bf, n: 2 });
    const [x, y] = e.state.zones[bf].cards;
    e.dispatch(a, { type: 'counter', cards: [x], key: '+1/+1', delta: 2 });
    e.dispatch(a, { type: 'counter', cards: [x], key: 'loyalty', delta: 3 });
    e.dispatch(a, { type: 'setTracker', player: b, key: 'Poison', value: 4 });
    e.dispatch(a, { type: 'proliferate', cards: [x, y], players: [a, b] });
    expect(e.state.cards[x].counters).toEqual({ '+1/+1': 3, loyalty: 4 });
    expect(e.state.cards[y].counters).toEqual({});
    expect(e.state.players[b].trackers).toMatchObject({ Life: 20, Poison: 5 });
    expect(e.state.players[a].trackers.Life).toBe(20);
    expect(e.state.log.at(-1)?.text).toBe(`proliferated: ${e.state.cards[x].faces[0].name}, Bob (Poison 5)`);
  });
});

describe('tokens', () => {
  it('cease to exist off the battlefield, but not on the stack', () => {
    const { e, a } = twoPlayers();
    const bf = zoneId(a, 'battlefield');
    e.dispatch(a, { type: 'create', zone: bf, token: true, cards: [[{ name: 'Treasure' }], [{ name: 'Copy' }]] });
    const [t, copy] = e.state.zones[bf].cards;
    e.dispatch(a, { type: 'move', cards: [t], to: zoneId(a, 'graveyard') });
    expect(e.state.cards[t]).toBeUndefined();
    expect(e.state.zones[zoneId(a, 'graveyard')].cards).toEqual([]);
    expect(e.state.log.at(-1)?.text).toBe('moved Treasure from Battlefield to Graveyard — tokens cease to exist');
    e.dispatch(a, { type: 'move', cards: [copy], to: zoneId(TABLE, 'stack') });
    expect(e.state.cards[copy].zone).toBe(zoneId(TABLE, 'stack'));
    e.dispatch(a, { type: 'undo' });
    e.dispatch(a, { type: 'undo' });
    expect(e.state.cards[t].zone).toBe(bf);
  });
});

describe('undo history', () => {
  it('skips ops that changed nothing, or only the log', () => {
    const { e, a } = twoPlayers();
    e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -1 });
    e.dispatch(a, { type: 'clearArrows' });
    e.dispatch(a, { type: 'chat', text: 'hello' });
    e.dispatch(a, { type: 'roll', sides: 6 });
    e.dispatch(a, { type: 'undo' });
    expect(e.state.players[a].trackers.Life).toBe(20);
  });

  it("isn't blocked by another player's chat", () => {
    const { e, a, b } = twoPlayers();
    e.dispatch(a, { type: 'tracker', player: a, key: 'Life', delta: -1 });
    e.dispatch(b, { type: 'chat', text: 'hello' });
    e.dispatch(a, { type: 'undo' });
    expect(e.state.players[a].trackers.Life).toBe(20);
  });
});

describe('cards leaving the battlefield', () => {
  const onBoard = (e: Engine, a: string, n: number) => {
    const bf = zoneId(a, 'battlefield');
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: bf, n });
    return e.state.zones[bf].cards;
  };

  it('are no longer attached, even with their host', () => {
    const { e, a } = twoPlayers();
    const [aura, host] = onBoard(e, a, 2);
    e.dispatch(a, { type: 'attach', cards: [aura], to: host });
    e.dispatch(a, { type: 'move', cards: [aura, host], to: zoneId(a, 'graveyard') });
    expect(e.state.cards[aura].attachedTo).toBeUndefined();
  });

  it('take their arrows with them', () => {
    const { e, a, b } = twoPlayers();
    const [card] = onBoard(e, a, 1);
    e.dispatch(a, { type: 'arrow', from: card, to: b });
    e.dispatch(a, { type: 'move', cards: [card], to: zoneId(b, 'battlefield') });
    expect(e.state.arrows).toHaveLength(1);
    e.dispatch(a, { type: 'move', cards: [card], to: zoneId(a, 'library') });
    expect(e.state.arrows).toHaveLength(0);
  });

  it('attachments never form a loop, however long', () => {
    const { e, a } = twoPlayers();
    const [x, y, z] = onBoard(e, a, 3);
    e.dispatch(a, { type: 'attach', cards: [x], to: y });
    e.dispatch(a, { type: 'attach', cards: [y], to: z });
    e.dispatch(a, { type: 'attach', cards: [z], to: x });
    expect(e.state.cards[z].attachedTo).toBe(x);
    expect(e.state.cards[x].attachedTo).toBe(y);
    expect(e.state.cards[y].attachedTo).toBeUndefined();
  });
});

describe('commander cast through the stack', () => {
  it('pays the tax once, leaving the command zone', () => {
    const e = new Engine();
    const a = e.join('Alice');
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(99), side: [], commander: [[{ name: 'Atraxa' }]] } });
    const cmdr = e.state.zones[zoneId(a, 'command')].cards[0];
    e.dispatch(a, { type: 'move', cards: [cmdr], to: zoneId(TABLE, 'stack') });
    expect(e.state.cards[cmdr].tax).toBe(2);
    expect(e.state.log.at(-1)?.text).toBe('cast Atraxa from Command (commander tax now 2)');
    e.dispatch(a, { type: 'move', cards: [cmdr], to: zoneId(a, 'battlefield') });
    expect(e.state.cards[cmdr].tax).toBe(2);
  });
});

describe('patches', () => {
  it('rebuild the next view while keeping what did not change', () => {
    const { e, a } = twoPlayers();
    e.dispatch(a, { type: 'moveTop', from: zoneId(a, 'library'), to: zoneId(a, 'battlefield'), n: 2 });
    const prev = redact(e.state, a);
    const [moved, still] = prev.zones[zoneId(a, 'battlefield')].cards;
    e.dispatch(a, { type: 'tap', cards: [moved] });
    const next = redact(e.state, a);
    const shared = applyPatch(prev, diffState(prev, next));
    expect(shared).toEqual(next);
    expect(shared.cards[still]).toBe(prev.cards[still]);
    expect(shared.cards[moved]).not.toBe(prev.cards[moved]);
    expect(shared.zones[zoneId(a, 'hand')]).toBe(prev.zones[zoneId(a, 'hand')]);
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
  it("reads Magic Ville's Apprentice export, commander from its SB line", () => {
    const deck = parseDeck(`// www.magic-ville.com deck file<br />
// NAME : [Commander Multi] Satoru<br />
// CREATOR : FarfadetBleu (magic-ville.com)<br />
// FORMAT : Commander<br />
1 Stature, Size Shifter<br />
1 Krang & Shredder<br />
SB:  1 Satoru Umezawa<br />
<br><br><br><a href="dl_appr?ref=1110782&save=1">Sauvegarder</a>`);
    expect(deck).toEqual([
      { count: 1, name: 'Stature, Size Shifter', section: 'main' },
      { count: 1, name: 'Krang & Shredder', section: 'main' },
      { count: 1, name: 'Satoru Umezawa', section: 'commander' },
    ]);
  });

  it("ignores Magic Ville's save link when the page was copied as text", () => {
    const deck = parseDeck('// www.magic-ville.com deck file\n// FORMAT : Commander\n1 Stature, Size Shifter\nSB:  1 Satoru Umezawa\n\n\n\nSauvegarder');
    expect(deck.filter((l) => l.section === 'commander').map((l) => l.name)).toEqual(['Satoru Umezawa']);
    expect(deck.some((l) => l.name === 'Sauvegarder')).toBe(false);
  });

  it('reads MWS lines, dropping their set codes', () => {
    expect(parseDeck('1 [NPH] Jin-Gitaxias, Core Augur\n4 [] Island\nSB:  2 [M10] Duress')).toEqual([
      { count: 1, name: 'Jin-Gitaxias, Core Augur', section: 'main' },
      { count: 4, name: 'Island', section: 'main' },
      { count: 2, name: 'Duress', section: 'side' },
    ]);
  });

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

describe('deck names', () => {
  it('guesses the commander, else the most played non-basic', async () => {
    const { guessDeckName } = await import('../cards/decks');
    expect(guessDeckName('Commander\n1 Krenko, Mob Boss\n\nDeck\n30 Mountain')).toBe('Krenko, Mob Boss');
    expect(guessDeckName('20 Island\n4 Delver of Secrets\n2 Brazen Borrower')).toBe('Delver of Secrets');
  });
});

describe('withPrinting', () => {
  it('points every line of a card at one printing, keeping counts and sections', () => {
    const text = 'Commander\n1 Delver of Secrets // Insectile Aberration\n\nDeck\n4 Lightning Bolt (M10) 146 *F*\n2 Shock\nSB: 1 lightning bolt';
    const out = withPrinting(text, 'Lightning Bolt', 'clu', '141');
    expect(out).toBe('Commander\n1 Delver of Secrets // Insectile Aberration\n\nDeck\n4 Lightning Bolt (CLU) 141\n2 Shock\nSB: 1 lightning bolt (CLU) 141');
    expect(withPrinting(text, 'Delver of Secrets', 'isd', '51')).toContain('1 Delver of Secrets // Insectile Aberration (ISD) 51');
    expect(parseDeck(out).filter((l) => l.set === 'clu').map((l) => [l.count, l.section])).toEqual([[4, 'main'], [1, 'side']]);
  });
});

describe('imageSet', () => {
  it('offers every Scryfall size, and nothing for other images', () => {
    const normal = 'https://cards.scryfall.io/normal/front/0/9/abc.jpg?1';
    const large = 'https://cards.scryfall.io/large/front/0/9/abc.jpg?1';
    expect(imageSet({ name: 'Bolt', image: normal, imageLarge: large })).toBe(
      `https://cards.scryfall.io/small/front/0/9/abc.jpg?1 146w, ${normal} 488w, ${large} 672w`,
    );
    expect(imageSet({ name: 'Pikachu', image: 'https://example.com/pikachu.png' })).toBeUndefined();
    expect(imageSet({ name: 'Text only' })).toBeUndefined();
  });
});

describe('triggersOf', () => {
  it('reads phase triggers from Oracle text, whose turn included', () => {
    const arena = triggersOf('At the beginning of your upkeep, you draw a card and you lose 1 life.');
    expect(arena).toEqual([{ phase: 'upkeep', whose: 'yours', text: 'At the beginning of your upkeep, you draw a card and you lose 1 life.' }]);
    expect(triggersOf("At the beginning of each opponent's end step, draw a card.")[0]).toMatchObject({ phase: 'end', whose: 'opponents' });
    expect(triggersOf('Flying\nAt the beginning of combat on your turn, create a 1/1 token.')[0]).toMatchObject({ phase: 'combat', whose: 'yours' });
    expect(triggersOf('Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library.')[0]).toMatchObject({ phase: 'combat' });
    // Reminder text goes, delayed triggers and other players' attacks don't count.
    expect(triggersOf('Echo {2}{R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)')).toEqual([]);
    expect(triggersOf('Sacrifice it at the beginning of the next end step.')).toEqual([]);
    expect(triggersOf('Whenever a creature an opponent controls attacks, you gain 1 life.')).toEqual([]);
  });

  it('fires on the right turns', () => {
    const [yours] = triggersOf('At the beginning of your upkeep, draw a card.');
    const [each] = triggersOf('At the beginning of each upkeep, draw a card.');
    const [theirs] = triggersOf("At the beginning of each opponent's upkeep, draw a card.");
    expect([firesOn(yours, 'a', 'a'), firesOn(yours, 'a', 'b')]).toEqual([true, false]);
    expect([firesOn(each, 'a', 'a'), firesOn(each, 'a', 'b')]).toEqual([true, true]);
    expect([firesOn(theirs, 'a', 'a'), firesOn(theirs, 'a', 'b')]).toEqual([false, true]);
  });
});

describe('mana', () => {
  it('reads what a card taps for from its Oracle text', () => {
    expect(manaOf('({T}: Add {W}.)')).toEqual({ units: [['W']], special: false });
    expect(manaOf('({T}: Add {U} or {R}.)\nThis land enters tapped.')).toEqual({ units: [['U', 'R']], special: false });
    expect(manaOf('{T}: Add {C}{C}.')).toEqual({ units: [['C'], ['C']], special: false });
    expect(manaOf('Flying\n{T}: Add one mana of any color.')?.units).toEqual([['W', 'U', 'B', 'R', 'G']]);
    // A painland: the better of its two abilities.
    expect(manaOf('{T}: Add {C}.\n{T}: Add {W} or {U}. This land deals 1 damage to you.')?.units).toEqual([['W', 'U']]);
    // Not read, so flagged rather than guessed.
    expect(manaOf('{1}, {T}: Add {W}{U}.')).toEqual({ units: [], special: true });
    expect(manaOf('{T}: Add {G} for each Elf you control.')).toEqual({ units: [], special: true });
    expect(manaOf('Flying, vigilance')).toBeUndefined();
    // Paying life or sacrificing still makes the mana now; Dryad Arbor's ability is quoted in reminder text.
    expect(manaOf('{T}, Pay 1 life: Add one mana of any color.')?.units).toHaveLength(1);
    expect(manaOf('{T}, Sacrifice this artifact: Add one mana of any color.')?.units).toHaveLength(1);
    expect(manaOf('(This land isn\'t a spell, it\'s affected by summoning sickness, and it has "{T}: Add {G}.")')?.units).toEqual([['G']]);
  });

  it('adds up a pool, each color as the most of it the sources can make', () => {
    const pool = poolOf([
      { name: 'Plains', source: manaOf('({T}: Add {W}.)')! },
      { name: 'Hallowed Fountain', source: manaOf('({T}: Add {W} or {U}.)')! },
      { name: 'Sol Ring', source: manaOf('{T}: Add {C}{C}.')! },
      { name: 'Elvish Archdruid', source: manaOf('{T}: Add {G} for each Elf you control.')! },
    ]);
    expect(pool.total).toBe(4);
    expect(pool.max).toMatchObject({ W: 2, U: 1, C: 2, G: 0 });
    expect(pool.special).toEqual(['Elvish Archdruid']);
  });
});

describe('limits on what a guest can send', () => {
  it('rejects an op creating too many cards at once, or a deck too big', () => {
    const { e, a } = twoPlayers();
    const before = Object.keys(e.state.cards).length;
    e.dispatch(a, { type: 'create', zone: zoneId(a, 'battlefield'), cards: faces(LIMITS.perCreate + 1), token: true });
    e.dispatch(a, { type: 'loadDeck', sections: { main: faces(LIMITS.perDeck + 1), side: [], commander: [] } });
    expect(Object.keys(e.state.cards).length).toBe(before);
  });

  it('stops at the most cards a game may hold', () => {
    const { e, a } = twoPlayers();
    for (let i = 0; i < LIMITS.cards / LIMITS.perCreate + 2; i++) {
      e.dispatch(a, { type: 'create', zone: zoneId(a, 'battlefield'), cards: faces(LIMITS.perCreate), token: true });
    }
    expect(Object.keys(e.state.cards).length).toBeLessThanOrEqual(LIMITS.cards);
  });

  it('keeps card faces to known fields of sane sizes, and images to https links', () => {
    const face = cleanFace({
      name: 'x'.repeat(10_000),
      text: 'y'.repeat(100_000),
      image: 'javascript:alert(1)',
      imageLarge: 'https://cards.example/big.jpg',
      cost: Infinity,
      extra: 'dropped',
    } as never);
    expect(face.name.length).toBe(150);
    expect(face.text?.length).toBe(4000);
    expect(face.image).toBeUndefined();
    expect(face.imageLarge).toBe('https://cards.example/big.jpg');
    expect(face.cost).toBeUndefined();
    expect('extra' in face).toBe(false);
  });
});
