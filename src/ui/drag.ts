import type React from 'react';
import { CARD_H, CARD_W } from '../core/state';
import { VIEW_H, mirrorY, storeX, storeY } from './fit';
import type { Card, CardId, Zone } from '../core/types';
import { act, setSelection, useStore } from './store';

const DRAG_THRESHOLD = 5;

/** The drop zone element under a screen point. Drop zones carry `data-drop-zone`. */
function dropTargetAt(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y)?.closest('[data-drop-zone]') as HTMLElement | null) ?? null;
}

/** Insertion index among the zone's rendered cards, ignoring the ones being dragged. */
function indexAt(target: HTMLElement, dragged: CardId[], x: number, y: number): number {
  const els = [...target.querySelectorAll<HTMLElement>('[data-card-id]')].filter((el) => !dragged.includes(el.dataset.cardId!));
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) return i;
  }
  return -1;
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
export function onCardPointerDown(e: React.PointerEvent<HTMLElement>, card: Card, zone: Zone) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const store = useStore.getState();
  if (store.targeting) {
    finishTargeting(card.id);
    return;
  }

  const el = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const rect = el.getBoundingClientRect();
  const fx = (startX - rect.left) / rect.width;
  const fy = (startY - rect.top) / rect.height;
  let ids: CardId[] = store.selection.includes(card.id) ? store.selection : [card.id];
  let ghost: HTMLElement | null = null;
  let hoverTarget: HTMLElement | null = null;

  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      if (!store.selection.includes(card.id)) {
        ids = [card.id];
        setSelection(ids);
      }
      ghost = makeGhost(el, ids.length);
      document.body.classList.add('dragging');
      for (const id of ids) document.querySelectorAll(`[data-card-id="${id}"]`).forEach((n) => n.classList.add('drag-source'));
    }
    const w = ghost.offsetWidth;
    const h = ghost.offsetHeight;
    ghost.style.transform = `translate(${ev.clientX - fx * w}px, ${ev.clientY - fy * h}px)`;
    const t = dropTargetAt(ev.clientX, ev.clientY);
    if (t !== hoverTarget) {
      hoverTarget?.classList.remove('drop-hover');
      t?.classList.add('drop-hover');
      hoverTarget = t;
    }
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!ghost) {
      // Alt+click (no drag) pings the card for everyone; Alt+drag still plays face down.
      if (ev.altKey) {
        useStore.getState().session?.point({ card: card.id });
        return;
      }
      if (additive) {
        const sel = useStore.getState().selection;
        setSelection(sel.includes(card.id) ? sel.filter((id) => id !== card.id) : [...sel, card.id]);
      } else {
        setSelection([card.id]);
      }
      return;
    }
    ghost.remove();
    hoverTarget?.classList.remove('drop-hover');
    document.body.classList.remove('dragging');
    document.querySelectorAll('.drag-source').forEach((n) => n.classList.remove('drag-source'));
    if (ev.type === 'pointerup') drop(ev, ids, card, fx, fy);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function makeGhost(el: HTMLElement, count: number): HTMLElement {
  const r = el.getBoundingClientRect();
  const tapped = el.classList.contains('tapped');
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.className = 'card ghost';
  ghost.removeAttribute('data-card-id');
  // A tapped card's bounding box is rotated; the ghost is drawn upright.
  ghost.style.cssText = `width:${tapped ? r.height : r.width}px;height:${tapped ? r.width : r.height}px`;
  if (count > 1) {
    const badge = document.createElement('div');
    badge.className = 'ghost-count';
    badge.textContent = String(count);
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);
  return ghost;
}

function drop(ev: PointerEvent, ids: CardId[], primary: Card, fx: number, fy: number) {
  const target = dropTargetAt(ev.clientX, ev.clientY);
  const state = useStore.getState().state;
  if (!target || !state) return;
  const zone = state.zones[target.dataset.dropZone!];
  if (!zone) return;
  const ordered = ids.filter((id) => state.cards[id]);

  if (zone.kind === 'free') {
    const r = target.getBoundingClientRect();
    // The board's logical width varies per screen; its height is always VIEW_H.
    const scale = r.height / VIEW_H;
    const width = r.width / scale;
    const px = storeX((ev.clientX - r.left) / scale - fx * CARD_W, width);
    const visualY = storeY((ev.clientY - r.top) / scale - fy * CARD_H);
    const py = target.dataset.flipped ? mirrorY(visualY) : visualY;
    const fromBoard = state.zones[primary.zone]?.kind === 'free';
    const positions: Record<CardId, [number, number]> = {};
    ordered.forEach((id, i) => {
      const c = state.cards[id];
      const together = fromBoard && c.zone === primary.zone;
      positions[id] = together ? [px + c.x - primary.x, py + c.y - primary.y] : [px + i * 18, py + i * 6];
    });
    act({ type: 'move', cards: ordered, to: zone.id, positions, ...(ev.altKey && { faceDown: true }) });
  } else if (zone.kind === 'pile' && !target.dataset.dropList) {
    act({ type: 'move', cards: ordered, to: zone.id, index: ev.shiftKey ? -1 : 0 });
  } else {
    act({ type: 'move', cards: ordered, to: zone.id, index: indexAt(target, ordered, ev.clientX, ev.clientY) });
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
  let box: HTMLElement | null = null;

  const rectOf = (ev: PointerEvent) => ({
    left: Math.min(sx, ev.clientX),
    top: Math.min(sy, ev.clientY),
    right: Math.max(sx, ev.clientX),
    bottom: Math.max(sy, ev.clientY),
  });

  const move = (ev: PointerEvent) => {
    if (!box) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      box = document.createElement('div');
      box.className = 'select-box';
      document.body.appendChild(box);
    }
    const r = rectOf(ev);
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!box) {
      if (!additive) setSelection([]);
      return;
    }
    box.remove();
    const r = rectOf(ev);
    const hit = [...board.querySelectorAll<HTMLElement>('[data-card-id]')]
      .filter((el) => {
        const c = el.getBoundingClientRect();
        return c.right > r.left && c.left < r.right && c.bottom > r.top && c.top < r.bottom;
      })
      .map((el) => el.dataset.cardId!);
    const prev = additive ? useStore.getState().selection : [];
    setSelection([...new Set([...prev, ...hit])]);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
