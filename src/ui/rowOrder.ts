import type { CardId, Zone } from '../core/types';
import { withInserted } from './sortable';
import { useStore } from './store';

/**
 * A row's cards in the order to show: while cards are dragged over it, with them already where
 * they'd land (cards from elsewhere as gaps, see Hand), so the others move aside to make room.
 */
export function useRowOrder(zone: Zone, ids: CardId[]): CardId[] {
  const preview = useStore((s) => (s.dropPreview?.zone === zone.id ? s.dropPreview : null));
  return preview ? withInserted(ids, preview.ids, preview.index) : ids;
}


/**
 * The cards a row draws up out of itself as they move (see sortable.useFlip): the picked ones, moved
 * with the keys. None while a drag is on: the ghost under the pointer is the card then, and its faded
 * place should slide along the row, not jump up.
 */
export function useLifted(): CardId[] {
  const selection = useStore((s) => s.selection);
  const dragging = useStore((s) => s.dragging.length > 0);
  return dragging ? [] : selection;
}
