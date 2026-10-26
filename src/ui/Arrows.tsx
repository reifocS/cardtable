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

/** How often a bolt is struck anew, in ms: it crackles at about ten new shapes a second. */
const STRIKE_MS = 90;

/** A small seeded random generator, so a bolt keeps its shape until its next strike. */
function random(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A jagged line between two points: each segment's midpoint pushed sideways, halving the push each time. */
function jag(x1: number, y1: number, x2: number, y2: number, rand: () => number, depth = 6) {
  let pts = [
    [x1, y1],
    [x2, y2],
  ];
  let push = Math.hypot(x2 - x1, y2 - y1) * 0.1;
  for (let i = 0; i < depth; i++) {
    const next = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1];
      const [bx, by] = pts[k];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (rand() * 2 - 1) * push;
      next.push([(ax + bx) / 2 - ((by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], pts[k]);
    }
    pts = next;
    push /= 1.75;
  }
  return pts;
}

/**
 * A lightning bolt from one end to the other, struck anew every STRIKE_MS (only once when the system asks
 * for less motion), now and then with a fork off its middle.
 */
function bolt({ x1, y1, x2, y2 }: Line, seed: number) {
  const rand = random(seed);
  const main = jag(x1, y1, x2, y2, rand);
  const toPath = (pts: number[][]) => `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`;
  let d = toPath(main);
  if (rand() < 0.6) {
    const [fx, fy] = main[Math.floor(main.length * (0.3 + rand() * 0.4))];
    const len = Math.hypot(x2 - x1, y2 - y1) * (0.15 + rand() * 0.15);
    const angle = Math.atan2(y2 - y1, x2 - x1) + (rand() < 0.5 ? -1 : 1) * (0.4 + rand() * 0.5);
    d += ' ' + toPath(jag(fx, fy, fx + Math.cos(angle) * len, fy + Math.sin(angle) * len, rand, 4));
  }
  return d;
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
        const d = bolt(l, l.seed);
        const drawn = (
          <>
            {/* A blue glow, a pale core, a white-hot filament; a flash where it strikes. */}
            <circle className="bolt-flash" cx={l.x2} cy={l.y2} r={11} />
            <path className="bolt-glow" d={d} />
            <path className="bolt-core" d={d} />
            <path className="bolt-filament" d={d} />
            <circle className="bolt-spark" cx={l.x2} cy={l.y2} r={3} />
          </>
        );
        if (!from || !to) return <g key={keyOf(l)}>{drawn}</g>;
        return (
          <g key={keyOf(l)} className="arrow" onClick={() => act({ type: 'removeArrow', from, to })}>
            <title>Click to remove</title>
            {/* A wide invisible stroke makes the thin bolt easy to click. */}
            <path d={d} stroke="transparent" strokeWidth={16} fill="none" />
            {drawn}
          </g>
        );
      })}
    </svg>
  );
}
