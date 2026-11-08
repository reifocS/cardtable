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
 * A spring's settling, as a CSS easing: quick off the mark, a touch past the mark (about 4%), then
 * home. Sampled from a damped oscillator; browsers without `linear()` get an overshooting curve.
 */
const SPRING = (() => {
  const zeta = 0.72;
  const wd = Math.sqrt(1 - zeta * zeta);
  const end = 6.5;
  const at = (t: number) => 1 - Math.exp(-zeta * t) * (Math.cos(wd * t) + (zeta / wd) * Math.sin(wd * t));
  const points = Array.from({ length: 41 }, (_, i) => +at((i / 40) * end).toFixed(4));
  points[40] = 1;
  const css = `linear(${points.join(', ')})`;
  return typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', css) ? css : 'cubic-bezier(0.22, 1.25, 0.36, 1)';
})();

const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface FlipOptions {
  /** Items moved on purpose (the picked card): they rise over their neighbours on the way. */
  lifted?: string[];
}

/**
 * Animates a row's items to their new places when `order` changes (FLIP: measure, jump back, spring
 * home). Longer trips take a little longer, the items set off in a wave from the one that was moved,
 * and a lifted item arcs over the others. Gives `ref(key)` for each item's element, and `rect(key)`:
 * where the item sits in the layout without a glide under way (what a drop should be measured
 * against, so it doesn't chase a moving card). An item moved again mid-glide starts from where it
 * is on screen.
 */
export function useFlip(order: string, { lifted = [] }: FlipOptions = {}) {
  const els = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, DOMRect>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  // Read by the glide below, which runs after this (layout effects run in order) but only on a new order.
  const liftedNow = useRef(lifted);
  useLayoutEffect(() => {
    liftedNow.current = lifted;
  });

  useLayoutEffect(() => {
    const now = new Map<string, DOMRect>();
    const moves: { el: HTMLElement; key: string; dx: number; dy: number; r: DOMRect }[] = [];
    for (const [key, el] of els.current) {
      if (!el.isConnected) continue;
      // Where it is on screen right now: its old place plus what's left of a glide under way.
      const t = getComputedStyle(el).transform;
      const m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null;
      for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
      const r = el.getBoundingClientRect();
      now.set(key, r);
      const was = last.current.get(key);
      if (!was) continue;
      const dx = was.left + (m?.m41 ?? 0) - r.left;
      const dy = was.top + (m?.m42 ?? 0) - r.top;
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ el, key, dx, dy, r });
    }
    last.current = now;
    if (!moves.length || still()) return;

    // The wave starts at the moved card (or the row's start) and spreads out from it.
    const origin = moves.find((mv) => liftedNow.current.includes(mv.key))?.r ?? moves[0].r;
    const away = (r: DOMRect) => Math.hypot(r.left - origin.left, r.top - origin.top);
    moves.sort((a, b) => away(a.r) - away(b.r));
    moves.forEach(({ el, key, dx, dy }, i) => {
      const dist = Math.hypot(dx, dy);
      const duration = Math.min(520, 300 + dist * 0.35);
      const delay = Math.min(i * 16, 110);
      const lift = liftedNow.current.includes(key);
      // A lifted card rises and grows a little mid-way, over its neighbours.
      const frames: Keyframe[] = lift
        ? [
            { transform: `translate(${dx}px, ${dy}px) scale(1)` },
            { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - Math.min(14, 6 + dist * 0.05)}px) scale(1.06)`, offset: 0.4 },
            { transform: 'translate(0, 0) scale(1)' },
          ]
        : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }];
      if (lift) el.style.zIndex = '5';
      const a = el.animate(frames, { duration, delay: lift ? 0 : delay, easing: SPRING, fill: 'backwards' });
      a.id = 'flip';
      const done = () => {
        if (lift) el.style.zIndex = '';
      };
      a.onfinish = done;
      a.oncancel = done;
    });
  }, [order]);

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
