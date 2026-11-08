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

/**
 * Animates a row's items to their new places when `order` changes (FLIP: measure, jump back, ease
 * in). Gives `ref(key)` for each item's element, and `rect(key)`: where the item sits in the layout,
 * without a glide under way (what a drop should be measured against, so it doesn't chase a moving
 * card). An item new to the row just appears; one moved again mid-glide starts from where it is.
 */
export function useFlip(order: string, ms = 170) {
  const els = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());

  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>();
    for (const [key, el] of els.current) {
      if (!el.isConnected) continue;
      // Where it is on screen right now: its old place plus what's left of a glide under way.
      const t = getComputedStyle(el).transform;
      const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
      el.style.transition = 'none';
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      now.set(key, r);
      const was = last.current.get(key);
      if (!was) continue;
      const dx = was.left + (m?.m41 ?? 0) - r.left;
      const dy = was.top + (m?.m42 ?? 0) - r.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform ${ms}ms ease-out`;
        el.style.transform = '';
      });
    }
    last.current = now;
  }, [order, ms]);

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
