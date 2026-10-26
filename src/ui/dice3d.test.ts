import { describe, expect, it } from 'vitest';
import { faceCount } from './dice3d';

describe('dice', () => {
  it('each die has as many faces as sides; a coin has two caps and an edge', () => {
    expect([4, 6, 8, 10, 12, 20].map(faceCount)).toEqual([4, 6, 8, 10, 12, 20]);
    expect(faceCount(2)).toBe(26);
  });
});
