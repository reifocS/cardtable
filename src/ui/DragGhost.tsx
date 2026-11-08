import { useEffect } from 'react';
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

/**
 * The card that follows the pointer during a drag. Placed by the size it's growing or shrinking to,
 * so the held point stays under the pointer; a turned card is placed by the box it fills on screen.
 */
export function CardGhost({ card, x, y, fx, fy, w, h, turn = 0, count = 1, sleeve }: GhostProps) {
  const sideways = turn % 180 !== 0;
  const shownW = sideways ? h : w;
  const shownH = sideways ? w : h;
  const left = x - fx * shownW - (w - shownW) / 2;
  const top = y - fy * shownH - (h - shownH) / 2;
  const face = card.faceDown ? undefined : (card.faces[card.face] ?? card.faces[0]);
  return (
    <div className="card ghost" style={{ width: w, height: h, transform: `translate(${left}px, ${top}px)${turn ? ` rotate(${turn}deg)` : ''}` }}>
      {face ? <FaceView face={face} width={w} /> : <CardBack sleeve={sleeve} />}
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
