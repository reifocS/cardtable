import { useEffect, useRef, useState } from 'react';
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

/**
 * Whether the panel steps aside for a drag: a card taken out of it, once the pointer has left the
 * panel. It then fades and lets the pointer through until the drop, even back over where it stands,
 * so the card can land on the battlefield or the hand it covers. A card dragged in from elsewhere
 * finds it there as usual.
 */
function usePassing(zone: Zone) {
  const ref = useRef<HTMLDivElement>(null);
  // The drag's cards (the same array from its first move to its drop): which drag it stepped aside for.
  const dragged = useStore((s) => (s.drag && zone.cards.includes(s.drag.ids[0]) ? s.drag.ids : null));
  const x = useStore((s) => s.drag?.x);
  const y = useStore((s) => s.drag?.y);
  const [outFor, setOutFor] = useState<unknown>(null);
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!dragged || x === undefined || y === undefined || !r) return;
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) setOutFor(dragged);
  }, [dragged, x, y]);
  return [ref, !!dragged && outFor === dragged] as const;
}

/** Floating list of a zone's cards: filter, drag them out, reorder them, right-click for actions. */
export function Viewer({ state }: { state: GameState }) {
  const viewer = useStore((s) => s.viewer);
  const zone = viewer ? state.zones[viewer.zone] : undefined;
  if (!viewer || !zone) return null;
  // Another zone opens with an empty filter.
  return <ViewerPanel key={zone.id} state={state} viewer={viewer} zone={zone} />;
}

function ViewerPanel({ state, viewer, zone }: { state: GameState; viewer: NonNullable<Store['viewer']>; zone: Zone }) {
  const me = useStore((s) => s.me);
  const [query, setQuery] = useState('');
  const ids = viewer.ids ? zone.cards.filter((id) => viewer.ids!.includes(id)) : zone.cards;
  const shown = ids.filter((id) => state.cards[id] && matches(state.cards[id], query));
  const filtering = shown.length !== ids.length;
  // Not while filtering: positions in the list aren't positions in the zone.
  const previewed = useRowOrder(zone, shown);
  const order = filtering ? shown : previewed;
  const flip = useFlip(order.join(), { lifted: useLifted() });
  const hover = useDropHover(zone.id);
  const owner = state.players[zone.owner]?.name;
  const title = `${zone.owner === me ? 'Your' : `${owner}'s`} ${zone.name.toLowerCase()}${viewer.ids ? ` — top ${viewer.ids.length}` : ''}`;
  const [panelRef, passing] = usePassing(zone);

  return (
    <div className={`viewer${passing ? ' passing' : ''}`} ref={panelRef}>
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
        <span className="muted">
          {filtering ? `${shown.length} of ${ids.length}` : ids.length} card{ids.length === 1 ? '' : 's'} · first = top
        </span>
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
      {/* While filtering, positions in the list aren't positions in the zone, so drops just go on top. */}
      <div className={`viewer-cards${hover ? ' drop-hover' : ''}`} data-drop-zone={zone.id} data-drop-list={filtering ? undefined : '1'}>
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
