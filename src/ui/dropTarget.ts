/**
 * Which drop zone a dragged card is over. Decided from every element stacked under the pointer (as
 * `document.elementsFromPoint` lists them, topmost first, clipped as they're drawn), not just the top
 * one: anything that isn't a zone lets the drop through to what's below it, so a die, an arrow, a ping
 * or whatever passes over the table next can never catch a drop. Only panels that cover the table
 * (`COVERS`) stop it: a dialog, a pile's viewer outside its list, the zoomed battlefield's frame.
 */

export const DROP_ZONE = '[data-drop-zone]';

/** Panels drawn over the table: a drop on them, outside a zone of theirs, goes nowhere. */
export const COVERS = '.modal-backdrop, .viewer, .board-focus, .mulligan-bar, .menu, .offline';

/** What's read of an element: whether it's in a zone, or in a panel. (An Element is one.) */
export interface Stacked {
  closest(selector: string): Stacked | null;
}

/** The drop zone among the elements under the pointer, topmost first; null over a panel or nothing. */
export function zoneIn<E extends Stacked>(stack: Iterable<E>): E | null {
  for (const el of stack) {
    const zone = el.closest(DROP_ZONE);
    if (zone) return zone as E;
    if (el.closest(COVERS)) return null;
  }
  return null;
}

/** How far the pointer may stray outside the zone it's over before it counts as leaving it. */
export const STICK_PX = 12;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The zone for a pointer at (x, y), given the zone under it (`hit`) and the one it was over (`held`,
 * with its box). A zone holds on while the pointer is just past its edge: right at an edge, or as a row
 * grows to make room under the pointer, the target would otherwise flicker between it and what's next
 * to it. Inside it, whatever lies on top wins: a pile's viewer or the stack over a battlefield is a zone
 * of its own.
 */
export function sticky<E>(hit: E | null, held: E | null, heldBox: Box | null, x: number, y: number): E | null {
  if (!held || !heldBox || hit === held) return hit;
  const within = (m: number) => x >= heldBox.left - m && x <= heldBox.right + m && y >= heldBox.top - m && y <= heldBox.bottom + m;
  if (within(0)) return hit;
  return within(STICK_PX) ? held : hit;
}
