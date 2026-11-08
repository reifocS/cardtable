/**
 * Ordering cards in a row, the same way everywhere (the hand, a pile's viewer, the scry window):
 * where a card dropped at a point would go, the row shown with it already there while it's dragged,
 * and the cards gliding to their new places when the order changes.
 */
import { useLayoutEffect, useRef } from 'react';

/**
 * Where an item dropped at (x, y) goes among the others, from their boxes in order. Rows may wrap:
 * an item on an earlier line, or left of the pointer's middle on its line, comes before.
 */
export function insertionIndex(rects: DOMRect[], x: number, y: number): number {
  let index = 0;
  for (const r of rects) if (r.bottom < y || (r.top <= y && r.left + r.width / 2 < x)) index++;
  return index;
}

/** `list` with `items` taken out and put back together at `index` (the end when negative or past it). */
export function withInserted<T>(list: T[], items: T[], index: number): T[] {
  const rest = list.filter((x) => !items.includes(x));
  const at = index < 0 || index > rest.length ? rest.length : index;
  return [...rest.slice(0, at), ...items, ...rest.slice(at)];
}

/** Slides that slow down into place, without overshooting: cards on a table don't bounce. */
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/** How long a moved card stays out of the row after its last move, before it's put back down. */
const SETTLE_MS = 420;
/** How far it's drawn up out of the row. */
const RAISE_PX = 14;

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface FlipOptions {
  /** Items moved on purpose (the picked card): they're drawn out of the row while they travel. */
  lifted?: string[];
}

/**
 * Animates a row's items to their new places when `order` changes (FLIP: measure, jump back, slide
 * home), like a hand of cards being sorted: the others slide over together, and a card moved on
 * purpose is drawn up out of the row, stays up while it keeps moving (a key pressed again and
 * again), and is put back down once it stops (on CSS's own `translate`, apart from the slide's
 * transform; the rows give it a transition). Gives `ref(key)` for each item's element, and `rect(key)`: where the
 * item sits in the layout without a slide under way (what a drop should be measured against, so it
 * doesn't chase a moving card). An item moved again mid-slide starts from where it is on screen.
 */
export function useFlip(order: string, { lifted = [] }: FlipOptions = {}) {
  const els = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const settle = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Read by the slide below, which runs after this (layout effects run in order) but only on a new order.
  const liftedNow = useRef(lifted);
  useLayoutEffect(() => {
    liftedNow.current = lifted;
  });

  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>();
    const moves: { el: HTMLElement; key: string; dx: number; dy: number }[] = [];
    for (const [key, el] of els.current) {
      if (!el.isConnected) continue;
      // Where it is on screen right now: its old place plus what's left of a slide under way.
      const t = getComputedStyle(el).transform;
      const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
      for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
      const r = el.getBoundingClientRect();
      // The layout box, whether or not the card is drawn up out of the row (or on its way back down).
      const tr = getComputedStyle(el).translate;
      const up = tr && tr !== 'none' ? parseFloat(tr.split(' ')[1] ?? '0') || 0 : 0;
      const rest = new DOMRect(r.left, r.top - up, r.width, r.height);
      now.set(key, rest);
      const was = last.current.get(key);
      if (!was) continue;
      const dx = was.left + (m?.m41 ?? 0) - rest.left;
      const dy = was.top + (m?.m42 ?? 0) - rest.top;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ el, key, dx, dy });
    }
    last.current = now;
    if (!moves.length || still()) return;

    for (const { el, key, dx, dy } of moves) {
      const duration = Math.min(380, 220 + Math.hypot(dx, dy) * 0.25);
      const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration, easing: EASE });
      a.id = 'flip';
      if (!liftedNow.current.includes(key)) continue;
      // Drawn up while it travels; put back down a moment after its last move. Set on its inline style,
      // which the rows never render: a class here would be wiped by the row's next render.
      el.style.translate = `0 ${-RAISE_PX}px`;
      el.style.zIndex = '5';
      clearTimeout(settle.current.get(key));
      settle.current.set(
        key,
        setTimeout(() => {
          el.style.translate = '';
          el.style.zIndex = '';
          settle.current.delete(key);
        }, SETTLE_MS),
      );
    }
  }, [order]);

  useLayoutEffect(
    () => () => {
      for (const t of settle.current.values()) clearTimeout(t);
    },
    [],
  );
  return {
    /** A stable ref callback per key, so React doesn't detach and reattach it on every render. */
    ref(key: string) {
      let ref = refs.current.get(key);
      if (!ref) {
        ref = (el) => {
          if (el) els.current.set(key, el);
          else els.current.delete(key);
        };
        refs.current.set(key, ref);
      }
      return ref;
    },
    rect: (key: string) => last.current.get(key),
  };
}
