import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState, Zone } from '../core/types';
import { draw, openMenu, openViewer, zoneMenu } from './actions';
import { CardBack, CardView, FaceView } from './CardView';
import { onBoardPointerDown } from './drag';
import { VIEW_H, fitBoard, mirrorY, viewX, viewY } from './fit';
import { useStore } from './store';

/**
 * A battlefield. Cards are sized from the height it's given; horizontal positions are proportional
 * (see fit.ts), so every screen shows every card at full size, closer together when narrow.
 * `flipped` mirrors it top to bottom, for an opponent sitting across the table.
 */
export function Board({ zone, state, flipped, children }: { zone: Zone; state: GameState; flipped?: boolean; children?: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { scale, width, top } = fitBoard(size.w, size.h);

  return (
    <div className="board-wrap" ref={wrap}>
      <div
        className="board"
        data-drop-zone={zone.id}
        data-flipped={flipped ? '1' : undefined}
        style={{ width, height: VIEW_H, left: 0, top, transform: `scale(${scale})` }}
        onPointerDown={onBoardPointerDown}
        onContextMenu={(e) => e.target === e.currentTarget && openMenu(e, zoneMenu(zone))}
      >
        {zone.cards.map((id) => {
          const c = state.cards[id];
          return c && <CardView key={id} card={c} zone={zone} style={{ left: viewX(c.x, width), top: viewY(flipped ? mirrorY(c.y) : c.y) }} />;
        })}
        {children}
      </div>
    </div>
  );
}

/** A stack: shows its top card and a count. Click opens it (or draws, for your library). */
export function Pile({ zone, state, small }: { zone: Zone; state: GameState; small?: boolean }) {
  const me = useStore((s) => s.me);
  const top = zone.cards[0] ? state.cards[zone.cards[0]] : undefined;
  const isMyLibrary = zone.role === 'library' && zone.owner === me;
  const onClick = () => (isMyLibrary ? draw() : openViewer(zone));

  return (
    <div className={`pile${small ? ' small' : ''}`} title={isMyLibrary ? 'Click to draw · right-click for more' : 'Click to view'}>
      <div
        className="pile-slot"
        data-drop-zone={zone.id}
        onClick={onClick}
        onContextMenu={(e) => openMenu(e, zoneMenu(zone))}
      >
        {top ? (
          <CardView card={top} zone={zone} pileTop />
        ) : (
          <div className="pile-empty" />
        )}
        <span className="pile-count">{zone.cards.length}</span>
      </div>
      <div className="pile-label">{zone.name}</div>
    </div>
  );
}

/**
 * A hand: cards spread in a row. Each card sits in a slot that shrinks when the row is crowded,
 * so cards overlap more instead of scrolling (a scroll box would also clip lifted cards).
 */
export function Hand({ zone, state, compact }: { zone: Zone; state: GameState; compact?: boolean }) {
  return (
    <div
      className={`hand${compact ? ' compact' : ''}`}
      data-drop-zone={zone.id}
      onContextMenu={(e) => e.target === e.currentTarget && openMenu(e, zoneMenu(zone))}
    >
      {zone.cards.map((id) => {
        const c = state.cards[id];
        return (
          c && (
            <div key={id} className="hand-slot">
              <CardView card={c} zone={zone} />
            </div>
          )
        );
      })}
      {!compact && zone.cards.length === 0 && <div className="hand-empty">Hand</div>}
    </div>
  );
}

/** Small static card picture, for previews and pickers. */
export function CardImage({ faces, faceDown }: { faces: { name: string; image?: string; text?: string }[]; faceDown?: boolean }) {
  return <div className="card static">{faces[0] && !faceDown ? <FaceView face={faces[0]} /> : <CardBack />}</div>;
}
