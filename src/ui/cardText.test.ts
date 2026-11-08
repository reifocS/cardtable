import { describe, expect, it } from 'vitest';
import { textActionLabel, textActions, tokenCount } from './cardText';

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

  it("finds cascade (below the card's own mana value), discover and proliferate", () => {
    expect(textActions('Cascade (When you cast this spell, exile cards…)', 4)).toEqual([{ kind: 'cascade', n: 3 }]);
    expect(textActions('Cascade', undefined)).toEqual([]);
    expect(textActions('When this enters, discover 3.')).toEqual([{ kind: 'discover', n: 3 }]);
    expect(textActions('Put a +1/+1 counter on target creature, then proliferate.')).toEqual([{ kind: 'proliferate', n: null }]);
    expect(textActionLabel({ kind: 'cascade', n: 3 })).toBe('Cascade (mana value < 4)');
  });

  it('labels them', () => {
    expect(textActionLabel({ kind: 'draw', n: 1 })).toBe('Draw a card');
    expect(textActionLabel({ kind: 'scry', n: null })).toBe('Scry X');
    expect(textActionLabel({ kind: 'mill', n: 2 })).toBe('Mill 2 cards');
  });
});

describe('token counts from card text', () => {
  it('reads how many of a token are made', () => {
    expect(tokenCount('When this enters, create two Treasure tokens.', 'Treasure')).toBe(2);
    expect(tokenCount('Create three 1/1 red Goblin creature tokens.', 'Goblin')).toBe(3);
    expect(tokenCount('Create a Food token. (It\'s an artifact…)', 'Food')).toBe(1);
    expect(tokenCount('Create X 1/1 Soldier tokens.', 'Soldier')).toBe(1);
    expect(tokenCount('Flying', 'Spirit')).toBe(1);
  });
});
