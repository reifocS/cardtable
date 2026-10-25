import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { CARD_H, CARD_W } from '../core/state';
import type { GameState, Zone } from '../core/types';
import { STACK, draw, openMenu, openViewer, zoneMenu } from './actions';
import { CardBack, CardView, FaceView } from './CardView';
import { onBoardPointerDown } from './drag';
import { VIEW_H, fitBoard, mirrorY, viewX, viewY } from './fit';
import { matLook, matShader } from './playmats';
import { ShaderMat } from './ShaderMat';
import { setBoardWidth, useStore } from './store';
import { tip } from './tip';

/** Size of the element `ref` points at, kept up to date. */
function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

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
  // Rounded up, so a window resize doesn't re-render every card for a pixel.
  const shownWidth = Math.ceil((CARD_W * scale) / 16) * 16;
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
        return c && <CardView key={id} card={c} zone={zone} left={viewX(c.x, width)} top={viewY(flipped ? mirrorY(c.y) : c.y)} shownWidth={shownWidth} />;
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
  const wrap = useRef<HTMLDivElement>(null);
  const size = useSize(wrap);
  const { scale, width, top } = fitBoard(size.w, size.h);
  // The zoomed view reuses this width, so its cards keep exactly the same arrangement.
  useLayoutEffect(() => {
    if (size.w) setBoardWidth(zone.id, width);
  }, [zone.id, width, size.w]);
  const playmat = state.players[zone.owner]?.playmat;
  const mat = matLook(playmat);
  const shader = matShader(playmat);
  return (
    <div className={`board-wrap ${mat.className}`} style={mat.style} ref={wrap}>
      {shader && <ShaderMat fragment={shader} />}
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
  const wrap = useRef<HTMLDivElement>(null);
  const size = useSize(wrap);
  // Pixels per board unit, once a zoom is picked; until then it follows the cards, fitted.
  const [chosen, setChosen] = useState<number | null>(null);
  // Scroll position for the next scale, applied once it's on screen.
  const pending = useRef<{ left: number; top: number } | null>(null);

  const width = useStore((s) => s.boardWidths[zone.id]) ?? 1000;
  const box = cardsBox(zone, state, width, flipped);
  const mat = matLook(state.players[zone.owner]?.playmat);
  const measured = size.w > 0 && size.h > 0;
  const fitBoardScale = measured ? Math.min(size.w / width, size.h / VIEW_H) : 1;
  const fitCardsScale = measured ? Math.min(size.w / box.w, size.h / box.h) : 1;
  const minScale = Math.min(fitBoardScale, fitCardsScale);
  const maxScale = Math.max(fitBoardScale, fitCardsScale) * ZOOM_RANGE;
  const scale = chosen ?? fitCardsScale;

  /** Scroll that puts `target` in the middle of the view at scale `s`. */
  const centered = (target: Box, s: number) => ({
    // While the board is smaller than the view in a direction, it's centered and doesn't scroll.
    left: target.x * s - Math.max(0, (size.w - target.w * s) / 2),
    top: target.y * s - Math.max(0, (size.h - target.h * s) / 2),
  });

  const show = (s: number, scroll: { left: number; top: number }) => {
    const el = wrap.current;
    if (!el) return;
    if (s === scale) {
      el.scrollLeft = scroll.left;
      el.scrollTop = scroll.top;
      return;
    }
    pending.current = scroll;
    setChosen(s);
  };

  /** Zoom so `target` fills the view, centered on it. */
  const fitTo = (target: Box) => {
    const s = Math.min(size.w / target.w, size.h / target.h);
    show(s, centered(target, s));
  };

  const zoomTo = (next: number, px: number, py: number) => {
    const el = wrap.current;
    if (!el) return;
    const s = Math.min(maxScale, Math.max(minScale, next));
    // Keep the point under the cursor where it is.
    const x = (el.scrollLeft + px) / scale;
    const y = (el.scrollTop + py) / scale;
    show(s, { left: x * s - px, top: y * s - py });
  };
  const zoomAtCenter = (next: number) => zoomTo(next, size.w / 2, size.h / 2);

  // A new scale is on screen: scroll to where it was asked for, or keep the fitted cards centered.
  const fitted = chosen === null && measured ? centered(box, scale) : null;
  const fitLeft = fitted?.left;
  const fitTop = fitted?.top;
  useLayoutEffect(() => {
    const el = wrap.current;
    const p = pending.current ?? (fitLeft === undefined || fitTop === undefined ? null : { left: fitLeft, top: fitTop });
    if (!el || !p) return;
    el.scrollLeft = p.left;
    el.scrollTop = p.top;
    pending.current = null;
  }, [scale, fitLeft, fitTop]);

  // Pinch on a trackpad arrives as Ctrl + wheel; it must be non-passive to stop the page zooming.
  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    zoomTo(scale * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  });
  useEffect(() => {
    const el = wrap.current!;
    const handler = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  return (
    <div className="zoom-board">
      <div className={`zoom-scroll ${mat.className}`} style={mat.style} ref={wrap}>
        <div className="zoom-sizer" style={{ width: width * scale, height: VIEW_H * scale }}>
          <Surface zone={zone} state={state} flipped={flipped} width={width} scale={scale} />
        </div>
      </div>
      <div className="zoom-controls">
        <button onClick={() => zoomAtCenter(scale / 1.25)} disabled={scale <= minScale + 1e-6} {...tip('Zoom out')}>
          −
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomAtCenter(scale * 1.25)} disabled={scale >= maxScale - 1e-6} {...tip('Zoom in (or pinch, or Ctrl/⌘ + wheel)', 'end')}>
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
  const count = zone.cards.length;
  const [seen, setSeen] = useState(count);
  const [attention, setAttention] = useState(false);
  if (count !== seen) {
    setSeen(count);
    if (isMyLibrary && (count > seen + 10 || (seen === 0 && count > 0))) setAttention(true);
  }
  useEffect(() => {
    if (!attention) return;
    const t = setTimeout(() => setAttention(false), 3200);
    return () => clearTimeout(t);
  }, [attention]);

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

/**
 * The table's stack, over the line between the opponents and me. A small drop target while empty
 * (larger while dragging); a band of cards while spells are waiting, last cast on top.
 * Every new spell shows in everyone's preview.
 */
export function StackZone({ state }: { state: GameState }) {
  const zone = state.zones[STACK];
  const top = zone?.cards[0];
  useEffect(() => {
    if (!top) return;
    const { hovered } = useStore.getState();
    if (!hovered) useStore.setState({ previewId: top });
  }, [top]);
  if (!zone) return null;
  // Oldest on the left, so the last cast (top of the stack) ends on the right, in front.
  const ids = [...zone.cards].reverse();
  // A plain pile for drops (no list index): a cast spell always goes on top.
  return (
    <div className={`stack-zone${ids.length ? ' busy' : ''}`} data-drop-zone={zone.id}>
      <span className="stack-label">Stack</span>
      {ids.map((id) => {
        const c = state.cards[id];
        return c && <CardView key={id} card={c} zone={zone} />;
      })}
    </div>
  );
}
