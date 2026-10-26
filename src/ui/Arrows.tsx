import { useEffect, useState } from 'react';
import type { GameState } from '../core/types';
import { act, useStore } from './store';

/** `from`/`to` are set for real arrows; the line being drawn while targeting has neither. */
type Line = { x1: number; y1: number; x2: number; y2: number; color: string; from?: string; to?: string };

/** Center of a card or player on screen, preferring the zoomed board when it's open (it covers the table). */
function center(id: string): { x: number; y: number } | null {
  const sel = `[data-card-id="${id}"], [data-player-id="${id}"]`;
  const el = document.querySelector(`.board-focus ${sel.replace(', ', ', .board-focus ')}`) ?? document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Sizes in pixels: the broadhead's length and half-width, the fletching's length and spread. */
const HEAD = 18;
const HEAD_W = 6;
const FLETCH = 22;
const FLETCH_W = 5;

/**
 * An archer's arrow, straight from one end to the other: a leaf-shaped steel broadhead with two barbs at
 * the target, a shaft, and fletching at the start (two vanes, and the cock feather down the middle).
 */
function arc({ x1, y1, x2, y2 }: Line) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  // A point `along` the arrow from (x, y) and `side` to its left.
  const at = (x: number, y: number, along: number, side: number) => `${x + ux * along - uy * side},${y + uy * along + ux * side}`;
  const d = `M${at(x1, y1, 2, 0)} L${at(x2, y2, -HEAD + 4, 0)}`;
  // Tip, the widest point, the barbs swept back past the base, and a notch where the shaft goes in.
  const head = [
    `M${x2},${y2}`,
    `Q${at(x2, y2, -HEAD * 0.45, HEAD_W * 1.1)} ${at(x2, y2, -HEAD * 0.82, HEAD_W)}`,
    `L${at(x2, y2, -HEAD, HEAD_W * 0.95)}`,
    `L${at(x2, y2, -HEAD * 0.72, 1.5)}`,
    `L${at(x2, y2, -HEAD * 0.72, -1.5)}`,
    `L${at(x2, y2, -HEAD, -HEAD_W * 0.95)}`,
    `L${at(x2, y2, -HEAD * 0.82, -HEAD_W)}`,
    `Q${at(x2, y2, -HEAD * 0.45, -HEAD_W * 1.1)} ${x2},${y2}`,
    'Z',
  ].join(' ');
  // Each vane, as on a real arrow: a long slope up from the shaft, a flat back, then a short drop to it.
  const vane = (side: number) =>
    `M${at(x1, y1, 4 + FLETCH, 0)} Q${at(x1, y1, 4 + FLETCH * 0.75, side * FLETCH_W * 0.6)} ${at(x1, y1, 4 + FLETCH * 0.45, side * FLETCH_W)} L${at(x1, y1, 4 + FLETCH * 0.1, side * FLETCH_W)} L${at(x1, y1, 4, side * 1)} Z`;
  const fletching = vane(1) + vane(-1);
  // The nock: a small notch past the fletching.
  const nock = `M${at(x1, y1, 0, 2.5)} L${at(x1, y1, 3.5, 0)} L${at(x1, y1, 0, -2.5)}`;
  return { d, head, fletching, nock };
}

/** Draws target arrows over the whole table, tracking the elements they point at. */
export function Arrows({ state }: { state: GameState }) {
  const targeting = useStore((s) => s.targeting);
  const me = useStore((s) => s.me);
  // The zoomed board covers the table, where arrows would point at hidden cards.
  const focus = useStore((s) => s.focus);
  const [lines, setLines] = useState<Line[]>([]);
  const active = (!focus && state.arrows.length > 0) || !!targeting;

  // Follows the elements every frame: cards move, boards resize and scroll.
  useEffect(() => {
    if (!active) return;
    const arrows = focus ? [] : state.arrows;
    let mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => (mouse = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onMove);
    let raf = 0;
    const tick = () => {
      const next: Line[] = [];
      for (const a of arrows) {
        const p = center(a.from);
        const q = center(a.to);
        if (p && q) next.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: state.players[a.by]?.color ?? '#fff', from: a.from, to: a.to });
      }
      const src = targeting && center(targeting);
      if (src && mouse.x) next.push({ x1: src.x, y1: src.y, x2: mouse.x, y2: mouse.y, color: (me && state.players[me]?.color) || '#fff' });
      setLines(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [active, state, targeting, me, focus]);

  if (!active || !lines.length) return null;
  // The line being drawn has no ends yet; real arrows are unique by their ends.
  const keyOf = (l: Line) => (l.from && l.to ? `${l.from}>${l.to}` : 'drawing');
  return (
    <svg className="arrows">
      {lines.map((l) => {
        const { from, to, color } = l;
        const { d, head, fletching, nock } = arc(l);
        const drawn = (
          <>
            {/* A dark wooden shaft, a steel broadhead, and fletching in its owner's colour. */}
            <path className="arrow-edge" d={d} />
            <path className="arrow-shaft" d={d} />
            <path className="arrow-fletching" d={fletching} fill={color} />
            <path className="arrow-nock" d={nock} />
            <path className="arrow-head" d={head} />
          </>
        );
        if (!from || !to) return <g key={keyOf(l)}>{drawn}</g>;
        return (
          <g key={keyOf(l)} className="arrow" onClick={() => act({ type: 'removeArrow', from, to })}>
            <title>Click to remove</title>
            {/* A wide invisible stroke makes the thin arrow easy to click. */}
            <path d={d} stroke="transparent" strokeWidth={18} fill="none" />
            {drawn}
          </g>
        );
      })}
    </svg>
  );
}
