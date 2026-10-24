import { BOARD_H, BOARD_W, CARD_H, CARD_W } from '../core/state';

const MAX_SCALE = 1.8;
/**
 * Width, in card units, a board always shows (about 11 cards). A narrow board (several opponents
 * side by side) shrinks its cards to keep it, instead of piling them on top of each other.
 */
export const MIN_VIEW_W = 820;
/**
 * Height a board shows, in card units: about two rows plus breathing room. Cards are sized so this
 * fills the area, so lower = bigger cards.
 */
export const VIEW_H = 260;
/** Stored positions run 0..span everywhere; each screen maps them onto its own board. */
const X_SPAN = BOARD_W - CARD_W;
const Y_SPAN = BOARD_H - CARD_H;

/**
 * How a battlefield sits in a `w`×`h` px area. Cards are as big as the height allows, unless that
 * would leave less than MIN_VIEW_W visible; the board then shows `width` logical units. Positions
 * are proportional, so beyond that a narrow screen squeezes cards closer together.
 */
export function fitBoard(w: number, h: number) {
  if (!w || !h) return { scale: 1, width: BOARD_W, top: 0 };
  const scale = Math.min(h / VIEW_H, w / MIN_VIEW_W, MAX_SCALE);
  return { scale, width: w / scale, top: (h - VIEW_H * scale) / 2 };
}

/** Side margin so a tapped card (rotated, so wider) at either edge still fits. */
const X_PAD = (CARD_H - CARD_W) / 2;
const xRoom = (width: number) => Math.max(0, width - CARD_W - 2 * X_PAD);

/** Stored x → x on a board `width` logical units wide. */
export const viewX = (x: number, width: number) => X_PAD + (x / X_SPAN) * xRoom(width);
/** x on a board `width` logical units wide → stored x. */
export const storeX = (x: number, width: number) => (xRoom(width) > 0 ? ((x - X_PAD) / xRoom(width)) * X_SPAN : 0);
/** Stored y → y on the board. */
export const viewY = (y: number) => (y / Y_SPAN) * (VIEW_H - CARD_H);
/** y on the board → stored y. */
export const storeY = (y: number) => (y / (VIEW_H - CARD_H)) * Y_SPAN;
/** Stored y as seen by someone across the table. */
export const mirrorY = (y: number) => Y_SPAN - y;
