import { describe, expect, it } from 'vitest';
import { EDGE_PX, stepAt } from './autoScroll';

describe('how fast a list scrolls by its edge', () => {
  it('not at all away from the edge, faster the closer, fastest right at it', () => {
    expect(stepAt(EDGE_PX)).toBe(0);
    expect(stepAt(-1)).toBe(0);
    expect(stepAt(EDGE_PX - 1)).toBeGreaterThan(0);
    expect(stepAt(10)).toBeGreaterThan(stepAt(40));
    expect(stepAt(0)).toBe(20);
  });
});
