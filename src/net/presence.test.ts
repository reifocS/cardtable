import { describe, expect, it, vi } from 'vitest';
import { Presence } from './presence';

describe('Presence', () => {
  it('tracks one hovered card per player and only notifies on change', () => {
    const changed = vi.fn();
    const p = new Presence(changed);
    p.setHover('p1', 'c1');
    p.setHover('p1', 'c1');
    p.setHover('p2', 'c1');
    expect(p.hovers).toEqual({ p1: 'c1', p2: 'c1' });
    expect(changed).toHaveBeenCalledTimes(2);
    p.forget('p1');
    expect(p.hovers).toEqual({ p2: 'c1' });
  });

  it('expires pings after a couple of seconds', () => {
    vi.useFakeTimers();
    const p = new Presence(() => {});
    p.addPing('p1', { card: 'c1' });
    p.addPing('p2', { zone: 'p2:battlefield', x: 10, y: 20 });
    expect(p.pings.map((x) => x.by)).toEqual(['p1', 'p2']);
    vi.advanceTimersByTime(3000);
    expect(p.pings).toEqual([]);
    vi.useRealTimers();
  });
});
