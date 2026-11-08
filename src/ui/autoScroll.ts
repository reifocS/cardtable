/**
 * Scrolling a list that runs off its box while dragging over it: near an edge of anything scrollable
 * under the pointer (a pile's long viewer, the zoomed battlefield, the scry window), it scrolls that
 * way, faster the closer to the edge. Called every frame while a drag is on (see dragSession), so it
 * keeps going while the pointer rests by the edge.
 */

/** How near an edge the pointer starts it, and how fast it goes right at the edge (px per frame). */
export const EDGE_PX = 56;
const MAX_STEP = 20;

/** How far to scroll for a pointer `d` px from an edge: nothing past EDGE_PX, picking up gently toward it. */
export const stepAt = (d: number) => (d < 0 || d >= EDGE_PX ? 0 : Math.ceil(MAX_STEP * (1 - d / EDGE_PX) ** 2));

const scrolls = (overflow: string) => overflow === 'auto' || overflow === 'scroll';

/** Scrolls whatever under (x, y) the pointer is near the edge of, innermost first. Whether anything moved. */
export function edgeScroll(x: number, y: number): boolean {
  for (let el = document.elementFromPoint(x, y) as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    const canY = scrolls(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canX = scrolls(style.overflowX) && el.scrollWidth > el.clientWidth;
    if (!canX && !canY) continue;
    const r = el.getBoundingClientRect();
    const dy = canY ? stepAt(r.bottom - y) - stepAt(y - r.top) : 0;
    const dx = canX ? stepAt(r.right - x) - stepAt(x - r.left) : 0;
    const was = [el.scrollLeft, el.scrollTop];
    el.scrollLeft += dx;
    el.scrollTop += dy;
    if (el.scrollLeft !== was[0] || el.scrollTop !== was[1]) return true;
  }
  return false;
}
