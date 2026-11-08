import { describe, expect, it } from 'vitest';
import { sticky, zoneIn, type Stacked } from './dropTarget';

/** A fake element: its class, and its parent. `closest` matches a selector list by class or attribute. */
class El implements Stacked {
  constructor(
    readonly name: string,
    readonly parent: El | null = null,
  ) {}
  closest(selector: string): El | null {
    const wanted = selector.split(',').map((s) => s.trim());
    const matches = (e: El) => wanted.some((s) => (s === '[data-drop-zone]' ? e.name.startsWith('zone:') : s === `.${e.name}`));
    return matches(this) ? this : (this.parent?.closest(selector) ?? null);
  }
}

const table = new El('table');
const board = new El('zone:board', table);
const card = new El('card', board);
const die = new El('die');
const arrow = new El('arrow');
const viewer = new El('viewer');
const viewerHead = new El('head', viewer);
const viewerList = new El('zone:graveyard', viewer);

describe('the zone a drop goes to', () => {
  it('is the topmost zone under the pointer, through anything else lying over it', () => {
    expect(zoneIn([die, arrow, card, board, table])).toBe(board);
    expect(zoneIn([die, board])).toBe(board);
  });

  it("is a panel's own zone where it has one", () => {
    expect(zoneIn([viewerList, viewer, board, table])).toBe(viewerList);
  });

  it('is none over a panel covering the table, or over nothing', () => {
    expect(zoneIn([viewerHead, viewer, board, table])).toBeNull();
    expect(zoneIn([die, table])).toBeNull();
    expect(zoneIn([])).toBeNull();
  });
});

describe('the zone held on to', () => {
  const box = { left: 0, top: 0, right: 100, bottom: 100 };
  it('holds just past its edge, then lets go', () => {
    expect(sticky<string>('next', 'held', box, 105, 50)).toBe('held');
    expect(sticky<string>(null, 'held', box, 50, 110)).toBe('held');
    expect(sticky<string>('next', 'held', box, 120, 50)).toBe('next');
  });

  it('gives way inside it to a zone lying on top', () => {
    expect(sticky<string>('viewer', 'held', box, 50, 50)).toBe('viewer');
  });

  it('is whatever is under the pointer when nothing was held', () => {
    expect(sticky<string>('hit', null, null, 50, 50)).toBe('hit');
  });
});
