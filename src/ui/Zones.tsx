import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
      {children}
    </div>
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

/**
 * A battlefield blown up: the same arrangement as on the table. Opens filling the height (big
 * cards, centered, scroll sideways if needed); zoom with pinch, Ctrl/⌘ + wheel or the buttons.
 * Zoom 1 = the whole board fits.
 */
export function ZoomBoard({ zone, state, flipped }: { zone: Zone; state: GameState; flipped?: boolean }) {
  const [wrap, size] = useSize<HTMLDivElement>();
  // null until the area is measured; then it starts at "fill the height".
  const [zoom, setZoom] = useState<number | null>(null);
  // Content point to keep under the cursor across a zoom change.
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const width = laidOutWidth.get(zone.id) ?? 1000;
  const fit = size.w && size.h ? Math.min(size.w / width, size.h / VIEW_H) : 1;
  const fillHeight = size.h ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, size.h / VIEW_H / fit)) : 1;
  const z = zoom ?? fillHeight;
  const scale = fit * z;

  const zoomTo = (next: number, px = size.w / 2, py = size.h / 2) => {
    const el = wrap.current;
    if (!el) return;
    // Where the cursor is, in content units, before the change.
    anchor.current = { x: (el.scrollLeft + px) / scale, y: (el.scrollTop + py) / scale, px, py };
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  // First layout: start centered.
  const centered = useRef(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !size.w || centered.current) return;
    centered.current = true;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [size.w, wrap]);

  useLayoutEffect(() => {
    const el = wrap.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.x * scale - a.px;
    el.scrollTop = a.y * scale - a.py;
    anchor.current = null;
  }, [scale, wrap]);

  // Pinch on a trackpad arrives as Ctrl + wheel; it must be non-passive to stop the page zooming.
  const zoomRef = useRef(z);
  zoomRef.current = z;
  useEffect(() => {
    const el = wrap.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
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
        <button onClick={() => zoomTo(z / 1.25)} disabled={z <= MIN_ZOOM} {...tip('Zoom out')}>
          −
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomTo(z * 1.25)} disabled={z >= MAX_ZOOM} {...tip('Zoom in (or pinch, or Ctrl/⌘ + wheel)', 'end')}>
          +
        </button>
        <button onClick={() => zoomTo(1)} disabled={z <= MIN_ZOOM} {...tip('Show the whole board', 'end')}>
          Fit
        </button>
        <button onClick={() => zoomTo(fillHeight)} {...tip('Fill the height', 'end')}>
          Fill
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
