/**
 * One press of the pointer, from down to up: a click, or a drag once it has moved far enough. Every
 * drag in the app goes through here (cards across the table, the scry window's rows, the battlefield's
 * selection box), so the mechanics are the same everywhere:
 *
 * - followed on the window, not the pressed element (an element replaced mid-drag, as a card changing
 *   rows is, would lose a pointer capture and with it the release);
 * - Esc or a cancelled pointer ends a drag without dropping, and the Esc goes no further;
 * - the handlers keep whatever state they need between calls themselves, so a release that comes before
 *   the next render still sees the last move.
 */

export interface Point {
  x: number;
  y: number;
}

/** What the handlers get of a pointer event: where it is, and the modifier keys held. */
export interface PointerInfo extends Point {
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface DragHandlers {
  /** The pointer has moved past the threshold: the drag begins (called before the first `move`). */
  start?(at: PointerInfo): void;
  move?(at: PointerInfo): void;
  /** Released after a drag. */
  drop?(at: PointerInfo): void;
  /** Released without having moved past the threshold. */
  click?(at: PointerInfo): void;
  /** A drag ended without a drop: Esc, or the browser took the pointer back. */
  cancel?(): void;
}

export const DRAG_THRESHOLD = 5;

type PointerLike = Event & Partial<PointerInfo> & { clientX?: number; clientY?: number; key?: string };

const info = (e: PointerLike): PointerInfo => ({
  x: e.clientX ?? 0,
  y: e.clientY ?? 0,
  altKey: !!e.altKey,
  shiftKey: !!e.shiftKey,
  metaKey: !!e.metaKey,
  ctrlKey: !!e.ctrlKey,
});

/**
 * Follows a press that started at `from` until it's released or cancelled. Returns a function that
 * stops following it (as a cancel, if a drag had begun).
 */
export function trackPress(from: Point, handlers: DragHandlers, { threshold = DRAG_THRESHOLD, target = globalThis as EventTarget } = {}) {
  let dragging = false;

  const move = (e: Event) => {
    const at = info(e as PointerLike);
    if (!dragging) {
      if (Math.hypot(at.x - from.x, at.y - from.y) < threshold) return;
      dragging = true;
      handlers.start?.(at);
    }
    handlers.move?.(at);
  };
  const up = (e: Event) => {
    const at = info(e as PointerLike);
    const was = dragging;
    stop();
    if (was) handlers.drop?.(at);
    else handlers.click?.(at);
  };
  const cancel = () => {
    const was = dragging;
    stop();
    if (was) handlers.cancel?.();
  };
  const key = (e: Event) => {
    if ((e as PointerLike).key !== 'Escape' || !dragging) return;
    // The Esc ends the drag only: no dialog closing, no selection clearing behind it.
    e.stopImmediatePropagation();
    e.preventDefault();
    cancel();
  };
  function stop() {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('keydown', key, true);
    dragging = false;
  }

  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  // Captured, so it's heard before the app's own Esc handlers.
  target.addEventListener('keydown', key, true);
  return cancel;
}
