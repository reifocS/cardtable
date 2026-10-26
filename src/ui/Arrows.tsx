import { useEffect, useState } from 'react';
import type { GameState } from '../core/types';
import { act, useStore } from './store';

/** `from`/`to` are set for real arrows; the line being drawn while targeting has neither. */
type Line = { x1: number; y1: number; x2: number; y2: number; color: string; seed: number; from?: string; to?: string };

/** Center of a card or player on screen, preferring the zoomed board when it's open (it covers the table). */
function center(id: string): { x: number; y: number } | null {
  const sel = `[data-card-id="${id}"], [data-player-id="${id}"]`;
  const el = document.querySelector(`.board-focus ${sel.replace(', ', ', .board-focus ')}`) ?? document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** How often the crackling filaments take a new shape, in ms: fast enough to flicker like an arc. */
const STRIKE_MS = 45;

/** A small seeded random generator, so a filament keeps its shape until its next strike. */
function random(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crackling filament along the straight line: a kink every few pixels, each pushed a little either
 * side at random. Only fine, sharp kinks, no long waves: an electric arc, not a shaken wire.
 */
function filament({ x1, y1, x2, y2 }: Line, seed: number, spread: number) {
  const rand = random(seed);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const steps = Math.max(2, Math.round(len / 9));
  const pts = [`${x1},${y1}`];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    // Tighter near the ends, where it's anchored.
    const off = (rand() * 2 - 1) * spread * Math.min(1, t * 6, (1 - t) * 6);
    pts.push(`${(x1 + (x2 - x1) * t + nx * off).toFixed(1)},${(y1 + (y2 - y1) * t + ny * off).toFixed(1)}`);
  }
  pts.push(`${x2},${y2}`);
  return `M${pts.join(' L')}`;
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
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const tick = () => {
      // Every bolt is struck anew together, a few times a second; held still for less motion.
      const strike = still.matches ? 1 : Math.floor(performance.now() / STRIKE_MS);
      const next: Line[] = [];
      for (const [i, a] of arrows.entries()) {
        const p = center(a.from);
        const q = center(a.to);
        if (p && q) next.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, color: state.players[a.by]?.color ?? '#fff', seed: strike * 31 + i, from: a.from, to: a.to });
      }
      const src = targeting && center(targeting);
      if (src && mouse.x) next.push({ x1: src.x, y1: src.y, x2: mouse.x, y2: mouse.y, color: (me && state.players[me]?.color) || '#fff', seed: strike * 31 + 30 });
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
        const { from, to } = l;
        const beam = `M${l.x1},${l.y1} L${l.x2},${l.y2}`;
        const drawn = (
          <>
            {/* A steady blue beam with pulses of energy flowing down it, two filaments crackling round it,
                and a flash where it strikes. */}
            <circle className="bolt-flash" cx={l.x2} cy={l.y2} r={10} />
            <path className="bolt-glow" d={beam} />
            <path className="bolt-flow" d={beam} />
            <path className="bolt-strand" d={filament(l, l.seed, 4)} />
            <path className="bolt-strand faint" d={filament(l, l.seed + 17, 6)} />
            <circle className="bolt-spark" cx={l.x2} cy={l.y2} r={2.5} />
          </>
        );
        if (!from || !to) return <g key={keyOf(l)}>{drawn}</g>;
        return (
          <g key={keyOf(l)} className="arrow" onClick={() => act({ type: 'removeArrow', from, to })}>
            <title>Click to remove</title>
            {/* A wide, still, straight band to click: the bolt itself is thin and keeps moving. */}
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={20} strokeLinecap="round" />
            {drawn}
          </g>
        );
      })}
    </svg>
  );
}
