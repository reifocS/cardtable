import { useState } from 'react';
import type { Card, GameState, Zone } from '../core/types';
import { closeViewer } from './actions';
import { CardView } from './CardView';
import { useDropHover, useLifted, useRowOrder } from './rowOrder';
import { useFlip } from './sortable';
import { act, useStore, type Store } from './store';

/** Every word must appear in the name, type line or rules text of some face: "basic land", "creature flying". */
function matches(card: Card, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = card.faces.map((f) => `${f.name} ${f.type ?? ''} ${f.text ?? ''}`).join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** Floating list of a zone's cards: filter, drag them out, reorder them, right-click for actions. */
export function Viewer({ state }: { state: GameState }) {
  const viewer = useStore((s) => s.viewer);
  const zone = viewer ? state.zones[viewer.zone] : undefined;
  if (!viewer || !zone) return null;
  // Another zone, or a search from the palette, opens with its own filter.
  return <ViewerPanel key={`${zone.id}:${viewer.query ?? ''}`} state={state} viewer={viewer} zone={zone} />;
}

function ViewerPanel({ state, viewer, zone }: { state: GameState; viewer: NonNullable<Store['viewer']>; zone: Zone }) {
  const me = useStore((s) => s.me);
  const [query, setQuery] = useState(viewer.query ?? '');
  const ids = viewer.ids ? zone.cards.filter((id) => viewer.ids!.includes(id)) : zone.cards;
  const shown = ids.filter((id) => state.cards[id] && matches(state.cards[id], query));
  const filtering = shown.length !== ids.length;
  // Not while filtering: positions in the list aren't positions in the zone.
  const previewed = useRowOrder(zone, shown);
  const order = filtering ? shown : previewed;
  const flip = useFlip(order.join(), { lifted: useLifted() });
  const hover = useDropHover(zone.id);
  // Cards dragged from this very list: while filtering, they can't be put anywhere else in it.
  const fromHere = useStore((s) => !!s.drag?.ids.length && s.drag.ids.every((id) => state.cards[id]?.zone === zone.id));
  const owner = state.players[zone.owner]?.name;
  const title = `${zone.owner === me ? 'Your' : `${owner}'s`} ${zone.name.toLowerCase()}${viewer.ids ? ` — top ${viewer.ids.length}` : ''}`;

  return (
    <div className="viewer">
      <div className="viewer-head">
        <b>{title}</b>
        <input
          className="viewer-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (query ? setQuery('') : closeViewer())}
          placeholder="Filter: name, type or text…"
          autoFocus={!viewer.ids}
        />
        {/* Filtered, a place in the list isn't a place in the zone (cards hidden between): no reordering, and it says so. */}
        {filtering && hover ? (
          <span className="viewer-hint">{fromHere ? 'Clear the filter to reorder' : 'Goes on top · Shift: at the bottom'}</span>
        ) : (
          <span className="muted">
            {filtering ? `${shown.length} of ${ids.length}` : ids.length} card{ids.length === 1 ? '' : 's'} · first = top
            {filtering && ' · clear the filter to reorder'}
          </span>
        )}
        <div className="spacer" />
        {zone.kind === 'pile' && zone.owner === me && (
          <button
            onClick={() => {
              closeViewer();
              act({ type: 'shuffle', zone: zone.id });
            }}
          >
            Shuffle &amp; close
          </button>
        )}
        <button onClick={closeViewer}>Close</button>
      </div>
      {/* While filtering, positions in the list aren't positions in the zone: cards from elsewhere go on top, and
          its own cards stay where they are (see drag.ts). */}
      <div
        className={`viewer-cards${hover ? ' drop-hover' : ''}`}
        data-drop-zone={zone.id}
        data-drop-list={filtering ? undefined : '1'}
        data-filtered={filtering ? '1' : undefined}
      >
        {order.map((id) =>
          state.cards[id]?.zone === zone.id ? (
            <div key={id} ref={flip.ref(id)} data-sort-id={id} className="viewer-slot">
              <CardView card={state.cards[id]} zone={zone} />
            </div>
          ) : (
            // A card on its way in from elsewhere: the room it will take.
            <div key={id} ref={flip.ref(id)} data-sort-id={id} className="viewer-slot drop-gap" />
          ),
        )}
        {shown.length === 0 && <div className="muted">{ids.length ? 'No match' : 'Empty'}</div>}
      </div>
    </div>
  );
}
