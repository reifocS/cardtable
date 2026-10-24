import { describe, expect, it } from 'vitest';
import { formatCounter } from './counters';

describe('formatCounter', () => {
  it('adds up power/toughness counters', () => {
    expect(formatCounter('+1/+1', 3)).toBe('+3/+3');
    expect(formatCounter('-1/-1', 2)).toBe('−2/−2');
    expect(formatCounter('+1/+0', 2)).toBe('+2/+0');
  });

  it('keeps names and counts apart', () => {
    expect(formatCounter('Loyalty', 4)).toBe('Loyalty 4');
    expect(formatCounter('Lore 2', 3)).toBe('Lore 2 ×3');
  });
});
