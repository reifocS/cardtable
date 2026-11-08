import type React from 'react';
import { CARD_H, CARD_W } from '../core/state';
import type { Card, CardId, ZoneId } from '../core/types';
import { trackPress, type PointerInfo } from './dragSession';
import { VIEW_H, mirrorY, storeX, storeY } from './fit';
import { justDropped } from './Flights';
import { insertionIndex } from './sortable';
import { act, setSelection, useStore, type TableDrag } from './store';

/**
 * Cards dragged across the table. The press is followed by dragSession; what the drag looks like (the
 * ghost, the faded places, the zone lit up, a row making room) is drawn by the components from
 * `store.drag`, never by touching their elements here. This only reads the page: which zone is under
 * the pointer, and where in a row.
 */

/** The drop zone element under a screen point. Drop zones carry `data-drop-zone`. */
function dropTargetAt(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y)?.closest('[data-drop-zone]') as HTMLElement | null) ?? null;
}

/** How far the pointer may stray outside the zone it's over before it counts as leaving it. */
const STICK_PX = 12;

/**
 * The drop zone for a pointer at (x, y), given the one it was over (`held`). A zone holds on until the
 * pointer is clearly out of it: right at an edge, or as a row grows to make room under the pointer,
 * the target would otherwise flicker between it and what's next to it.
 */
function stickyTarget(held: HTMLElement | null, x: number, y: number): HTMLElement | null {
  const hit = dropTargetAt(x, y);
  if (!held || hit === held || !held.isConnected) return hit;
  const r = held.getBoundingClientRect();
  const near = x >= r.left - STICK_PX && x <= r.right + STICK_PX && y >= r.top - STICK_PX && y <= r.bottom + STICK_PX;
  return near ? held : hit;
}

/** Rows that show where dragged cards would land: a hand, a pile's viewer (not filtered). */
const isRow = (t: HTMLElement) => !!t.dataset.dropList;

/**
 * Insertion index among the row's rendered cards, ignoring the ones being dragged. Measured on their
 * slots (`data-sort-id`) where the row has them, at rest: not chasing a card that's sliding aside.
 */
function indexAt(target: HTMLElement, dragged: CardId[], x: number, y: number): number {
  const slots = [...target.querySelectorAll<HTMLElement>('[data-sort-id]')];
  const els = slots.length
    ? slots.map((el) => [el, el.dataset.sortId!] as const)
    : [...target.querySelectorAll<HTMLElement>('[data-card-id]')].map((el) => [el, el.dataset.cardId!] as const);
  const rects = els.filter(([, id]) => !dragged.includes(id)).map(([el]) => restingRect(el));
  return insertionIndex(rects, x, y);
}

/** An element's box without the transform of a slide under way. */
function restingRect(el: HTMLElement): DOMRect {
  const r = el.getBoundingClientRect();
  if (!el.getAnimations().length) return r;
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return r;
  const m = new DOMMatrixReadOnly(t);
  return new DOMRect(r.left - m.m41, r.top - m.m42, r.width, r.height);
}

/**
 * Where dragged cards would land in zone `t`. In a row, by where the held card's middle is, not the
 * pointer: a card held by its edge goes where it's seen to go. Kept the same object while unchanged, so
 * rows don't re-render on every move.
 */
function overAt(t: HTMLElement | null, ids: CardId[], middle: { x: number; y: number }, was: TableDrag['over']): TableDrag['over'] {
  if (!t) return null;
  const zone = t.dataset.dropZone as ZoneId;
  const index = isRow(t) ? indexAt(t, ids, middle.x, middle.y) : null;
  return was?.zone === zone && was.index === index ? was : { zone, index };
}

export function finishTargeting(to: string) {
  const { targeting, targetMode, attachCards, state } = useStore.getState();
  if (targeting && targeting !== to) {
    if (targetMode === 'arrow') act({ type: 'arrow', from: targeting, to });
    // Only cards can carry attachments.
    else if (state?.cards[to]) act({ type: 'attach', cards: attachCards, to });
  }
  useStore.setState({ targeting: null });
}

/**
 * Click selects, drag moves. Dragging a selected card drags the whole selection;
 * cards keep their relative layout when they land on a battlefield.
 */
export function onCardPointerDown(e: React.PointerEvent<HTMLElement>, card: Card) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useStore.getState();
  if (store.session?.spectating) return;
  if (store.targeting) {
    finishTargeting(card.id);
    return;
  }

  const rect = e.currentTarget.getBoundingClientRect();
  const fx = (e.clientX - rect.left) / rect.width;
  const fy = (e.clientY - rect.top) / rect.height;
  const zone = store.state?.zones[card.zone];
  // A tapped card's box on screen is turned: the card itself is as tall as the box is wide.
  const turn = zone?.kind === 'free' ? card.rotation : 0;
  const sideways = turn % 180 !== 0;
  const own = { w: sideways ? rect.height : rect.width, h: sideways ? rect.width : rect.height };
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  let ids: CardId[] = store.selection.includes(card.id) ? store.selection : [card.id];
  // The zone it's over, held on to near its edges (see stickyTarget).
  let held: HTMLElement | null = null;

  const update = (at: PointerInfo) => {
    const d = useStore.getState().drag;
    if (!d) return;
    const t = (held = stickyTarget(held, at.x, at.y));
    // Over a zone, the ghost takes the size cards have there; over nothing, its own. Only a battlefield keeps it tapped.
    const size = cardSizeIn(t, ids) ?? own;
    const keepTurn = turn && t?.classList.contains('board') ? turn : 0;
    const middle = { x: at.x + (0.5 - fx) * size.w, y: at.y + (0.5 - fy) * size.h };
    useStore.setState({ drag: { ...d, x: at.x, y: at.y, w: size.w, h: size.h, turn: keepTurn, over: overAt(t, ids, middle, d.over) } });
  };

  trackPress(
    { x: e.clientX, y: e.clientY },
    {
      start(at) {
        if (!useStore.getState().selection.includes(card.id)) {
          ids = [card.id];
          setSelection(ids);
        }
        useStore.setState({ drag: { ids, x: at.x, y: at.y, fx, fy, w: own.w, h: own.h, turn, over: null } });
      },
      move: update,
      drop(at) {
        update(at);
        const over = useStore.getState().drag?.over ?? null;
        useStore.setState({ drag: null });
        drop(at, ids, card, fx, fy, over, held);
      },
      click(at) {
        // Alt+click (no drag) pings the card for everyone; Alt+drag still plays face down.
        if (at.altKey) {
          useStore.getState().session?.point({ card: card.id });
          return;
        }
        if (additive) {
          const sel = useStore.getState().selection;
          setSelection(sel.includes(card.id) ? sel.filter((id) => id !== card.id) : [...sel, card.id]);
        } else {
          setSelection([card.id]);
        }
      },
      cancel: () => useStore.setState({ drag: null }),
    },
  );
}

/**
 * How big a card is on screen in a drop zone, upright: on a battlefield, from the board's scale; on a
 * pile, its slot; in a hand or any list, one of the cards already there (not those being dragged).
 */
function cardSizeIn(target: HTMLElement | null, dragged: CardId[]): { w: number; h: number } | null {
  if (!target) return null;
  if (target.classList.contains('board')) {
    const h = (target.getBoundingClientRect().height / VIEW_H) * CARD_H;
    return { w: (h * CARD_W) / CARD_H, h };
  }
  if (target.classList.contains('pile-slot')) {
    const r = target.getBoundingClientRect();
    return { w: r.width, h: (r.width * CARD_H) / CARD_W };
  }
  const other = [...target.querySelectorAll<HTMLElement>('[data-card-id]')].find((c) => !dragged.includes(c.dataset.cardId!));
  if (!other || other.classList.contains('tapped')) return null;
  const r = other.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function drop(at: PointerInfo, ids: CardId[], primary: Card, fx: number, fy: number, over: TableDrag['over'], target: HTMLElement | null) {
  const state = useStore.getState().state;
  if (!target || !state || !over) return;
  const zone = state.zones[over.zone];
  if (!zone) return;
  const ordered = ids.filter((id) => state.cards[id]);
  // Already where they land: they don't fly there.
  for (const id of ordered) justDropped.add(id);

  if (zone.kind === 'free') {
    const r = target.getBoundingClientRect();
    // The board's logical width varies per screen; its height is always VIEW_H.
    const scale = r.height / VIEW_H;
    const width = r.width / scale;
    const px = storeX((at.x - r.left) / scale - fx * CARD_W, width);
    const visualY = storeY((at.y - r.top) / scale - fy * CARD_H);
    const py = target.dataset.flipped ? mirrorY(visualY) : visualY;
    const fromBoard = state.zones[primary.zone]?.kind === 'free';
    const positions: Record<CardId, [number, number]> = {};
    ordered.forEach((id, i) => {
      const c = state.cards[id];
      const together = fromBoard && c.zone === primary.zone;
      positions[id] = together ? [px + c.x - primary.x, py + c.y - primary.y] : [px + i * 18, py + i * 6];
    });
    act({ type: 'move', cards: ordered, to: zone.id, positions, ...(at.altKey && { faceDown: true }) });
  } else if (over.index === null) {
    // A pile: on top, or with Shift at the bottom.
    act({ type: 'move', cards: ordered, to: zone.id, index: at.shiftKey ? -1 : 0 });
  } else {
    // A row: exactly where it showed the cards would land.
    act({ type: 'move', cards: ordered, to: zone.id, index: over.index });
  }
}

/** Pings a spot on a battlefield, in stored coordinates so every screen shows it in the same place. */
function pingSpot(board: HTMLElement, clientX: number, clientY: number) {
  const zone = board.dataset.dropZone;
  if (!zone) return;
  const r = board.getBoundingClientRect();
  const scale = r.height / VIEW_H;
  const x = storeX((clientX - r.left) / scale - CARD_W / 2, r.width / scale);
  const y = storeY((clientY - r.top) / scale - CARD_H / 2);
  useStore.getState().session?.point({ zone, x, y: board.dataset.flipped ? mirrorY(y) : y });
}

/** Rubber-band selection on an empty battlefield. A plain click clears the selection. */
export function onBoardPointerDown(e: React.PointerEvent<HTMLElement>) {
  if (e.button !== 0 || e.target !== e.currentTarget) return;
  if (useStore.getState().targeting) return;
  const board = e.currentTarget;
  if (e.altKey) {
    pingSpot(board, e.clientX, e.clientY);
    return;
  }
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const sx = e.clientX;
  const sy = e.clientY;
  // Outside React's tree (on the body), so drawing it by hand doesn't fight a render.
  let box: HTMLElement | null = null;

  const rectOf = (at: PointerInfo) => ({
    left: Math.min(sx, at.x),
    top: Math.min(sy, at.y),
    right: Math.max(sx, at.x),
    bottom: Math.max(sy, at.y),
  });

  trackPress(
    { x: sx, y: sy },
    {
      start() {
        box = document.createElement('div');
        box.className = 'select-box';
        document.body.appendChild(box);
      },
      move(at) {
        const r = rectOf(at);
        Object.assign(box!.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
      },
      drop(at) {
        box?.remove();
        const r = rectOf(at);
        const hit = [...board.querySelectorAll<HTMLElement>('[data-card-id]')]
          .filter((el) => {
            const c = el.getBoundingClientRect();
            return c.right > r.left && c.left < r.right && c.bottom > r.top && c.top < r.bottom;
          })
          .map((el) => el.dataset.cardId!);
        const prev = additive ? useStore.getState().selection : [];
        setSelection([...new Set([...prev, ...hit])]);
      },
      click() {
        if (!additive) setSelection([]);
      },
      cancel: () => box?.remove(),
    },
  );
}
