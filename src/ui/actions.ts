import type React from 'react';
import { TABLE, zoneId } from '../core/state';
import type { Card, CardFace, CardId, Zone } from '../core/types';
import { fetchCard, isScryfallCard } from '../cards/scryfall';
import { loyaltyAbilities } from '../core/magic';
import { textActionLabel, textActions, tokenCount, type TextAction } from './cardText';
import { act, ask, askNumber, myZone, targetCards, useStore, type MenuItem } from './store';

const DEFAULT_COUNTER = '+1/+1';

/** Moves cards to a zone role of each card's owner (graveyard, hand…), the way real cards go home. */
export function sendToOwners(ids: CardId[], role: string, index?: number) {
  const { state } = useStore.getState();
  if (!state) return;
  const byOwner = new Map<string, CardId[]>();
  for (const id of ids) {
    const c = state.cards[id];
    if (c) byOwner.set(c.owner, [...(byOwner.get(c.owner) ?? []), id]);
  }
  for (const [owner, cards] of byOwner) {
    const to = state.zones[zoneId(owner, role)];
    if (to) act({ type: 'move', cards, to: to.id, index });
  }
}

export const STACK = zoneId(TABLE, 'stack');

/** Instants and sorceries go to the graveyard when they resolve; everything else stays in play. */
const typeOf = (c: Card) => c.faces[c.face]?.type ?? c.faces[0]?.type ?? '';
export const isSpell = (c: Card) => /\b(instant|sorcery)\b/i.test(typeOf(c));
/** Lands are played, not cast; cards with no type line (other games) can always be cast. */
const isLand = (c: Card) => /\bland\b/i.test(typeOf(c));

export function castToStack(ids: CardId[]) {
  const { state } = useStore.getState();
  if (state?.zones[STACK] && ids.length) act({ type: 'move', cards: ids, to: STACK });
}

/** Resolves a spell from the stack: to its owner's graveyard, or battlefield for permanents. */
export function resolve(card: Card) {
  if (isSpell(card)) sendToOwners([card.id], 'graveyard');
  else {
    const bf = useStore.getState().state?.zones[zoneId(card.owner, 'battlefield')];
    if (bf) act({ type: 'move', cards: [card.id], to: bf.id });
  }
}

export function toMyBattlefield(ids: CardId[], faceDown = false) {
  const bf = myZone('battlefield');
  if (bf && ids.length) act({ type: 'move', cards: ids, to: bf.id, faceDown });
}

export function draw(n = 1) {
  const lib = myZone('library');
  const hand = myZone('hand');
  if (lib && hand) act({ type: 'moveTop', from: lib.id, to: hand.id, n });
}

export function shuffleLibrary() {
  const lib = myZone('library');
  if (lib) act({ type: 'shuffle', zone: lib.id });
}

export function openViewer(zone: Zone, n?: number) {
  const { me, state } = useStore.getState();
  if (!state) return;
  const hiddenToMe = zone.visibility === 'hidden' || (zone.visibility === 'owner' && zone.owner !== me);
  if (hiddenToMe) act({ type: 'peek', zone: zone.id, n });
  useStore.setState({
    viewer: { zone: zone.id, ids: n === undefined ? undefined : zone.cards.slice(0, n), peeked: hiddenToMe },
    menu: null,
  });
}

/** Looks at the top `n` of a pile to put each card back on top, on the bottom or elsewhere (see Arrange). */
export function openArrange(zone: Zone, n: number, as?: 'scry' | 'surveil') {
  const ids = zone.cards.slice(0, Math.max(0, n));
  if (!ids.length) return;
  act({ type: 'peek', zone: zone.id, n: ids.length });
  useStore.setState({ arrange: { zone: zone.id, ids, as }, menu: null });
}

/** Leaves the arrange window; without `done`, the cards stay where they were. */
export function closeArrange(done = false) {
  const { arrange } = useStore.getState();
  if (arrange && !done) act({ type: 'unpeek', zone: arrange.zone });
  useStore.setState({ arrange: null });
}

export function closeViewer() {
  const { viewer } = useStore.getState();
  if (viewer?.peeked) act({ type: 'unpeek', zone: viewer.zone });
  useStore.setState({ viewer: null });
}

export function editNote(ids: CardId[], current = '') {
  if (ids.length) ask('Note on the card (empty to clear)', current, (text) => act({ type: 'annotate', cards: ids, text }));
}

/** Two-seat practice: act as the next seat I control. */
export function switchToNextSeat() {
  const { session, controlled, me } = useStore.getState();
  if (!session?.switchSeat || controlled.length < 2 || !me) return;
  session.switchSeat(controlled[(controlled.indexOf(me) + 1) % controlled.length]);
}

export function startTargeting(from: string) {
  useStore.setState({ targeting: from, targetMode: 'arrow', menu: null });
}

export function startAttaching(ids: CardId[]) {
  if (ids.length) useStore.setState({ targeting: ids[0], targetMode: 'attach', attachCards: ids, menu: null });
}

function addCounterPrompt(ids: CardId[]) {
  ask('Counter name', DEFAULT_COUNTER, (key) => key.trim() && act({ type: 'counter', cards: ids, key: key.trim(), delta: 1 }));
}

/** Creates token(s) on my battlefield and remembers the kind, for "Create another". */
export function createTokens(faces: CardFace[], count = 1, positions?: [number, number][]) {
  const bf = myZone('battlefield');
  if (!bf || !faces.length) return;
  act({ type: 'create', zone: bf.id, token: true, cards: Array.from({ length: count }, () => faces), positions });
  useStore.setState({ lastToken: faces });
}

export function createAnotherToken() {
  const faces = useStore.getState().lastToken;
  if (faces) createTokens(faces);
}

export function duplicate(ids: CardId[]) {
  const { state } = useStore.getState();
  const bf = myZone('battlefield');
  if (!state || !bf) return;
  const cards = ids.map((id) => state.cards[id]).filter((c) => c?.faces.length);
  if (!cards.length) return;
  act({
    type: 'create',
    zone: bf.id,
    token: true,
    cards: cards.map((c) => c.faces),
    positions: cards.map((c) => [c.x + 24, c.y + 24]),
  });
  useStore.setState({ lastToken: cards[0].faces });
}

/** Creates a related token (from the card database) on my battlefield, next to its source. */
async function createToken(id: string, near: Card, count = 1) {
  const bf = myZone('battlefield');
  if (!bf || count < 1) return;
  try {
    const faces = await fetchCard(id);
    // Side by side, to the right of their source; elsewhere, wherever there's room.
    const at = near.zone === bf.id ? Array.from({ length: count }, (_, i): [number, number] => [near.x + 80 + i * 26, near.y + i * 6]) : undefined;
    createTokens(faces, Math.min(count, 100), at);
  } catch (e) {
    console.warn('Could not fetch token', e);
  }
}

/** Does what a card's text says, to my own library; X is asked for. */
function runTextAction({ kind, n }: TextAction) {
  const lib = myZone('library');
  if (!lib) return;
  if (kind === 'proliferate') return useStore.setState({ dialog: 'proliferate', menu: null });
  const run = (n: number) => {
    if (kind === 'cascade' || kind === 'discover') act({ type: 'revealUntil', zone: lib.id, max: n, as: kind });
    else if (kind === 'scry' || kind === 'surveil') openArrange(lib, n, kind);
    else if (kind === 'look') openArrange(lib, n);
    else if (kind === 'draw') draw(n);
    else {
      const gy = myZone('graveyard');
      if (gy) act({ type: 'moveTop', from: lib.id, to: gy.id, n });
    }
  };
  if (n === null) askNumber(`${textActionLabel({ kind, n })}: how many?`, 1, run);
  else run(n);
}

export function openMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  // A spectator can't act: no menus of actions.
  if (useStore.getState().session?.spectating) return;
  useStore.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function cardMenu(card: Card, zone: Zone): MenuItem[] {
  const { state, me, selection } = useStore.getState();
  if (!state || !me) return [];
  const ids = targetCards(card.id);
  if (!selection.includes(card.id)) useStore.setState({ selection: [card.id] });
  const many = ids.length > 1 ? ` (${ids.length})` : '';
  const onBoard = zone.kind === 'free';
  const items: MenuItem[] = [];

  // What the card says to do, one click away: "Scry 2", "Draw a card"…
  const face = card.faces[card.face] ?? card.faces[0];
  const fromText = ids.length === 1 ? textActions(face?.text, card.faceDown ? undefined : face?.cost) : [];
  if (fromText.length) {
    items.push(...fromText.map((t) => ({ label: textActionLabel(t), action: () => runTextAction(t) })), { label: '', heading: true });
  }

  // A planeswalker's abilities: each one pays (or adds) its loyalty and says which it was in the log.
  const abilities = onBoard && ids.length === 1 && face && !card.faceDown ? loyaltyAbilities(face) : [];
  if (abilities.length) {
    const loyalty = card.counters.Loyalty ?? 0;
    for (const ab of abilities) {
      const short = ab.text.length > 48 ? `${ab.text.slice(0, 46)}…` : ab.text;
      const activate = (delta: number) => act({ type: 'counter', cards: [card.id], key: 'Loyalty', delta, why: `${ab.cost}: ${ab.text}` });
      items.push({
        label: `${ab.cost}: ${short}`,
        disabled: ab.delta !== null && loyalty + ab.delta < 0,
        action: () => (ab.delta === null ? askNumber(`${ab.cost}: X =`, 1, (x) => activate(-x)) : activate(ab.delta)),
      });
    }
    items.push({ label: '', heading: true });
  }

  if (onBoard) {
    items.push(
      { label: card.rotation ? `Untap${many}` : `Tap${many}`, hint: 'T', action: () => act({ type: 'tap', cards: ids }) },
      { label: card.faceDown ? 'Turn face up' : 'Turn face down', hint: 'F', action: () => act({ type: 'flip', cards: ids }) },
    );
    if (card.faces.length > 1) items.push({ label: 'Transform', hint: 'X', action: () => act({ type: 'transform', cards: ids }) });
    items.push(
      { label: `Add ${DEFAULT_COUNTER} counter`, hint: '+', action: () => act({ type: 'counter', cards: ids, key: DEFAULT_COUNTER, delta: 1 }) },
      { label: 'Add counter…', action: () => addCounterPrompt(ids) },
      { label: 'Target…', hint: 'A', action: () => startTargeting(card.id) },
      card.attachedTo
        ? { label: 'Detach', action: () => act({ type: 'attach', cards: ids, to: null }) }
        : { label: `Attach to…${many}`, action: () => startAttaching(ids) },
      { label: 'Duplicate as token', action: () => duplicate(ids) },
    );
  }
  if (!onBoard) items.push({ label: `Attach to…${many}`, action: () => startAttaching(ids) });
  for (const t of card.faces[0]?.tokens ?? []) {
    if (/emblem/i.test(t.name)) {
      items.push({ label: `Create ${t.name}`, action: () => createToken(t.id, card) });
      continue;
    }
    // "Create two Treasure tokens": how many, as the text says (1 when it doesn't).
    const n = tokenCount(card.faces.map((f) => f.text ?? '').join('\n'), t.name);
    items.push(
      { label: n > 1 ? `Create ${n} ${t.name} tokens` : `Create ${t.name} token`, action: () => createToken(t.id, card, n) },
      { label: `Create ${t.name} tokens…`, action: () => askNumber(`How many ${t.name} tokens?`, n, (k) => createToken(t.id, card, k)) },
    );
  }
  // Every card of this name on this battlefield, to tap, sacrifice or move them together.
  if (onBoard && face) {
    const same = zone.cards.filter((id) => state.cards[id]?.faces[state.cards[id].face]?.name === face.name);
    if (same.length > 1 && !same.every((id) => ids.includes(id))) {
      items.push({ label: `Select all ${same.length} ${face.name}`, action: () => useStore.setState({ selection: same }) });
    }
  }
  const rules = state.preset.commander;
  if (rules && card.home === rules.zone) {
    items.push(
      { label: `Commander tax +${rules.tax} (now ${card.tax ?? 0})`, action: () => act({ type: 'commanderTax', cards: [card.id], delta: rules.tax }) },
      { label: `Commander tax −${rules.tax}`, disabled: !card.tax, action: () => act({ type: 'commanderTax', cards: [card.id], delta: -rules.tax }) },
    );
  }
  if (zone.visibility !== 'public' && zone.owner === me) {
    items.push({ label: `Reveal to everyone${many}`, hint: 'R', action: () => act({ type: 'reveal', cards: ids, to: '*' }) });
  }
  if (card.revealedTo.length) items.push({ label: 'Stop revealing', action: () => act({ type: 'hide', cards: ids }) });

  items.push(
    { label: card.note ? 'Edit note…' : 'Note…', hint: 'N', action: () => editNote(ids, card.note) },
    ...(card.note ? [{ label: 'Clear note', action: () => act({ type: 'annotate', cards: ids, text: '' }) }] : []),
  );
  if (card.owner === me && isScryfallCard(card.faces)) items.push({ label: 'Choose art…', action: () => useStore.setState({ artFor: card.id }) });
  if (zone.id === STACK) {
    items.unshift({ label: isSpell(card) ? 'Resolve → graveyard' : 'Resolve → battlefield', hint: 'dbl-click', action: () => resolve(card) });
  } else if (state.zones[STACK] && !isLand(card)) {
    items.push({ label: `Cast (to the stack)${many}`, action: () => castToStack(ids) });
  }
  items.push({ label: 'Move to', heading: true });
  if (!(onBoard && zone.owner === me)) {
    items.push({ label: 'Battlefield', hint: 'B', action: () => toMyBattlefield(ids) });
    items.push({ label: 'Battlefield, face down', action: () => toMyBattlefield(ids, true) });
  }
  const dest: [string, string, string?, number?][] = [
    ['hand', 'Hand', 'H'],
    ['library', 'Top of library', 'L'],
    ['library', 'Bottom of library', undefined, -1],
    ['graveyard', 'Graveyard', 'G'],
    ['exile', 'Exile', 'E'],
    ['command', 'Command zone'],
    ['sideboard', 'Sideboard'],
  ];
  for (const [role, label, hint, index] of dest) {
    if (role === zone.role && index === undefined && zone.owner === card.owner) continue;
    items.push({ label, hint, action: () => sendToOwners(ids, role, index) });
  }
  for (const pid of state.seats) {
    if (pid === zone.owner) continue;
    const bf = state.zones[zoneId(pid, 'battlefield')];
    if (bf && onBoard) items.push({ label: `${state.players[pid].name}'s battlefield`, action: () => act({ type: 'move', cards: ids, to: bf.id }) });
  }
  if (ids.every((id) => state.cards[id]?.token)) {
    items.push({ label: '', heading: true }, { label: `Delete token${many}`, hint: 'Del', action: () => act({ type: 'delete', cards: ids }) });
  }
  // A full hand leaves no bare spot to right-click, so its own menu rides along on each card.
  if (zone.role === 'hand') {
    const handItems = zoneMenu(zone);
    if (handItems.length) items.push({ label: 'Hand', heading: true }, ...handItems);
  }
  return items;
}

export function zoneMenu(zone: Zone): MenuItem[] {
  const { me, state } = useStore.getState();
  if (!state) return [];
  const mine = zone.owner === me;
  const items: MenuItem[] = [];
  if (zone.role === 'library' && mine) {
    const gy = myZone('graveyard')!;
    const exile = myZone('exile')!;
    items.push(
      { label: 'Draw', hint: 'D', action: () => draw() },
      { label: 'Draw…', action: () => askNumber('Draw how many?', 2, draw) },
      { label: 'Draw from the bottom', action: () => act({ type: 'moveTop', from: zone.id, to: myZone('hand')!.id, n: 1, fromBottom: true }) },
      { label: 'Shuffle', hint: 'S', action: () => shuffleLibrary() },
      { label: 'Scry…', action: () => askNumber('Scry how many?', 1, (n) => openArrange(zone, n, 'scry')) },
      { label: 'Surveil…', action: () => askNumber('Surveil how many?', 1, (n) => openArrange(zone, n, 'surveil')) },
      { label: 'Look at top and sort…', action: () => askNumber('Look at how many?', 3, (n) => openArrange(zone, n)) },
      { label: 'Look at top…', action: () => askNumber('Look at how many?', 3, (n) => openViewer(zone, n)) },
      {
        label: 'Reveal until a nonland card…',
        action: () => askNumber('Highest mana value that fits (cascade: one less than the spell)', 3, (n) => act({ type: 'revealUntil', zone: zone.id, max: n })),
      },
      { label: 'Search library', action: () => openViewer(zone) },
      { label: 'Reveal top card', action: () => zone.cards[0] && act({ type: 'reveal', cards: [zone.cards[0]], to: '*' }) },
      { label: 'Mill…', action: () => askNumber('Mill how many?', 1, (n) => act({ type: 'moveTop', from: zone.id, to: gy.id, n })) },
      { label: 'Exile top card', action: () => act({ type: 'moveTop', from: zone.id, to: exile.id, n: 1 }) },
      { label: 'Play top card face down', action: () => act({ type: 'moveTop', from: zone.id, to: myZone('battlefield')!.id, n: 1, faceDown: true }) },
      { label: 'Mulligan', hint: 'M', action: () => act({ type: 'mulligan' }) },
      { label: 'Mulligan to…', action: () => askNumber('Draw a new hand of how many cards?', state.preset.handSize - 1, (n) => act({ type: 'mulligan', n })) },
      ...(state.preset.magic
        ? [
            { label: 'My turn', heading: true },
            {
              label: `${state.players[me]?.manualTurn ? '' : '✓ '}Untap and draw when my turn starts`,
              action: () => act({ type: 'manualTurn', value: !state.players[me]?.manualTurn }),
            },
          ]
        : []),
      { label: 'Top card', heading: true },
      {
        label: `${zone.topVisible === 'owner' ? '✓ ' : ''}Always look at the top card`,
        action: () => act({ type: 'setTopVisible', zone: zone.id, value: zone.topVisible === 'owner' ? null : 'owner' }),
      },
      {
        label: `${zone.topVisible === 'all' ? '✓ ' : ''}Play with the top card revealed`,
        action: () => act({ type: 'setTopVisible', zone: zone.id, value: zone.topVisible === 'all' ? null : 'all' }),
      },
    );
  } else if (zone.kind === 'pile') {
    items.push({ label: 'View', action: () => openViewer(zone) });
    if (mine && zone.cards.length) {
      const lib = myZone('library')!;
      items.push(
        { label: 'Shuffle', action: () => act({ type: 'shuffle', zone: zone.id }) },
        {
          label: 'Shuffle all into library',
          action: () => {
            act({ type: 'move', cards: [...zone.cards], to: lib.id });
            act({ type: 'shuffle', zone: lib.id });
          },
        },
      );
    }
  } else if (zone.role === 'hand' && !mine) {
    const who = state.players[zone.owner]?.name ?? 'them';
    items.push(
      { label: `Make ${who} discard at random`, action: () => act({ type: 'random', zone: zone.id, action: 'discard' }) },
      { label: `Reveal a random card from ${who}'s hand`, action: () => act({ type: 'random', zone: zone.id, action: 'reveal' }) },
    );
  } else if (zone.role === 'hand' && mine) {
    items.push(
      { label: 'Discard at random', action: () => act({ type: 'random', zone: zone.id, action: 'discard' }) },
      { label: 'Reveal a random card', action: () => act({ type: 'random', zone: zone.id, action: 'reveal' }) },
      { label: 'Reveal hand', action: () => act({ type: 'reveal', cards: [...zone.cards], to: '*' }) },
      { label: 'Stop revealing hand', action: () => act({ type: 'hide', cards: [...zone.cards] }) },
      { label: 'Mulligan', hint: 'M', action: () => act({ type: 'mulligan' }) },
      { label: 'Sort', heading: true },
      { label: 'By mana value', action: () => act({ type: 'sortZone', zone: zone.id, by: 'cost' }) },
      { label: 'By name', action: () => act({ type: 'sortZone', zone: zone.id, by: 'name' }) },
      { label: 'By type', action: () => act({ type: 'sortZone', zone: zone.id, by: 'type' }) },
    );
  } else if (zone.kind === 'free') {
    if (mine) items.push({ label: 'Untap all', hint: 'U', action: () => act({ type: 'untapAll' }) });
    items.push({ label: 'Proliferate…', action: () => useStore.setState({ dialog: 'proliferate', menu: null }) });
    items.push({ label: 'Create card / token…', hint: 'C', action: () => useStore.setState({ dialog: 'create', menu: null }) });
    const last = useStore.getState().lastToken;
    if (last) items.push({ label: `Create another ${last[0].name}`, hint: '⇧C', action: createAnotherToken });
    if (state.arrows.length) items.push({ label: 'Clear arrows', action: () => act({ type: 'clearArrows' }) });
  }
  return items;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
};

/**
 * Moves the picked cards one place along their row (a hand, a pile), or to its start or end with
 * `far`. The selection comes first: it stays on the cards wherever they go, so the key can be pressed
 * again without chasing them with the pointer. On a pile, the start is the top.
 */
export function shiftInRow(by: -1 | 1, far = false) {
  const { state, selection, hovered, me } = useStore.getState();
  if (!state) return false;
  const ids = selection.length ? selection : hovered ? [hovered] : [];
  const zone = ids.length ? state.zones[state.cards[ids[0]]?.zone] : undefined;
  if (!zone || zone.kind === 'free' || ids.some((id) => state.cards[id]?.zone !== zone.id)) return false;
  // Only rows I may rearrange: mine, or the table's (the stack).
  if (zone.owner !== me && zone.owner !== TABLE) return false;
  const at = zone.cards.indexOf(ids.find((id) => zone.cards.includes(id))!);
  const rest = zone.cards.length - ids.length;
  const index = far ? (by < 0 ? 0 : rest) : Math.max(0, Math.min(rest, at + by));
  if (index === at && !far) return true;
  // Carried: the row draws them up while they travel, and puts them down once the keys stop.
  carry(ids);
  act({ type: 'move', cards: zone.cards.filter((id) => ids.includes(id)), to: zone.id, index });
  if (!selection.length) useStore.setState({ selection: ids });
  return true;
}

let carryEnd: ReturnType<typeof setTimeout> | undefined;
/** Marks cards as carried along their row by the keys, for a moment (long enough for the move to come back from the host). */
function carry(ids: CardId[]) {
  useStore.setState({ carry: ids });
  clearTimeout(carryEnd);
  carryEnd = setTimeout(() => useStore.setState({ carry: null }), 1000);
}

export function onKeyDown(e: KeyboardEvent) {
  const store = useStore.getState();
  // Dialogs close on Esc, even with focus in their input.
  if (e.key === 'Escape' && (store.prompt || store.confirm)) {
    useStore.setState({ prompt: null, confirm: null });
    return;
  }
  // The arrange window has its own keys.
  if (isTyping(e) || store.prompt || store.confirm || store.arrange) return;
  const key = e.key.toLowerCase();

  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    act({ type: 'undo' });
    return;
  }
  if ((e.metaKey || e.ctrlKey) && key === 'a') {
    const bf = myZone('battlefield');
    if (bf) {
      e.preventDefault();
      useStore.setState({ selection: [...bf.cards] });
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (key === 'escape') {
    if (store.targeting || store.menu || store.dialog) useStore.setState({ targeting: null, menu: null, dialog: null });
    else if (store.viewer) closeViewer();
    else if (store.focus) useStore.setState({ focus: null });
    else useStore.setState({ selection: [] });
    return;
  }
  if (store.dialog) return;

  if (key === 'arrowleft' || key === 'arrowright') {
    if (shiftInRow(key === 'arrowleft' ? -1 : 1, e.shiftKey)) e.preventDefault();
    return;
  }

  const ids = targetCards();
  const run: Record<string, () => void> = {
    t: () => act({ type: 'tap', cards: ids }),
    f: () => act({ type: 'flip', cards: ids }),
    x: () => act({ type: 'transform', cards: ids }),
    r: () => act({ type: 'reveal', cards: ids, to: '*' }),
    '+': () => act({ type: 'counter', cards: ids, key: DEFAULT_COUNTER, delta: 1 }),
    '=': () => act({ type: 'counter', cards: ids, key: DEFAULT_COUNTER, delta: 1 }),
    '-': () => act({ type: 'counter', cards: ids, key: DEFAULT_COUNTER, delta: -1 }),
    g: () => sendToOwners(ids, 'graveyard'),
    e: () => sendToOwners(ids, 'exile'),
    h: () => sendToOwners(ids, 'hand'),
    l: () => sendToOwners(ids, 'library'),
    b: () => toMyBattlefield(ids),
    a: () => ids[0] && startTargeting(ids[0]),
    p: () => store.hovered && store.session?.point({ card: store.hovered }),
    n: () => editNote(ids, store.state?.cards[ids[0]]?.note),
    delete: () => act({ type: 'delete', cards: ids.filter((id) => store.state?.cards[id]?.token) }),
    backspace: () => act({ type: 'delete', cards: ids.filter((id) => store.state?.cards[id]?.token) }),
  };
  const global: Record<string, () => void> = {
    d: () => draw(),
    s: () => shuffleLibrary(),
    u: () => act({ type: 'untapAll' }),
    m: () => act({ type: 'mulligan' }),
    c: () => useStore.setState({ dialog: 'create' }),
    '`': () => switchToNextSeat(),
    C: () => createAnotherToken(),
    '?': () => useStore.setState({ dialog: 'help' }),
    z: () => useStore.setState({ zoom: true }),
  };

  const fn = (ids.length ? run[key] : undefined) ?? global[e.key] ?? global[key];
  if (fn) {
    e.preventDefault();
    fn();
  }
}

export function onKeyUp(e: KeyboardEvent) {
  if (e.key.toLowerCase() === 'z') useStore.setState({ zoom: false });
}
