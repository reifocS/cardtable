import { describe, expect, it } from 'vitest';
import { parseDeck, withPrinting } from '../cards/deckParser';
import { imageSet } from '../cards/scryfall';
import { applyPatch, diffState } from './diff';
import { Engine } from './engine';
import { apply } from './ops';
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
    expect(set('medieval')).toBe('medieval');
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
    const bolt = [{ name: 'Bolt', image: 'old' }];
    e.dispatch(a, { type: 'loadDeck', sections: { main: [bolt, bolt, bolt, [{ name: 'Other' }]] } });
    const lib = e.state.zones[zoneId(a, 'library')];
    e.dispatch(a, { type: 'moveTop', from: lib.id, to: zoneId(a, 'hand'), n: 4 });
    const hand = e.state.zones[zoneId(a, 'hand')].cards;
    const one = hand.find((id) => e.state.cards[id].faces[0].name === 'Bolt')!;
    const art = (id: string) => e.state.cards[id].faces[0].image;

    e.dispatch(b, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'bob' }] });
    expect(art(one)).toBe('old');
    e.dispatch(a, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'new' }] });
    expect(hand.filter((id) => art(id) === 'new')).toEqual([one]);

    // Put two copies back in the library: the player can't see them, the host still finds them.
    e.dispatch(a, { type: 'move', cards: hand.filter((id) => id !== one), to: lib.id });
    e.dispatch(a, { type: 'setFaces', cards: [one], faces: [{ name: 'Bolt', image: 'v3' }, { name: 'Back' }], sameName: true });
    const bolts = Object.values(e.state.cards).filter((c) => c.faces[0].name === 'Bolt');
    expect(bolts.map((c) => c.faces[0].image)).toEqual(['v3', 'v3', 'v3']);
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
