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

/**
 * A ballistic shot from one end to the other: the arc of something lobbed, rising above the straight
 * line by a fifth of its length (at most 120px), whichever way it travels. Ends just short of the target.
 */
function arc({ x1, y1, x2, y2 }: Line) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const rise = Math.min(len * 0.2, 120);
  const cx = (x1 + x2) / 2;
  const cy = Math.min(y1, y2) - rise;
  const d = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  return { d, x2, y2 };
}

/** An impact marker at (x, y): a ring, crossed by four arms that stop short of the middle. */
function crosshair(x: number, y: number) {
  const r = 9;
  const ring = `M${x - r},${y} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0`;
  const arms = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]
    .map(([dx, dy]) => `M${x + dx * 4.5},${y + dy * 4.5} L${x + dx * 15},${y + dy * 15}`)
    .join(' ');
  return `${ring} ${arms}`;
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
        const { d } = arc(l);
        const drawn = (
          <>
            {/* Red dashes marching along the arc; where it lands, a red crosshair round its owner's colour. */}
            <path className="shot-edge" d={d} />
            <path className="shot" d={d} />
            <path className="shot-impact-edge" d={crosshair(l.x2, l.y2)} />
            <path className="shot-impact" d={crosshair(l.x2, l.y2)} />
            <circle className="shot-core" cx={l.x2} cy={l.y2} r={2.5} fill={color} />
          </>
        );
        if (!from || !to) return <g key={keyOf(l)}>{drawn}</g>;
        return (
          <g key={keyOf(l)} className="arrow" onClick={() => act({ type: 'removeArrow', from, to })}>
            <title>Click to remove</title>
            {/* A wide invisible stroke makes the dotted line easy to click. */}
            <path d={d} stroke="transparent" strokeWidth={16} fill="none" />
            {drawn}
          </g>
        );
      })}
    </svg>
  );
}
