import type { CardId, Zone, ZoneId } from '../core/types';
import { withInserted } from './sortable';
import { useStore } from './store';

/**
 * How the rows and zones of the table show a drag and a move, read from the store (see drag.ts and
 * shiftInRow): no component is ever touched from outside to show one.
 */

/**
 * A row's cards in the order to show: while cards are dragged over it, with them already where
 * they'd land (cards from elsewhere as gaps, see Hand), so the others move aside to make room.
 */
export function useRowOrder(zone: Zone, ids: CardId[]): CardId[] {
  const over = useStore((s) => (s.drag?.over?.zone === zone.id ? s.drag.over : null));
  const dragged = useStore((s) => s.drag?.ids);
  return over && dragged && over.index !== null ? withInserted(ids, dragged, over.index) : ids;
}

/** Whether a zone is the one dragged cards would drop into: it lights up. */
export function useDropHover(zone: ZoneId): boolean {
  return useStore((s) => s.drag?.over?.zone === zone);
}

/** Whether this card is being dragged, or drawn in the ghost's group: its place shows faded while the ghost follows the pointer. */
export function useDragged(card: CardId): boolean {
  return useStore((s) => !!s.drag && (s.drag.ids.includes(card) || !!s.drag.laid?.some((m) => m.id === card)));
}

/**
 * The cards a row draws up out of itself as they move (see sortable.useFlip): the ones just carried
 * along it with the keys. A move from anything else (a drop, another player, a draw) just slides.
 */
export function useLifted(): CardId[] {
  return useStore((s) => s.carry) ?? NONE;
}
const NONE: CardId[] = [];
