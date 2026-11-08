import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '../core/types';
import { CardBack, FaceView } from './CardView';
import { useStore } from './store';

interface GhostProps {
  card: Card;
  /** Pointer, and where on the card it holds it (fractions). */
  x: number;
  y: number;
  fx: number;
  fy: number;
  /** Size, upright, and how far it's turned (a tapped card). */
  w: number;
  h: number;
  turn?: number;
  /** How many cards it stands for, when more than one. */
  count?: number;
  sleeve?: string;
  /** The card held, among a group's ghosts. */
  held?: boolean;
}

/** How quickly the ghost's size catches up with the zone below: about two thirds of the way in this many ms. */
const SIZE_EASE_MS = 70;

/**
 * A size that eases toward (w, h) frame by frame. Retargeted mid-way (the pointer crossing zones
 * quickly), it carries on from where it is: never a jump, never a restart.
 */
function useEasedSize(w: number, h: number) {
  const [size, setSize] = useState({ w, h });
  const now = useRef({ w, h });
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      now.current = { w, h };
      setSize(now.current);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      const k = 1 - Math.exp(-Math.min(64, t - last) / SIZE_EASE_MS);
      last = t;
      const c = now.current;
      const done = Math.abs(w - c.w) < 0.5 && Math.abs(h - c.h) < 0.5;
      now.current = done ? { w, h } : { w: c.w + (w - c.w) * k, h: c.h + (h - c.h) * k };
      setSize(now.current);
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [w, h]);
  return size;
}

/**
 * The card that follows the pointer during a drag. Placed by the size it's growing or shrinking to,
 * so the held point stays under the pointer; a turned card is placed by the box it fills on screen.
 */
export function CardGhost({ card, x, y, fx, fy, w: toW, h: toH, turn = 0, count = 1, sleeve, held }: GhostProps) {
  // It takes the size cards have in the zone below, easing into it; the held point stays under the pointer throughout.
  const { w, h } = useEasedSize(toW, toH);
  const sideways = turn % 180 !== 0;
  const shownW = sideways ? h : w;
  const shownH = sideways ? w : h;
  const left = x - fx * shownW - (w - shownW) / 2;
  const top = y - fy * shownH - (h - shownH) / 2;
  const face = card.faceDown ? undefined : (card.faces[card.face] ?? card.faces[0]);
  return (
    <div className="card ghost" data-ghost-id={card.id} data-held={held ? '' : undefined} style={{ width: w, height: h, transform: `translate(${left}px, ${top}px)${turn ? ` rotate(${turn}deg)` : ''}` }}>
      {/* Its image is picked for the size it's heading to, not each step of the way. */}
      {face ? <FaceView face={face} width={Math.round(toW)} /> : <CardBack sleeve={sleeve} />}
      {count > 1 && <div className="ghost-count">{count}</div>}
    </div>
  );
}

/** How much a card grows as it's picked up, and how quickly (ms). */
const LIFT = 0.04;
const LIFT_MS = 140;
/** How far it leans with the pointer's speed (degrees per px/ms), and at most. */
const LEAN = 2.2;
const MAX_LEAN = 6;
/** How quickly the speed it leans by follows the pointer's, and the lean follows that (ms). */
const SPEED_MS = 50;
const LEAN_MS = 90;

/**
 * Held in the hand: what's dragged grows a little as it's picked up, and leans with the pointer, the
 * way a card held by a corner swings as it's carried, coming back upright as it slows. Turned about the
 * pointer, so the held point stays under it; a group leans together. Drawn frame by frame from where
 * the pointer is, never by React (which only places the cards inside).
 */
export function GhostLift({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef({ x, y });
  useLayoutEffect(() => {
    at.current = { x, y };
  }, [x, y]);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    let last = t0;
    let px = at.current.x;
    let speed = 0;
    let lean = 0;
    let raf = 0;
    const step = (t: number) => {
      const dt = Math.max(1, Math.min(64, t - last));
      last = t;
      const { x, y } = at.current;
      speed += ((x - px) / dt - speed) * (1 - Math.exp(-dt / SPEED_MS));
      px = x;
      const toward = Math.max(-MAX_LEAN, Math.min(MAX_LEAN, speed * LEAN));
      lean += (toward - lean) * (1 - Math.exp(-dt / LEAN_MS));
      const lifted = 1 + LIFT * (1 - (1 - Math.min(1, (t - t0) / LIFT_MS)) ** 3);
      el.style.transformOrigin = `${x}px ${y}px`;
      el.style.transform = `rotate(${lean.toFixed(2)}deg) scale(${lifted.toFixed(4)})`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="ghost-lift" ref={ref}>
      {children}
    </div>
  );
}

/** The ghost of a drag across the table, and the page's dragging state (cursor, cards letting the pointer through). */
export function TableDragGhost() {
  const drag = useStore((s) => s.drag);
  const cards = useStore((s) => s.state?.cards);
  const players = useStore((s) => s.state?.players);
  const on = !!drag;
  useEffect(() => {
    document.body.classList.toggle('dragging', on);
    return () => document.body.classList.remove('dragging');
  }, [on]);
  const card = drag && cards?.[drag.ids[0]];
  if (!drag || !card) return null;
  const sleeve = (id: string) => players?.[cards[id]?.owner]?.sleeve;
  const held = <CardGhost key={card.id} held card={card} x={drag.x} y={drag.y} fx={drag.fx} fy={drag.fy} w={drag.w} h={drag.h} turn={drag.turn} sleeve={sleeve(card.id)} />;
  // Always in the same lift, keyed: the held card's ghost stays the same element (easing its size) as the group comes and goes.
  if (!drag.laid)
    return (
      <GhostLift x={drag.x} y={drag.y}>
        <CardGhost key={card.id} {...held.props} count={drag.ids.length} />
      </GhostLift>
    );
  // The group as it lay, each card around the held one's middle, the held one among them.
  const sideways = drag.turn % 180 !== 0;
  const cx = drag.x + (0.5 - drag.fx) * (sideways ? drag.h : drag.w);
  const cy = drag.y + (0.5 - drag.fy) * (sideways ? drag.w : drag.h);
  // Cards picked up elsewhere (a hand) are still counted on it.
  const rest = drag.ids.filter((id) => !drag.laid!.some((m) => m.id === id)).length;
  return (
    <GhostLift x={drag.x} y={drag.y}>
      {drag.laid.map((m) => {
        if (m.id === card.id) return rest ? <CardGhost key={m.id} {...held.props} count={rest + 1} /> : held;
        const c = cards[m.id];
        return (
          c && <CardGhost key={m.id} card={c} x={cx + m.dx * drag.h} y={cy + m.dy * drag.h} fx={0.5} fy={0.5} w={drag.w} h={drag.h} turn={m.turn} sleeve={sleeve(m.id)} />
        );
      })}
    </GhostLift>
  );
}
