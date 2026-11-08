import type { CardId } from '../core/types';
import { useStore } from './store';

/**
 * The end of a drag: the card let go glides from where the ghost was to its place, whether it was
 * dropped (to where it lands) or the drag was cancelled (back to where it came from). The ghost never
 * just vanishes, and the card never just appears.
 */

/** Where the ghost of a card was when let go, and how it was turned. */
export interface LetGo {
  from: DOMRect;
  turn: number;
  /** What happens as it lands (dust on a battlefield): set by Flights when the drop changed its zone. */
  onLand?: (at: DOMRect) => void;
}

/** Cards just let go of by hand, waiting to glide to their place once the table has drawn it. */
export const letGo = new Map<CardId, LetGo>();

/** Short over a short way, a little longer back across the table: never slow enough to wait for. */
const settleMs = (distance: number) => Math.min(280, 130 + distance * 0.12);

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Glides a copy of `el` from the box `from` (turned `fromTurn`) to where `el` is, `el` hidden meanwhile.
 * The copy goes over everything (dialogs included), so nothing clips it on its way.
 */
export function settle(el: HTMLElement, from: DOMRect, fromTurn = 0, onLand?: (at: DOMRect) => void) {
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height || still()) return onLand?.(to);
  const turn = Number(/rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)?.[1] ?? 0);
  // Its size on screen, upright (the box of a turned card is the other way round); the copy is drawn at it.
  const sideways = turn % 180 !== 0;
  const w = sideways ? to.height : to.width;
  const h = sideways ? to.width : to.height;
  const cx = to.left + to.width / 2;
  const cy = to.top + to.height / 2;
  const dx = from.left + from.width / 2 - cx;
  const dy = from.top + from.height / 2 - cy;
  const s = Math.max(from.width, from.height) / Math.max(to.width, to.height);
  // Let go of right where it lands (a battlefield): nothing to glide.
  if (Math.hypot(dx, dy) < 1 && Math.abs(s - 1) < 0.01 && fromTurn === turn) return onLand?.(to);

  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-card-id');
  copy.className = 'card settling';
  copy.style.cssText = `width:${w}px;height:${h}px;left:${cx - w / 2}px;top:${cy - h / 2}px`;
  document.body.appendChild(copy);
  el.style.visibility = 'hidden';
  const glide = copy.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${fromTurn}deg)` }, { transform: `translate(0, 0) scale(1) rotate(${turn}deg)` }],
    { duration: settleMs(Math.hypot(dx, dy)), easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
  glide.onfinish = glide.oncancel = () => {
    copy.remove();
    el.style.visibility = '';
    onLand?.(to);
  };
}

/** Where the ghost of a drag is on screen, to glide from once it's let go. */
export const ghostBox = () => document.querySelector('.ghost')?.getBoundingClientRect();

/** The card drawn for `id` in `zone`: the one on top where a zone shows twice (a pile and its open viewer, a zoomed battlefield). */
function shownIn(zone: string, id: CardId): HTMLElement | null {
  const els = [...document.querySelectorAll<HTMLElement>(`[data-drop-zone="${zone}"] [data-card-id="${id}"]`)];
  return els.reverse().find((el) => el.offsetWidth > 0) ?? null;
}

/**
 * Lets go of the cards of a drag, each from the box it had around the ghost (`froms`): once the table
 * shows them where they are now (a drop applied, or nothing changed), each glides there. Call it after
 * the drop's move is sent.
 */
export function letGoOf(froms: Map<CardId, { from: DOMRect; turn: number }>) {
  for (const [id, go] of froms) letGo.set(id, { ...go });
  // After the render the drop causes (and Flights noting the landings), before it's painted.
  requestAnimationFrame(() => {
    const cards = useStore.getState().state?.cards;
    for (const [id, go] of letGo) {
      const card = cards?.[id];
      const el = card && shownIn(card.zone, id);
      if (el) settle(el, go.from, go.turn, go.onLand);
      else go.onLand?.(go.from);
    }
    letGo.clear();
  });
}

/**
 * Where each card of a group is let go of: those that were together on the held card's battlefield
 * (`group`, their boxes when picked up) keep their places around the ghost, so cards that land as they
 * were carried (a creature and what's attached to it) don't move at all; any other comes from the
 * ghost itself, which stood for it.
 */
export function aroundGhost(ids: CardId[], held: CardId, group: Map<CardId, DOMRect>, ghost: DOMRect | undefined, turnOf: (id: CardId) => number) {
  const froms = new Map<CardId, { from: DOMRect; turn: number }>();
  if (!ghost) return froms;
  const h = group.get(held);
  const k = h ? Math.max(ghost.width, ghost.height) / Math.max(h.width, h.height) : 1;
  for (const id of ids) {
    const r = group.get(id);
    const from = r && h ? new DOMRect(ghost.left + (r.left - h.left) * k, ghost.top + (r.top - h.top) * k, r.width * k, r.height * k) : ghost;
    froms.set(id, { from, turn: turnOf(id) });
  }
  return froms;
}
