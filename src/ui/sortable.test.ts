import { describe, expect, it } from 'vitest';
import { insertionIndex, withInserted } from './sortable';

const box = (left: number, top: number, w = 100, h = 140) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

describe('ordering a row', () => {
  it('finds where a drop goes, on wrapped rows too', () => {
    const row = [box(0, 0), box(110, 0), box(220, 0), box(0, 150), box(110, 150)];
    expect(insertionIndex(row, 10, 50)).toBe(0);
    expect(insertionIndex(row, 60, 50)).toBe(1);
    expect(insertionIndex(row, 400, 50)).toBe(3);
    expect(insertionIndex(row, 60, 200)).toBe(4);
    expect(insertionIndex(row, 400, 400)).toBe(5);
  });

  it('puts items back together at an index', () => {
    expect(withInserted(['a', 'b', 'c', 'd'], ['a'], 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(withInserted(['a', 'b', 'c'], ['x', 'y'], 1)).toEqual(['a', 'x', 'y', 'b', 'c']);
    expect(withInserted(['a', 'b', 'c'], ['b'], -1)).toEqual(['a', 'c', 'b']);
    expect(withInserted(['a', 'b'], ['a'], 9)).toEqual(['b', 'a']);
  });
});
