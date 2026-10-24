import { describe, expect, it } from 'vitest';
import { BOARD_W, CARD_W } from '../core/state';
import { MIN_VIEW_W, VIEW_H, fitBoard, storeX, storeY, viewX, viewY } from './fit';

describe('fitBoard', () => {
  it('sizes cards from the height on a wide board', () => {
    expect(fitBoard(1600, VIEW_H).scale).toBe(1);
    expect(fitBoard(2400, VIEW_H).scale).toBe(1);
    expect(fitBoard(1600, VIEW_H).width).toBe(1600);
  });

  it('shrinks cards on a narrow board, keeping a minimum width in view', () => {
    const f = fitBoard(MIN_VIEW_W / 2, VIEW_H);
    expect(f.scale).toBe(0.5);
    expect(f.width).toBe(MIN_VIEW_W);
    expect(f.top).toBeGreaterThan(0); // the spare height is split above and below
  });

  it('never upscales past the cap', () => {
    expect(fitBoard(5000, 5000).scale).toBe(1.8);
  });
});

describe('proportional x', () => {
  it('keeps edge cards inside any board, with room for them to be tapped', () => {
    const right = BOARD_W - CARD_W;
    const tappedOverhang = (100 - CARD_W) / 2;
    for (const width of [500, 900, 2000]) {
      expect(viewX(0, width) - tappedOverhang).toBeCloseTo(0);
      expect(viewX(right, width) + CARD_W + tappedOverhang).toBeCloseTo(width);
    }
  });

  it('round-trips between screens', () => {
    expect(storeX(viewX(400, 700), 700)).toBeCloseTo(400);
    // Halfway across one screen is halfway across another.
    const half = storeX(600 / 2 - CARD_W / 2, 600);
    expect(viewX(half, 1200) + CARD_W / 2).toBeCloseTo(1200 / 2);
  });

  it('fills the height, and stored rows land inside it', () => {
    const f = fitBoard(2000, 400);
    expect(VIEW_H * f.scale).toBeCloseTo(400);
    expect(viewY(storeY(37))).toBeCloseTo(37);
    expect(viewY(240) + 100).toBeCloseTo(VIEW_H); // bottom stored row sits on the bottom edge
  });
});
