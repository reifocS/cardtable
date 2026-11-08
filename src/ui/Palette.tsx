import { useEffect, useMemo, useRef, useState } from 'react';
import { TABLE } from '../core/state';
import type { Card, GameState, Zone } from '../core/types';
import { cardMenu, openViewer, switchToNextSeat, zoneMenu } from './actions';
import { CLOSE, hasWords, score, withCount } from './paletteMatch';
import { shownIn } from './settle';
import { act, ask, myZone, useStore, type MenuItem } from './store';

/**
 * ⌘K: one field to find any card in sight and any action, by typing a few letters. A card found opens
 * its menu right where it lies (or its pile, filtered to it); an action runs as from its menu, and a
 * count typed after it ("scry 2", "draw 3") answers the "how many?" it would ask.
 */

interface Entry {
  key: string;
  label: string;
  /** Where it is, or which menu it comes from. */
  detail: string;
  hint?: string;
  card?: Card;
  run: () => void;
}

/** How many results show at once: enough to choose from, never a wall. */
const SHOWN = 40;

export function Palette({ state }: { state: GameState }) {
  const open = useStore((s) => s.dialog === 'palette');
  if (!open) return null;
  return <PalettePanel state={state} />;
}

const close = () => useStore.setState({ dialog: null });

function PalettePanel({ state }: { state: GameState }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // What can be found, as the table is now.
  const [cards, actions] = useMemo(() => [cardEntries(state), actionEntries()], [state]);
  const spectating = useStore((s) => !!s.session?.spectating);

  const { text, count } = withCount(query);
  const results = useMemo(() => {
    // On its name, or every word on its name and where it is ("plains exile"), never letters strewn across both.
    const ranked = (entries: Entry[], q: string) =>
      entries.map((e) => ({ e, s: Math.max(score(e.label, q), hasWords(`${e.label} ${e.detail}`, q) ? CLOSE - 1 : 0) })).filter((x) => x.s > 0);
    if (!query.trim()) return actions.slice(0, SHOWN);
    // A count is only for actions; cards are matched on all that's typed.
    let scored = [...ranked(cards, query), ...ranked(actions, text)];
    if (scored.some((x) => x.s >= CLOSE)) scored = scored.filter((x) => x.s >= CLOSE - 1);
    const found = scored.sort((a, b) => b.s - a.s).map((x) => x.e);
    const lib = myZone('library');
    if (lib && !spectating)
      found.push({ key: 'search', label: `Search your library for “${query.trim()}”`, detail: 'Library', run: () => openViewer(lib, undefined, query.trim()) });
    return found.slice(0, SHOWN);
  }, [query, text, cards, actions, spectating]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    entry.run();
    // An action that asks how many, given its count: answered at once.
    const prompt = useStore.getState().prompt;
    if (prompt && count !== null && !entry.card) {
      useStore.setState({ prompt: null });
      prompt.submit(String(count));
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const by = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + by + results.length) % Math.max(1, results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Find a card or an action">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Find a card or an action… (scry 2, draw 3, Sol Ring)"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${active}` : undefined}
        />
        <div className="palette-results" id="palette-results" role="listbox" ref={list}>
          {results.map((entry, i) => (
            <button
              key={entry.key}
              id={`palette-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={`palette-item${i === active ? ' active' : ''}${entry.card ? ' is-card' : ''}`}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(entry)}
            >
              <span className="palette-label">
                {entry.label}
                {count !== null && !entry.card && entry.label.endsWith('…') && <span className="palette-count"> {count}</span>}
              </span>
              <span className="palette-detail">{entry.detail}</span>
              {entry.hint && <kbd>{entry.hint}</kbd>}
            </button>
          ))}
          {!results.length && <div className="muted palette-empty">Nothing matches</div>}
        </div>
        <div className="palette-foot muted">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to choose · <kbd>Enter</kbd> to go · <kbd>Esc</kbd> to close
          </span>
          <span>A card opens its menu where it lies</span>
        </div>
      </div>
    </div>
  );
}

/** "Your graveyard", "Bob's hand", "Stack". */
function whereIs(state: GameState, zone: Zone, me: string | null) {
  if (zone.owner === TABLE) return zone.name;
  const whose = zone.owner === me ? 'Your' : `${state.players[zone.owner]?.name ?? '?'}'s`;
  return `${whose} ${zone.name.toLowerCase()}`;
}

/** Every card I can see the face of, mine first: where it lies, a click away. */
function cardEntries(state: GameState): Entry[] {
  const me = useStore.getState().me;
  const zones = Object.values(state.zones).sort((a, b) => Number(b.owner === me) - Number(a.owner === me));
  const entries: Entry[] = [];
  for (const zone of zones) {
    // A library, or someone else's hand: not mine to look through.
    if (zone.visibility === 'hidden' || (zone.visibility === 'owner' && zone.owner !== me)) continue;
    for (const id of zone.cards) {
      const card = state.cards[id];
      const face = card?.faces[card.face] ?? card?.faces[0];
      if (!card || !face?.name || (card.faceDown && card.owner !== me)) continue;
      entries.push({ key: `card:${id}`, label: face.name, detail: whereIs(state, zone, me), card, run: () => showCard(card, zone) });
    }
  }
  return entries;
}

/** A card found: its menu where it lies, or its pile opened on it where it's buried. */
function showCard(card: Card, zone: Zone) {
  const store = useStore.getState();
  const el = shownIn(zone.id, card.id);
  useStore.setState({ previewId: card.id });
  if (!el) {
    const name = (card.faces[card.face] ?? card.faces[0])?.name;
    if (zone.kind === 'pile') openViewer(zone, undefined, name);
    return;
  }
  useStore.setState({ selection: [card.id] });
  if (store.session?.spectating) return;
  const r = el.getBoundingClientRect();
  useStore.setState({ menu: { x: r.right - 6, y: r.top + 6, items: cardMenu(card, zone) } });
}

/** The actions of my menus (library, hand, battlefield) and the game's, as their menus show them. */
function actionEntries(): Entry[] {
  const { me, session, controlled } = useStore.getState();
  if (!me || session?.spectating) return [];
  const entries: Entry[] = [];
  const add = (from: string, items: MenuItem[]) => {
    let section = from;
    for (const item of items) {
      if (item.heading) {
        section = `${from} · ${item.label}`;
        continue;
      }
      if (!item.action || item.disabled) continue;
      entries.push({ key: `${section}:${item.label}`, label: item.label, detail: section, hint: item.hint, run: item.action });
    }
  };
  const lib = myZone('library');
  const hand = myZone('hand');
  const bf = myZone('battlefield');
  if (lib) add('Library', zoneMenu(lib));
  if (hand) add('Hand', zoneMenu(hand));
  if (bf) add('Battlefield', zoneMenu(bf));
  add('Game', [
    { label: 'Undo', hint: '⌘Z', action: () => act({ type: 'undo' }) },
    ...(bf ? [{ label: 'Select my battlefield', hint: '⌘A', action: () => useStore.setState({ selection: [...bf.cards] }) }] : []),
    { label: 'Flip a coin', action: () => act({ type: 'roll', sides: 2 }) },
    ...[6, 20].map((n) => ({ label: `Roll d${n}`, action: () => act({ type: 'roll', sides: n }) })),
    { label: 'Roll dN…', action: () => ask('Number of sides', '100', (v) => act({ type: 'roll', sides: parseInt(v, 10) })) },
    { label: 'Import deck…', action: () => useStore.setState({ dialog: 'import' }) },
    { label: 'Reset my deck (new game)', action: () => act({ type: 'resetDeck' }) },
    ...(controlled.length > 1 ? [{ label: 'Switch to my other seat', hint: '`', action: switchToNextSeat }] : []),
    { label: 'Controls and shortcuts', hint: '?', action: () => useStore.setState({ dialog: 'help' }) },
  ]);
  // The same action in two menus (Mulligan) shows once.
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.label) && !!seen.add(e.label));
}
