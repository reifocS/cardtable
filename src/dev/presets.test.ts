import { describe, expect, it } from 'vitest';
import { zoneId } from '../core/state';
import { PRESETS, buildWith } from './presets';

describe('dev presets', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))('%s builds', (_, p) => {
    const { state, me } = buildWith(p);
    expect(state.players[me]).toBeDefined();
  });

  it('cover the layouts they promise', () => {
    const seats = Object.fromEntries(PRESETS.map((p) => [p.id, buildWith(p).state.seats.length]));
    expect(seats).toMatchObject({ empty: 1, duel: 2, commander4: 4, six: 6 });
    const { state, me } = buildWith(PRESETS.find((p) => p.id === 'crowded')!);
    expect(state.zones[zoneId(me, 'battlefield')].cards).toHaveLength(40);
    expect(state.zones[zoneId(me, 'hand')].cards).toHaveLength(25);
  });

  it('are deterministic', () => {
    const p = PRESETS.find((x) => x.id === 'commander4')!;
    expect(JSON.stringify(buildWith(p).state.zones)).toBe(JSON.stringify(buildWith(p).state.zones));
  });
});
