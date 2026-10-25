/**
 * Magic's phase triggers, read from a card's Oracle text with fixed patterns: "At the beginning of
 * your upkeep…", "Whenever … attacks…". No model, no network: deterministic and instant. Phrasings
 * the patterns don't know are simply missed, never guessed.
 */

/** Whose turn the trigger fires on, from its controller's point of view. */
export type Whose = 'yours' | 'each' | 'opponents';

/** The steps of a Magic turn that triggers name, in order. */
export const STEPS_IN_ORDER = [
  { id: 'upkeep', name: 'Upkeep' },
  { id: 'draw', name: 'Draw' },
  { id: 'main1', name: 'Main' },
  { id: 'combat', name: 'Combat' },
  { id: 'main2', name: 'Main 2' },
  { id: 'end', name: 'End' },
] as const;

export interface Trigger {
  /** When in the turn it fires: an id of STEPS_IN_ORDER. */
  phase: string;
  whose: Whose;
  /** The ability, as printed (reminder text dropped). */
  text: string;
}

const WHOSE: Record<string, Whose> = {
  your: 'yours',
  each: 'each',
  "each player's": 'each',
  the: 'each',
  "each opponent's": 'opponents',
  "each other player's": 'opponents',
  'each of your': 'yours',
};

const STEPS: Record<string, string> = {
  upkeep: 'upkeep',
  'draw step': 'draw',
  'precombat main phase': 'main1',
  'first main phase': 'main1',
  'postcombat main phase': 'main2',
  'second main phase': 'main2',
  'postcombat main phases': 'main2',
  'end step': 'end',
};

// "At the beginning of [whose] [step]". "next" makes it a delayed trigger from a spell: not a
// standing reminder, so it doesn't match.
const BEGINNING = new RegExp(`^at the beginning of (${Object.keys(WHOSE).join('|')}) (${Object.keys(STEPS).join('|')})\\b`);
const COMBAT = /^at the beginning of (?:combat on (your|each opponent's|each player's) turn|(each) combat)\b/;
const COMBAT_WHOSE: Record<string, Whose> = { your: 'yours', "each opponent's": 'opponents', "each player's": 'each', each: 'each' };
// The card itself, a creature of yours, or "you attack": only on its controller's turn.
const ATTACKS = /^whenever (.+? attacks|you attack)\b/;

/** The phase triggers in one face's Oracle text. */
export function triggersOf(oracle: string | undefined): Trigger[] {
  if (!oracle) return [];
  const out: Trigger[] = [];
  for (const raw of oracle.split('\n')) {
    const text = raw.replace(/\s*\([^)]*\)/g, '').trim();
    const line = text.toLowerCase();
    const beginning = line.match(BEGINNING);
    if (beginning) {
      out.push({ phase: STEPS[beginning[2]], whose: WHOSE[beginning[1]], text });
      continue;
    }
    const combat = line.match(COMBAT);
    if (combat) {
      out.push({ phase: 'combat', whose: COMBAT_WHOSE[combat[1] ?? combat[2]], text });
      continue;
    }
    if (ATTACKS.test(line) && !/\bopponent\b.*\battacks\b|\battacks you\b/.test(line.split(',')[0])) {
      out.push({ phase: 'combat', whose: 'yours', text });
    }
  }
  return out;
}

/** Whether a trigger controlled by `controller` fires during `active`'s turn. */
export function firesOn(t: Trigger, controller: string, active: string | null): boolean {
  if (t.whose === 'each') return true;
  return t.whose === 'yours' ? controller === active : controller !== active;
}
