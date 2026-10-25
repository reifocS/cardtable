import { useState } from 'react';
import type { Card, GameState, Zone } from '../core/types';
import { closeViewer } from './actions';
import { CardView } from './CardView';
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
  // Another zone opens with an empty filter.
  return <ViewerPanel key={zone.id} state={state} viewer={viewer} zone={zone} />;
}

function ViewerPanel({ state, viewer, zone }: { state: GameState; viewer: NonNullable<Store['viewer']>; zone: Zone }) {
  const me = useStore((s) => s.me);
  const [query, setQuery] = useState('');
  const ids = viewer.ids ? zone.cards.filter((id) => viewer.ids!.includes(id)) : zone.cards;
  const shown = ids.filter((id) => state.cards[id] && matches(state.cards[id], query));
  const filtering = shown.length !== ids.length;
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
      <div className="viewer-cards" data-drop-zone={zone.id} data-drop-list={filtering ? undefined : '1'}>
        {shown.map((id) => (
          <CardView key={id} card={state.cards[id]} zone={zone} />
        ))}
        {shown.length === 0 && <div className="muted">{ids.length ? 'No match' : 'Empty'}</div>}
      </div>
    </div>
  );
}
