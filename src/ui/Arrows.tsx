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

/** Head length and half-width, in pixels. */
const HEAD = 10;
const HEAD_W = 5;

/** A straight line from one end to the other, stopping at the base of its arrowhead. */
function arc({ x1, y1, x2, y2 }: Line) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * HEAD;
  const by = y2 - uy * HEAD;
  const d = `M${x1},${y1} L${bx},${by}`;
  const head = `M${x2},${y2} L${bx - uy * HEAD_W},${by + ux * HEAD_W} L${bx + ux * 2},${by + uy * 2} L${bx + uy * HEAD_W},${by - ux * HEAD_W} Z`;
  return { d, head };
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
        const { d, head } = arc(l);
        const drawn = (
          <>
            {/* A dark edge under the colour, so the arrow reads on any card or playmat. */}
            <path className="arrow-edge" d={d} />
            <path className="arrow-line" d={d} stroke={color} />
            <circle className="arrow-edge" cx={l.x1} cy={l.y1} r={3.5} />
            <circle cx={l.x1} cy={l.y1} r={2.5} fill={color} />
            <path className="arrow-head" d={head} fill={color} />
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
