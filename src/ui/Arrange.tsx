import { useEffect, useState } from 'react';
import type { ArrangeTo } from '../core/ops';
import type { CardId, GameState, Zone } from '../core/types';
import { closeArrange } from './actions';
import { CardBack, FaceView } from './CardView';
import { act, useStore, type Store } from './store';

type Dest = keyof ArrangeTo;

const DESTS: Record<Dest, { label: string; key: string; hint: string }> = {
  top: { label: 'Top', key: 't', hint: 'first = top' },
  bottom: { label: 'Bottom', key: 'b', hint: 'last = bottom' },
  graveyard: { label: 'Graveyard', key: 'g', hint: '' },
  exile: { label: 'Exile', key: 'e', hint: '' },
  hand: { label: 'Hand', key: 'h', hint: '' },
};

/** Where cards can go: scry and surveil are Magic's rules; a plain look offers everything. */
function destsFor(as: 'scry' | 'surveil' | undefined, mine: boolean): Dest[] {
  if (as === 'scry') return ['top', 'bottom'];
  if (as === 'surveil') return ['top', 'graveyard'];
  return mine ? ['top', 'bottom', 'hand', 'graveyard', 'exile'] : ['top', 'bottom', 'graveyard', 'exile'];
}

/** Puts away the top cards of a pile one by one: a button, a key or a drag sends each where it goes. */
export function Arrange({ state }: { state: GameState }) {
  const arrange = useStore((s) => s.arrange);
  const zone = arrange ? state.zones[arrange.zone] : undefined;
  if (!arrange || !zone) return null;
  return <ArrangePanel key={arrange.ids.join()} state={state} arrange={arrange} zone={zone} />;
}

function ArrangePanel({ state, arrange, zone }: { state: GameState; arrange: NonNullable<Store['arrange']>; zone: Zone }) {
  const me = useStore((s) => s.me);
  const dests = destsFor(arrange.as, zone.owner === me);
  // Each destination's cards, in order. Everything starts back on top, as it was.
  const [piles, setPiles] = useState<Partial<Record<Dest, CardId[]>>>({ top: arrange.ids });
  const [randomBottom, setRandomBottom] = useState(false);
  const [hovered, setHovered] = useState<CardId | null>(null);
  const [dragging, setDragging] = useState<CardId | null>(null);

  // A card that left meanwhile (a shuffle, an undo) is no longer ours to put away.
  const here = (ids: CardId[] | undefined) => (ids ?? []).filter((id) => zone.cards.includes(id));
  const total = dests.reduce((n, d) => n + here(piles[d]).length, 0);
  useEffect(() => {
    if (!total) closeArrange();
  }, [total]);

  const destOf = (id: CardId) => dests.find((d) => piles[d]?.includes(id));

  /** Moves a card to a destination, before `before` (or at its end). */
  const send = (id: CardId, to: Dest, before?: CardId) => {
    setPiles((p) => {
      const next: typeof p = {};
      for (const d of dests) next[d] = (p[d] ?? []).filter((c) => c !== id);
      const list = next[to]!;
      const at = before && before !== id ? list.indexOf(before) : -1;
      list.splice(at < 0 ? list.length : at, 0, id);
      return next;
    });
  };

  /** One step left or right within its row. */
  const nudge = (id: CardId, by: -1 | 1) => {
    const d = destOf(id);
    if (!d) return;
    setPiles((p) => {
      const list = [...(p[d] ?? [])];
      const i = list.indexOf(id);
      const j = i + by;
      if (j < 0 || j >= list.length) return p;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, [d]: list };
    });
  };

  const confirm = () => {
    const to: ArrangeTo = {};
    for (const d of dests) {
      const ids = here(piles[d]);
      if (ids.length) to[d] = ids;
    }
    act({ type: 'arrange', zone: zone.id, as: arrange.as, to, randomBottom: randomBottom || undefined });
    closeArrange(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') return closeArrange();
      if (e.key === 'Enter') {
        e.preventDefault();
        return confirm();
      }
      if (!hovered) return;
      if (e.key === 'ArrowLeft') return nudge(hovered, -1);
      if (e.key === 'ArrowRight') return nudge(hovered, 1);
      const d = dests.find((x) => DESTS[x].key === e.key.toLowerCase());
      // The card moves away from under the pointer: the next key waits for the pointer to find one.
      if (d) {
        send(hovered, d);
        setHovered(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title =
    arrange.as === 'scry'
      ? `Scry ${arrange.ids.length}`
      : arrange.as === 'surveil'
        ? `Surveil ${arrange.ids.length}`
        : `Top ${arrange.ids.length} of ${zone.owner === me ? 'your' : `${state.players[zone.owner]?.name}'s`} ${zone.name.toLowerCase()}`;
  const bottomCount = here(piles.bottom).length;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeArrange()}>
      <div className="modal wide arrange" role="dialog" aria-label={title}>
        <div className="modal-head">
          <b>{title}</b>
          <button onClick={() => closeArrange()} aria-label="Cancel">
            ✕
          </button>
        </div>
        {dests.map((d) => {
          const ids = here(piles[d]);
          return (
            <section
              key={d}
              className={`arrange-row${dragging && destOf(dragging) !== d ? ' can-drop' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) send(dragging, d);
                setDragging(null);
              }}
            >
              <div className="arrange-label">
                <b>{DESTS[d].label}</b>
                <kbd>{DESTS[d].key.toUpperCase()}</kbd>
                {ids.length > 1 && DESTS[d].hint && <span className="muted">{DESTS[d].hint}</span>}
                {d === 'bottom' && bottomCount > 1 && (
                  <label className="muted">
                    <input type="checkbox" checked={randomBottom} onChange={(e) => setRandomBottom(e.target.checked)} /> random order
                  </label>
                )}
              </div>
              <div className="arrange-cards">
                {ids.map((id, i) => {
                  const card = state.cards[id];
                  const face = card?.faces[card.face] ?? card?.faces[0];
                  return (
                    <div
                      key={id}
                      className={`arrange-card${hovered === id ? ' hovered' : ''}${dragging === id ? ' dragging' : ''}`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragging) send(dragging, d, id);
                        setDragging(null);
                      }}
                      onPointerMove={() => {
                        if (hovered === id) return;
                        setHovered(id);
                        if (face) useStore.setState({ previewId: id });
                      }}
                      onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
                    >
                      <div className="card">{face ? <FaceView face={face} width={110} /> : <CardBack sleeve={state.players[zone.owner]?.sleeve} />}</div>
                      <div className="arrange-moves">
                        {ids.length > 1 && (
                          <button disabled={i === 0} onClick={() => nudge(id, -1)} aria-label="Move left">
                            ‹
                          </button>
                        )}
                        {dests
                          .filter((x) => x !== d)
                          .map((x) => (
                            <button key={x} onClick={() => send(id, x)} title={`${DESTS[x].label} (${DESTS[x].key.toUpperCase()})`}>
                              {DESTS[x].label}
                            </button>
                          ))}
                        {ids.length > 1 && (
                          <button disabled={i === ids.length - 1} onClick={() => nudge(id, 1)} aria-label="Move right">
                            ›
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!ids.length && <div className="muted arrange-empty">Drop cards here</div>}
              </div>
            </section>
          );
        })}
        <div className="modal-actions">
          <span className="muted">Hover a card: {dests.map((d) => DESTS[d].key.toUpperCase()).join(' / ')} to send it, ← → to reorder · Enter to confirm</span>
          <button className="primary" onClick={confirm}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
