import { useLayoutEffect, useRef } from 'react';
import type { CardId, GameState, ZoneId } from '../core/types';
import { fireWheel, herald } from './herald';

/** Cards I just dropped by hand: they're already where they land, so they don't fly there (but still raise dust). */
export const justDropped = new Set<CardId>();

const FLIGHT_MS = 420;
/** Between cards moved together (a draw of seven), so they leave one after another. */
const STAGGER_MS = 45;

type Seen = { zone: ZoneId; rect: DOMRect };

/** A card on the table, or failing that the pile it's in (only a pile's top card is drawn). */
function placeOf(id: CardId, zone: ZoneId) {
  const el = document.querySelector<HTMLElement>(`.table [data-card-id="${id}"]`);
  const at = el ?? document.querySelector<HTMLElement>(`.table [data-drop-zone="${zone}"]`);
  return { el, rect: at?.getBoundingClientRect() };
}

/**
 * Sends a copy of the card from where it was to where it is now, the real card hidden until it lands.
 * The copy flies over everything, so boards that clip their cards don't cut it off.
 */
function fly(el: HTMLElement, from: DOMRect, to: DOMRect, delay: number, onLand?: (at: DOMRect) => void) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const turn = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? '0';
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  const dx = from.left + from.width / 2 - cx;
  const dy = from.top + from.height / 2 - cy;
  const s = Math.min(3, Math.max(0.3, Math.max(from.width, from.height) / Math.max(to.width, to.height)));

  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-card-id');
  copy.className = 'card flight';
  copy.style.cssText = `width:${w}px;height:${h}px;left:${cx - w / 2}px;top:${cy - h / 2}px`;
  document.body.appendChild(copy);
  el.style.visibility = 'hidden';
  const flight = copy.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(0deg)` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 18}px) scale(${(s + 1) / 2 + 0.08}) rotate(${Number(turn) / 2}deg)`, offset: 0.55 },
      { transform: `translate(0, 0) scale(1) rotate(${turn}deg)` },
    ],
    { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(0.3, 0.6, 0.2, 1)', fill: 'backwards' },
  );
  flight.onfinish = flight.oncancel = () => {
    copy.remove();
    el.style.visibility = '';
    onLand?.(to);
  };
}

/** How many puffs of dust a landing raises, all round the card. */
const PUFFS = 16;

/**
 * Where a card lands on a battlefield, the air it pushes out raises dust along its edges: puffs blown
 * outward low over the table, stretched along their way, that slow and fade as they go, in one burst. Drawn on the playmat under the cards (the board clips it), or
 * over the table where a card has no board.
 */
function dust(card: DOMRect, el: HTMLElement) {
  const host = el.closest<HTMLElement>('.board-wrap');
  const origin = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const cx = card.left + card.width / 2 - origin.left;
  const cy = card.top + card.height / 2 - origin.top;
  const reach = Math.min(card.width, card.height);
  const layer = document.createElement('div');
  layer.className = `land-dust${host ? '' : ' floating'}`;
  (host ?? document.body).appendChild(layer);

  const left = card.left - origin.left;
  const top = card.top - origin.top;
  const done: Promise<unknown>[] = [];
  for (let k = 0; k < PUFFS; k++) {
    // A point on the card's edge, and out from the centre through it.
    const t = (k + Math.random() * 0.8) / PUFFS;
    const along = t * 2 * (card.width + card.height);
    const [ex, ey] =
      along < card.width
        ? [left + along, top]
        : along < card.width + card.height
          ? [left + card.width, top + along - card.width]
          : along < 2 * card.width + card.height
            ? [left + card.width - (along - card.width - card.height), top + card.height]
            : [left, top + card.height - (along - 2 * card.width - card.height)];
    const len = Math.hypot(ex - cx, ey - cy) || 1;
    const ux = (ex - cx) / len;
    const uy = (ey - cy) / len;
    const dist = reach * (0.35 + Math.random() * 0.4);
    const size = reach * (0.28 + Math.random() * 0.22);
    const puff = document.createElement('div');
    puff.className = 'dust-puff';
    puff.style.cssText = `left:${ex - size / 2}px;top:${ey - size / 2}px;width:${size}px;height:${size}px`;
    layer.append(puff);
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    const grow = 1.15 + Math.random() * 0.3;
    // One burst: thrown out fast and quickly slowed, stretched along its way, fading out as it goes.
    const duration = 550 + Math.random() * 200;
    puff.animate(
      [
        { transform: `translate(0, 0) rotate(${angle}deg) scale(0.4, 0.25)` },
        { transform: `translate(${ux * dist * 0.7}px, ${uy * dist * 0.7}px) rotate(${angle}deg) scale(1.3, 0.65)`, offset: 0.3 },
        { transform: `translate(${ux * dist}px, ${uy * dist}px) rotate(${angle}deg) scale(${grow}, ${grow * 0.85})` },
      ],
      { duration, easing: 'cubic-bezier(0.1, 0.8, 0.25, 1)', fill: 'forwards' },
    );
    done.push(
      puff.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.08 }, { opacity: 0 }], { duration, easing: 'ease-out' }).finished,
    );
  }
  Promise.allSettled(done).then(() => layer.remove());
}

/**
 * Cards that change zone fly there: drawn to the hand, played to a battlefield, put in a graveyard,
 * mine or anyone's. Each update notes where every card is, then moves the ones whose zone changed from
 * their last place. Nothing flies on the first view of a table, or when the system asks for less motion.
 */
export function Flights({ state }: { state: GameState }) {
  const seen = useRef<Map<CardId, Seen> | null>(null);

  useLayoutEffect(() => {
    const before = seen.current;
    const now = new Map<CardId, Seen>();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let n = 0;
    for (const card of Object.values(state.cards)) {
      const { el, rect } = placeOf(card.id, card.zone);
      if (rect) now.set(card.id, { zone: card.zone, rect });
      const was = before?.get(card.id);
      if (!was || !el || !rect || was.zone === card.zone || still) continue;
      // Landing on a battlefield raises dust; a legendary card, face up, makes an entrance too.
      const face = card.faceDown ? undefined : card.faces[card.face];
      const legendary = /\bLegendary\b/i.test(face?.type ?? '');
      // A commander, cast from the command zone, gets a wheel of fire instead.
      const commander = state.zones[was.zone]?.role === 'command';
      const onLand =
        state.zones[card.zone]?.kind === 'free'
          ? (at: DOMRect) => {
              dust(at, el);
              // Without WebGL, a plainer entrance: a glow swelling once round the card, fiery or golden.
              const glow = commander ? '#ff6a1a' : '#f4c75a';
              if ((commander || legendary) && !(commander ? fireWheel(at) : herald(at))) {
                el.animate([{ boxShadow: `0 0 0 0 ${glow}00` }, { boxShadow: `0 0 22px 6px ${glow}cc`, offset: 0.3 }, { boxShadow: `0 0 0 0 ${glow}00` }], {
                  duration: 1200,
                  easing: 'ease-out',
                });
              }
            }
          : undefined;
      // Dropped by hand: already in place, so no flight, but it still lands.
      if (justDropped.has(card.id)) onLand?.(rect);
      else fly(el, was.rect, rect, n++ * STAGGER_MS, onLand);
    }
    justDropped.clear();
    seen.current = now;
  }, [state]);

  return null;
}
