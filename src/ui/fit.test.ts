import { describe, expect, it } from 'vitest';
import { BOARD_W, CARD_W } from '../core/state';
import { VIEW_H, fitBoard, storeX, storeY, viewX, viewY } from './fit';

describe('fitBoard', () => {
  it('sizes cards from the height only, whatever the width', () => {
    expect(fitBoard(600, VIEW_H).scale).toBe(1);
    expect(fitBoard(2400, VIEW_H).scale).toBe(1);
    expect(fitBoard(600, VIEW_H).width).toBe(600);
  });

  it('never upscales past the cap', () => {
    expect(fitBoard(5000, 5000).scale).toBe(1.8);
  });
});

describe('proportional x', () => {
  it('keeps the far-right edge on the right edge of any board', () => {
    const right = BOARD_W - CARD_W;
    for (const width of [500, 900, 2000]) expect(viewX(right, width) + CARD_W).toBeCloseTo(width);
  });

  it('round-trips between screens', () => {
    expect(storeX(viewX(400, 700), 700)).toBeCloseTo(400);
    // Halfway across one screen is halfway across another.
    const half = storeX((600 - CARD_W) / 2, 600);
    expect(viewX(half, 1200)).toBeCloseTo((1200 - CARD_W) / 2);
  });

  it('fills the height, and stored rows land inside it', () => {
    const f = fitBoard(800, 400);
    expect(VIEW_H * f.scale).toBeCloseTo(400);
    expect(viewY(storeY(37))).toBeCloseTo(37);
    expect(viewY(240) + 100).toBeCloseTo(VIEW_H); // bottom stored row sits on the bottom edge
  });
});
