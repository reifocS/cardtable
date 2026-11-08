import { useEffect, useRef, useState } from 'react';
import type { ArrangeTo } from '../core/ops';
import type { CardId, GameState, Zone } from '../core/types';
import { closeArrange } from './actions';
import { CardBack, FaceView } from './CardView';
import { insertionIndex, useFlip, withInserted } from './sortable';
import { CardGhost } from './DragGhost';
import { trackPress } from './dragSession';
import { act, useStore, type Store } from './store';

type Dest = keyof ArrangeTo;
type Piles = Partial<Record<Dest, CardId[]>>;

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

/** `piles` with `id` taken out and put in `to` at `index` (its end when past it). */
function placed(piles: Piles, dests: Dest[], id: CardId, to: Dest, index: number): Piles {
  const next: Piles = {};
  for (const d of dests) next[d] = (piles[d] ?? []).filter((c) => c !== id);
  next[to] = withInserted(next[to]!, [id], index);
  return next;
}

/** Puts away the top cards of a pile one by one: a button, a key or a drag sends each where it goes. */
export function Arrange({ state }: { state: GameState }) {
  const arrange = useStore((s) => s.arrange);
  const zone = arrange ? state.zones[arrange.zone] : undefined;
  if (!arrange || !zone) return null;
  return <ArrangePanel key={arrange.ids.join()} state={state} arrange={arrange} zone={zone} />;
}

/** A card being dragged between the rows: where the pointer holds it, and where it would land. */
interface Drag {
  id: CardId;
  x: number;
  y: number;
  /** Where on the card it's held (fractions), and its size. */
  fx: number;
  fy: number;
  w: number;
  h: number;
  to: Dest;
  index: number;
}

function ArrangePanel({ state, arrange, zone }: { state: GameState; arrange: NonNullable<Store['arrange']>; zone: Zone }) {
  const me = useStore((s) => s.me);
  const dests = destsFor(arrange.as, zone.owner === me);
  // Each destination's cards, in order. Everything starts back on top, as it was.
  const [piles, setPiles] = useState<Piles>({ top: arrange.ids });
  const [randomBottom, setRandomBottom] = useState(false);
  // The card the keys and the toolbar act on: it stays picked wherever it goes.
  const [selected, setSelected] = useState<CardId | null>(arrange.ids[0] ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Carried with the keys or the toolbar a moment ago: drawn up out of its row while it travels.
  const [carried, setCarried] = useState<CardId | null>(null);
  const carryEnd = useRef<ReturnType<typeof setTimeout>>(undefined);
  const carry = (id: CardId) => {
    setCarried(id);
    clearTimeout(carryEnd.current);
    carryEnd.current = setTimeout(() => setCarried(null), 1000);
  };
  useEffect(() => () => clearTimeout(carryEnd.current), []);
  const rowEls = useRef(new Map<Dest, HTMLElement>());

  // A card that left meanwhile (a shuffle, an undo) is no longer ours to put away.
  const here = (ids: CardId[] | undefined) => (ids ?? []).filter((id) => zone.cards.includes(id));
  const total = dests.reduce((n, d) => n + here(piles[d]).length, 0);
  useEffect(() => {
    if (!total) closeArrange();
  }, [total]);

  // While dragging, the rows already show the card where it would land.
  const shown = drag ? placed(piles, dests, drag.id, drag.to, drag.index) : piles;
  const destOf = (id: CardId, p: Piles = piles) => dests.find((d) => p[d]?.includes(id));

  const send = (id: CardId, to: Dest) => {
    carry(id);
    setPiles((p) => placed(p, dests, id, to, Infinity));
    setSelected(id);
  };

  /** One step left or right within its row; to either end with `far`. */
  const nudge = (id: CardId, by: -1 | 1, far = false) => {
    carry(id);
    setPiles((p) => {
      const d = destOf(id, p);
      if (!d) return p;
      const i = p[d]!.indexOf(id);
      return placed(p, dests, id, d, far ? (by < 0 ? 0 : Infinity) : i + by);
    });
    setSelected(id);
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

  // Cards glide to their new place whenever the order changes.
  const order = dests.map((d) => here(shown[d]).join()).join('|');
  const flip = useFlip(order, { lifted: carried ? [carried] : [] });

  /** Where a card dropped at (x, y) would go: the row under the pointer, before the first card past it. */
  const landing = (id: CardId, x: number, y: number): { to: Dest; index: number } | null => {
    for (const d of dests) {
      const row = rowEls.current.get(d)?.getBoundingClientRect();
      if (!row || y < row.top || y > row.bottom) continue;
      const rects = here(piles[d])
        .filter((c) => c !== id)
        .map((c) => flip.rect(c))
        .filter((r): r is DOMRect => !!r);
      return { to: d, index: insertionIndex(rects, x, y) };
    }
    return null;
  };

  // The press is followed like any other drag (dragSession); this only says what it does to the rows.
  const onPointerDown = (e: React.PointerEvent, id: CardId) => {
    if (e.button !== 0) return;
    const from = destOf(id);
    if (!from) return;
    e.preventDefault();
    const r = e.currentTarget.querySelector('.card')!.getBoundingClientRect();
    const grip = { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
    // The latest drag, for each next call: the rows it measures against don't change while it's on.
    let now: Drag = { id, x: e.clientX, y: e.clientY, ...grip, to: from, index: piles[from]!.indexOf(id) };
    trackPress(
      { x: e.clientX, y: e.clientY },
      {
        move(at) {
          // Off every row, it stays where it was last shown.
          now = { ...now, x: at.x, y: at.y, ...landing(id, at.x, at.y) };
          setDrag(now);
        },
        drop() {
          setPiles((p) => placed(p, dests, id, now.to, now.index));
          setSelected(id);
          setDrag(null);
        },
        // A press without a drag is a click: it picks the card for the keys and the toolbar.
        click: () => setSelected(id),
        cancel: () => setDrag(null),
      },
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // (An Esc during a drag only ends the drag: dragSession takes it first.)
      if (e.key === 'Escape') return closeArrange();
      if (e.key === 'Enter') {
        e.preventDefault();
        return confirm();
      }
      if (!selected) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        return nudge(selected, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey);
      }
      // Tab walks the pick through the cards, in the order they're shown.
      if (e.key === 'Tab') {
        e.preventDefault();
        const all = dests.flatMap((d) => here(piles[d]));
        const i = all.indexOf(selected);
        return setSelected(all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]);
      }
      const d = dests.find((x) => DESTS[x].key === e.key.toLowerCase());
      if (d) send(selected, d);
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
  const selDest = selected ? destOf(selected) : undefined;
  const selIndex = selDest && selected ? here(piles[selDest]).indexOf(selected) : -1;
  const selCount = selDest ? here(piles[selDest]).length : 0;
  const faceOf = (id: CardId) => {
    const card = state.cards[id];
    return card?.faces[card.face] ?? card?.faces[0];
  };
  const sleeve = state.players[zone.owner]?.sleeve;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeArrange()}>
      <div className={`modal wide arrange${drag ? ' dragging' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <b>{title}</b>
          <button onClick={() => closeArrange()} aria-label="Cancel">
            ✕
          </button>
        </div>
        {dests.map((d) => {
          const ids = here(shown[d]);
          return (
            <section
              key={d}
              ref={(el) => {
                if (el) rowEls.current.set(d, el);
                else rowEls.current.delete(d);
              }}
              className={`arrange-row${drag?.to === d ? ' landing' : ''}`}
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
                {ids.map((id) => {
                  const face = faceOf(id);
                  const held = drag?.id === id;
                  return (
                    <div
                      key={id}
                      ref={flip.ref(id)}
                      className={`arrange-card${selected === id ? ' selected' : ''}${held ? ' held' : ''}`}
                      onPointerDown={(e) => onPointerDown(e, id)}
                      onPointerEnter={() => face && useStore.setState({ previewId: id })}
                    >
                      <div className="card">{face ? <FaceView face={face} width={110} /> : <CardBack sleeve={sleeve} />}</div>
                      <div className="arrange-moves">
                        {dests
                          .filter((x) => x !== d)
                          .map((x) => (
                            <button
                              key={x}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => send(id, x)}
                              title={`${DESTS[x].label} (${DESTS[x].key.toUpperCase()})`}
                            >
                              {DESTS[x].label}
                            </button>
                          ))}
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
          {/* Fixed in place: these never move under the pointer, whatever the picked card does. */}
          <div className="arrange-toolbar">
            <button disabled={selIndex <= 0} onClick={() => selected && nudge(selected, -1)} title="Move the picked card left (←, ⇧← to the start)">
              ←
            </button>
            <button
              disabled={selIndex < 0 || selIndex >= selCount - 1}
              onClick={() => selected && nudge(selected, 1)}
              title="Move the picked card right (→, ⇧→ to the end)"
            >
              →
            </button>
            <span className="muted">
              Click to pick · drag to place · {dests.map((d) => DESTS[d].key.toUpperCase()).join('/')} sends the picked card · Tab: next · Enter: done
            </span>
          </div>
          <button className="primary" onClick={confirm}>
            Done
          </button>
        </div>
      </div>
      {drag && state.cards[drag.id] && (
        <CardGhost card={state.cards[drag.id]} x={drag.x} y={drag.y} fx={drag.fx} fy={drag.fy} w={drag.w} h={drag.h} sleeve={sleeve} />
      )}
    </div>
  );
}
