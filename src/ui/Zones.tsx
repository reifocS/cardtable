import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CARD_H, CARD_W } from '../core/state';
import type { GameState, Zone } from '../core/types';
import { draw, openMenu, openViewer, zoneMenu } from './actions';
import { CardBack, CardView, FaceView } from './CardView';
import { onBoardPointerDown } from './drag';
import { VIEW_H, fitBoard, mirrorY, viewX, viewY } from './fit';
import { useStore } from './store';
import { tip } from './tip';

/** Size of an element, kept up to date. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Logical width each battlefield was last laid out at on this screen. The zoomed view reuses it,
 * so cards keep exactly the same arrangement instead of re-spreading over a different width.
 */
const laidOutWidth = new Map<string, number>();

interface SurfaceProps {
  zone: Zone;
  state: GameState;
  flipped?: boolean;
  /** Logical width the cards are spread over. */
  width: number;
  scale: number;
  top?: number;
  children?: React.ReactNode;
}

/** The cards of a battlefield, in logical units, scaled into place. */
function Surface({ zone, state, flipped, width, scale, top = 0, children }: SurfaceProps) {
  return (
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
      <BoardPings zone={zone} state={state} flipped={flipped} width={width} />
      {children}
    </div>
  );
}

/** Pings on empty spots of this battlefield. */
function BoardPings({ zone, state, flipped, width }: { zone: Zone; state: GameState; flipped?: boolean; width: number }) {
  const pings = useStore((s) => s.pings);
  return (
    <>
      {pings
        .filter((p) => p.zone === zone.id && p.x !== undefined && p.y !== undefined)
        .map((p) => (
          <span
            key={p.id}
            className="board-ping"
            style={
              {
                left: viewX(p.x!, width) + CARD_W / 2,
                top: viewY(flipped ? mirrorY(p.y!) : p.y!) + CARD_H / 2,
                '--c': state.players[p.by]?.color,
              } as React.CSSProperties
            }
          />
        ))}
    </>
  );
}

/**
 * A battlefield. Cards are sized from the height it's given; horizontal positions are proportional
 * (see fit.ts), so every screen shows every card at full size, closer together when narrow.
 * `flipped` mirrors it top to bottom, for an opponent sitting across the table.
 */
export function Board({ zone, state, flipped, children }: { zone: Zone; state: GameState; flipped?: boolean; children?: React.ReactNode }) {
  const [wrap, size] = useSize<HTMLDivElement>();
  const { scale, width, top } = fitBoard(size.w, size.h);
  if (size.w) laidOutWidth.set(zone.id, width);
  return (
    <div className="board-wrap" ref={wrap}>
      <Surface zone={zone} state={state} flipped={flipped} width={width} scale={scale} top={top}>
        {children}
      </Surface>
    </div>
  );
}

/** Largest zoom, as a multiple of whatever fits. */
const ZOOM_RANGE = 4;
/** Room around the cards when fitting to them, in board units. */
const FIT_MARGIN = 20;

type Box = { x: number; y: number; w: number; h: number };

/** The area the cards cover on a board laid out `width` units wide (the whole board if empty). */
function cardsBox(zone: Zone, state: GameState, width: number, flipped?: boolean): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of zone.cards) {
    const c = state.cards[id];
    if (!c) continue;
    const x = viewX(c.x, width);
    const y = viewY(flipped ? mirrorY(c.y) : c.y);
    // A tapped card is turned a quarter: wider than it is tall.
    const pad = c.rotation % 180 ? (CARD_H - CARD_W) / 2 : 0;
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + CARD_W + pad);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + CARD_H);
  }
  if (minX === Infinity) return { x: 0, y: 0, w: width, h: VIEW_H };
  const x = Math.max(0, minX - FIT_MARGIN);
  const y = Math.max(0, minY - FIT_MARGIN);
  return { x, y, w: Math.min(width, maxX + FIT_MARGIN) - x, h: Math.min(VIEW_H, maxY + FIT_MARGIN) - y };
}

/**
 * A battlefield blown up: the same arrangement as on the table. Opens zoomed onto its cards, so
 * they fill the view; "Board" shows the whole board. Zoom with pinch, Ctrl/⌘ + wheel or the
 * buttons, and scroll once zoomed in.
 */
export function ZoomBoard({ zone, state, flipped }: { zone: Zone; state: GameState; flipped?: boolean }) {
  const [wrap, size] = useSize<HTMLDivElement>();
  // Pixels per board unit; null until measured, then it starts fitted to the cards.
  const [chosen, setChosen] = useState<number | null>(null);
  // Scroll position to apply after the next render (a fit, or keeping a point under the cursor).
  const pending = useRef<{ left: number; top: number } | null>(null);
  const [renders, setRenders] = useState(0);

  const width = laidOutWidth.get(zone.id) ?? 1000;
  const box = cardsBox(zone, state, width, flipped);
  const measured = size.w > 0 && size.h > 0;
  const fitBoardScale = measured ? Math.min(size.w / width, size.h / VIEW_H) : 1;
  const fitCardsScale = measured ? Math.min(size.w / box.w, size.h / box.h) : 1;
  const minScale = Math.min(fitBoardScale, fitCardsScale);
  const maxScale = Math.max(fitBoardScale, fitCardsScale) * ZOOM_RANGE;
  const scale = chosen ?? fitCardsScale;

  /** Zoom so `target` fills the view, centered on it. */
  const fitTo = (target: Box) => {
    const s = Math.min(size.w / target.w, size.h / target.h);
    // While the board is smaller than the view in a direction, it's centered and doesn't scroll.
    pending.current = {
      left: target.x * s - Math.max(0, (size.w - target.w * s) / 2),
      top: target.y * s - Math.max(0, (size.h - target.h * s) / 2),
    };
    setChosen(s);
    setRenders((n) => n + 1);
  };

  const zoomTo = (next: number, px = size.w / 2, py = size.h / 2) => {
    const el = wrap.current;
    if (!el) return;
    const s = Math.min(maxScale, Math.max(minScale, next));
    // Keep the point under the cursor where it is.
    const x = (el.scrollLeft + px) / scale;
    const y = (el.scrollTop + py) / scale;
    pending.current = { left: x * s - px, top: y * s - py };
    setChosen(s);
    setRenders((n) => n + 1);
  };

  // Once the area is measured, open fitted to the cards (later card moves don't refit).
  useLayoutEffect(() => {
    if (measured && chosen === null) fitTo(box);
  }, [measured]);

  useLayoutEffect(() => {
    const el = wrap.current;
    const p = pending.current;
    if (!el || !p) return;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    pending.current = null;
  }, [renders, wrap]);

  // Pinch on a trackpad arrives as Ctrl + wheel; it must be non-passive to stop the page zooming.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(scaleRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div className="zoom-board">
      <div className="zoom-scroll" ref={wrap}>
        <div className="zoom-sizer" style={{ width: width * scale, height: VIEW_H * scale }}>
          <Surface zone={zone} state={state} flipped={flipped} width={width} scale={scale} />
        </div>
      </div>
      <div className="zoom-controls">
        <button onClick={() => zoomTo(scale / 1.25)} disabled={scale <= minScale + 1e-6} {...tip('Zoom out')}>
          −
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomTo(scale * 1.25)} disabled={scale >= maxScale - 1e-6} {...tip('Zoom in (or pinch, or Ctrl/⌘ + wheel)', 'end')}>
          +
        </button>
        <button onClick={() => fitTo(box)} {...tip('Fit the cards', 'end')}>
          Fit
        </button>
        <button onClick={() => fitTo({ x: 0, y: 0, w: width, h: VIEW_H })} {...tip('Show the whole board', 'end')}>
          Board
        </button>
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

  // A freshly loaded deck: draw the eye to the library, where drawing starts.
  const [attention, setAttention] = useState(false);
  const count = useRef(zone.cards.length);
  useEffect(() => {
    const before = count.current;
    count.current = zone.cards.length;
    if (!isMyLibrary || !(zone.cards.length > before + 10 || (before === 0 && zone.cards.length > 0))) return;
    setAttention(true);
    const t = setTimeout(() => setAttention(false), 3200);
    return () => clearTimeout(t);
  }, [zone.cards.length, isMyLibrary]);

  return (
    <div
      className={`pile${small ? ' small' : ''}`}
      title={`${zone.name} (${zone.cards.length}) · ${isMyLibrary ? 'click to draw, right-click for more' : 'click to view'}`}
    >
      <div
        className={`pile-slot${attention ? ' attention' : ''}`}
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
        {attention && <span className="pile-bubble">Your deck · click to draw</span>}
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
