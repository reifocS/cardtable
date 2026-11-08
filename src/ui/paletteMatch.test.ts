import { describe, expect, it } from 'vitest';
import { score, withCount } from './paletteMatch';

describe('the palette matches', () => {
  it('a start before a word inside, before words anywhere, before letters in order', () => {
    const start = score('Sol Ring', 'sol');
    const word = score('Scry the top card', 'top');
    const words = score('Reveal top card', 'card reveal');
    const letters = score('Sol Ring', 'slrg');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(words);
    expect(words).toBeGreaterThan(letters);
    expect(letters).toBeGreaterThan(0);
  });

  it('nothing that lacks a letter typed, and anything when nothing is typed', () => {
    expect(score('Sol Ring', 'solx')).toBe(0);
    expect(score('Sol Ring', '  ')).toBeGreaterThan(0);
  });

  it('a shorter name first among those starting alike', () => {
    expect(score('Scry…', 'scry')).toBeGreaterThan(score('Scry the top card and more', 'scry'));
  });
});

describe('a count typed after an action', () => {
  it('is read off the end', () => {
    expect(withCount('scry 2')).toEqual({ text: 'scry', count: 2 });
    expect(withCount(' draw  3 ')).toEqual({ text: 'draw', count: 3 });
  });

  it('is not a name that is a number, or a number inside one', () => {
    expect(withCount('42')).toEqual({ text: '42', count: null });
    expect(withCount('roll d20')).toEqual({ text: 'roll d20', count: null });
  });
});
