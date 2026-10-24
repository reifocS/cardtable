import { BOARD_H, BOARD_W, CARD_H, CARD_W } from '../core/state';

const MAX_SCALE = 1.8;
/**
 * Height a board shows, in card units: about two rows plus breathing room. Cards are sized so this
 * fills the area, so lower = bigger cards.
 */
export const VIEW_H = 260;
/** Stored positions run 0..span everywhere; each screen maps them onto its own board. */
const X_SPAN = BOARD_W - CARD_W;
const Y_SPAN = BOARD_H - CARD_H;

/**
 * How a battlefield sits in a `w`×`h` px area. Card size comes from the height alone; the board
 * then shows `width` logical units, whatever fits. Positions are proportional, so a narrow or short
 * screen squeezes cards closer together instead of shrinking them.
 */
export function fitBoard(w: number, h: number) {
  if (!w || !h) return { scale: 1, width: BOARD_W, top: 0 };
  const scale = Math.min(h / VIEW_H, MAX_SCALE);
  return { scale, width: w / scale, top: (h - VIEW_H * scale) / 2 };
}

/** Stored x → x on a board `width` logical units wide. */
export const viewX = (x: number, width: number) => (x / X_SPAN) * Math.max(0, width - CARD_W);
/** x on a board `width` logical units wide → stored x. */
export const storeX = (x: number, width: number) => (width > CARD_W ? (x / (width - CARD_W)) * X_SPAN : 0);
/** Stored y → y on the board. */
export const viewY = (y: number) => (y / Y_SPAN) * (VIEW_H - CARD_H);
/** y on the board → stored y. */
export const storeY = (y: number) => (y / (VIEW_H - CARD_H)) * Y_SPAN;
/** Stored y as seen by someone across the table. */
export const mirrorY = (y: number) => Y_SPAN - y;
