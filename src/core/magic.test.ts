import { describe, expect, it } from 'vitest';
import { entersTapped, entersWithCounters, loyaltyAbilities, staysTapped } from './magic';

describe("Magic's rules read from Oracle text", () => {
  it('enters tapped, only without a condition', () => {
    expect(entersTapped({ name: 'Guildgate', text: 'This land enters tapped.\n{T}: Add {W} or {U}.' })).toBe(true);
    expect(entersTapped({ name: 'Evolving Wilds', text: 'Evolving Wilds enters the battlefield tapped.' })).toBe(true);
    expect(entersTapped({ name: 'Glacial Fortress', text: 'This land enters tapped unless you control a Plains or an Island.' })).toBe(false);
    expect(entersTapped({ name: 'Forest', text: '({T}: Add {G}.)' })).toBe(false);
  });

  it('enters with counters: from the text, loyalty, defense, a Saga', () => {
    expect(entersWithCounters({ name: 'Walking Ballista', text: 'Walking Ballista enters with X +1/+1 counters on it.' })).toEqual({});
    expect(entersWithCounters({ name: 'Hangarback Walker', text: 'This creature enters with two +1/+1 counters on it.' })).toEqual({ '+1/+1': 2 });
    expect(entersWithCounters({ name: 'Ezuri, Claw of Progress', text: 'Ezuri enters with a shield counter on it.' })).toEqual({ Shield: 1 });
    expect(entersWithCounters({ name: 'Jace', type: 'Legendary Planeswalker — Jace', loyalty: 3 })).toEqual({ Loyalty: 3 });
    expect(entersWithCounters({ name: 'Invasion', type: 'Battle — Siege', defense: 5 })).toEqual({ Defense: 5 });
    expect(entersWithCounters({ name: 'History of Benalia', type: 'Enchantment — Saga' })).toEqual({ Lore: 1 });
    expect(entersWithCounters({ name: 'Bear', text: 'If you control an Elf, this creature enters with a +1/+1 counter on it.' })).toEqual({});
  });

  it("knows what doesn't untap", () => {
    expect(staysTapped({ name: 'Mana Vault', text: "Mana Vault doesn't untap during your untap step." })).toBe(true);
    expect(staysTapped({ name: 'Frost', text: "Tap target creature. It doesn't untap during its controller's next untap step." })).toBe(false);
  });

  it('reads loyalty abilities', () => {
    const text = 'Flash\n+1: Put a +1/+1 counter on up to one target creature.\n−1: Create a 2/2 white Samurai creature token.\n−2: Exile target tapped creature.\n−X: Do things.\n0: Nothing.';
    expect(loyaltyAbilities({ name: 'Emperor', type: 'Legendary Planeswalker', text }).map((a) => [a.cost, a.delta])).toEqual([
      ['+1', 1],
      ['−1', -1],
      ['−2', -2],
      ['−X', null],
      ['0', 0],
    ]);
    expect(loyaltyAbilities({ name: 'Bear', type: 'Creature', text: '+1: no' })).toEqual([]);
  });
});
