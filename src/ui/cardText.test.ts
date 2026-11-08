import { describe, expect, it } from 'vitest';
import { textActionLabel, textActions } from './cardText';

describe('shortcuts from card text', () => {
  it('finds scry and draw in order, skipping reminder text', () => {
    // Opt
    expect(textActions('Scry 1. (Look at the top card of your library. You may put that card on the bottom.)\nDraw a card.')).toEqual([
      { kind: 'scry', n: 1 },
      { kind: 'draw', n: 1 },
    ]);
  });

  it('reads number words and X', () => {
    expect(textActions('Surveil two.')).toEqual([{ kind: 'surveil', n: 2 }]);
    expect(textActions('Draw three cards.')).toEqual([{ kind: 'draw', n: 3 }]);
    expect(textActions('Scry X, then draw X cards.')).toEqual([
      { kind: 'scry', n: null },
      { kind: 'draw', n: null },
    ]);
  });

  it('finds mill and "look at the top N"', () => {
    expect(textActions('Target player mills three cards.')).toEqual([{ kind: 'mill', n: 3 }]);
    expect(textActions('Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom.')).toEqual([
      { kind: 'look', n: 4 },
    ]);
  });

  it("doesn't repeat itself, and ignores what isn't there", () => {
    expect(textActions('Draw a card. At the beginning of your upkeep, draw a card.')).toEqual([{ kind: 'draw', n: 1 }]);
    expect(textActions('Flying, vigilance')).toEqual([]);
    expect(textActions(undefined)).toEqual([]);
  });

  it('labels them', () => {
    expect(textActionLabel({ kind: 'draw', n: 1 })).toBe('Draw a card');
    expect(textActionLabel({ kind: 'scry', n: null })).toBe('Scry X');
    expect(textActionLabel({ kind: 'mill', n: 2 })).toBe('Mill 2 cards');
  });
});
