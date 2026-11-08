import { useEffect, useRef, useState } from 'react';
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
export function CardGhost({ card, x, y, fx, fy, w: toW, h: toH, turn = 0, count = 1, sleeve }: GhostProps) {
  // It takes the size cards have in the zone below, easing into it; the held point stays under the pointer throughout.
  const { w, h } = useEasedSize(toW, toH);
  const sideways = turn % 180 !== 0;
  const shownW = sideways ? h : w;
  const shownH = sideways ? w : h;
  const left = x - fx * shownW - (w - shownW) / 2;
  const top = y - fy * shownH - (h - shownH) / 2;
  const face = card.faceDown ? undefined : (card.faces[card.face] ?? card.faces[0]);
  return (
    <div className="card ghost" style={{ width: w, height: h, transform: `translate(${left}px, ${top}px)${turn ? ` rotate(${turn}deg)` : ''}` }}>
      {/* Its image is picked for the size it's heading to, not each step of the way. */}
      {face ? <FaceView face={face} width={Math.round(toW)} /> : <CardBack sleeve={sleeve} />}
      {count > 1 && <div className="ghost-count">{count}</div>}
    </div>
  );
}

/** The ghost of a drag across the table, and the page's dragging state (cursor, cards letting the pointer through). */
export function TableDragGhost() {
  const drag = useStore((s) => s.drag);
  const card = useStore((s) => (s.drag ? s.state?.cards[s.drag.ids[0]] : undefined));
  const sleeve = useStore((s) => (card ? s.state?.players[card.owner]?.sleeve : undefined));
  const on = !!drag;
  useEffect(() => {
    document.body.classList.toggle('dragging', on);
    return () => document.body.classList.remove('dragging');
  }, [on]);
  if (!drag || !card) return null;
  return <CardGhost card={card} x={drag.x} y={drag.y} fx={drag.fx} fy={drag.fy} w={drag.w} h={drag.h} turn={drag.turn} count={drag.ids.length} sleeve={sleeve} />;
}
