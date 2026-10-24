import { useEffect, useState } from 'react';
import type { GameState } from '../core/types';
import { act, useStore } from './store';

/** `from`/`to` are set for real arrows; the line being drawn while targeting has neither. */
type Line = { x1: number; y1: number; x2: number; y2: number; color: string; from?: string; to?: string };

function center(id: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-card-id="${id}"]`) ?? document.querySelector(`[data-player-id="${id}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Draws target arrows over the whole table, tracking the elements they point at. */
export function Arrows({ state }: { state: GameState }) {
  const targeting = useStore((s) => s.targeting);
  const me = useStore((s) => s.me);
  const [lines, setLines] = useState<Line[]>([]);
  const active = state.arrows.length > 0 || !!targeting;

  useEffect(() => {
    if (!active) {
      setLines([]);
      return;
    }
    let mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => (mouse = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', onMove);
    let raf = 0;
    const tick = () => {
      const next: Line[] = [];
      for (const a of state.arrows) {
        const p = center(a.from);
        const q = center(a.to);
        if (p && q) next.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: state.players[a.by]?.color ?? '#fff', from: a.from, to: a.to });
      }
      const src = targeting && center(targeting);
      if (src && mouse.x) next.push({ x1: src.x, y1: src.y, x2: mouse.x, y2: mouse.y, color: (me && state.players[me]?.color) || '#fff' });
      setLines(next);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, [active, state, targeting, me]);

  if (!lines.length) return null;
  return (
    <svg className="arrows">
      <defs>
        {lines.map((l, i) => (
          <marker key={i} id={`head-${i}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill={l.color} />
          </marker>
        ))}
      </defs>
      {lines.map((l, i) => {
        const { from, to, color, ...pos } = l;
        const line = <line {...pos} stroke={color} strokeWidth={4} strokeLinecap="round" markerEnd={`url(#head-${i})`} opacity={0.9} />;
        if (!from || !to) return <g key={i}>{line}</g>;
        return (
          <g key={i} className="arrow" onClick={() => act({ type: 'removeArrow', from, to })}>
            <title>Click to remove</title>
            {/* A wide invisible stroke makes the thin arrow easy to click. */}
            <line {...pos} stroke="transparent" strokeWidth={18} strokeLinecap="round" />
            {line}
          </g>
        );
      })}
    </svg>
  );
}
