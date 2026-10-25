/**
 * Magic's mana abilities, read from a card's Oracle text with fixed patterns, for a count of the
 * mana a player can make right now. "{T}: Add {G}", "{T}: Add {R} or {G}", "{T}: Add {C}{C}",
 * "{T}: Add one mana of any color", and a basic land's reminder text. A color chosen in play counts
 * as any. Anything else that adds mana (an extra cost, an amount that varies) is flagged as special
 * rather than guessed.
 */

export const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type Color = (typeof COLORS)[number];

/** One mana, and the colors it can be. */
export type Unit = Color[];

/** What one card can add by tapping: the units of its best ability, or special. */
export interface ManaSource {
  units: Unit[];
  special: boolean;
}

const ANY: Unit = ['W', 'U', 'B', 'R', 'G'];

/** "{W}" → ['W'] … */
function symbols(s: string): Color[] | null {
  const found = [...s.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1] as Color);
  return found.length ? found : null;
}

/** The mana one "Add …" clause makes, or null when it isn't a fixed amount. */
function added(clause: string): Unit[] | null {
  const c = clause.trim().replace(/\.$/, '');
  if (/^one mana of any (one )?color$/.test(c)) return [ANY];
  // A color chosen as the card came in, or the commander's: counted as any, the choice being the player's.
  if (/^(\{[WUBRGC]\} or )?one mana of (the chosen color|any color in your commander's color identity)$/.test(c)) return [ANY];
  const many = c.match(/^(two|three) mana (?:of any one color|in any combination of colors)$/);
  if (many) return Array.from({ length: many[1] === 'two' ? 2 : 3 }, () => ANY);
  // "{R} or {G}", "{W}, {U}, or {B}": one mana, a choice of colors.
  if (/^\{[WUBRGC]\}(, \{[WUBRGC]\})*,? or \{[WUBRGC]\}$/.test(c)) return [symbols(c)!];
  // "{G}", "{C}{C}", "{G}{G}{G}": that many, each fixed.
  if (/^(\{[WUBRGC]\})+$/.test(c)) return symbols(c)!.map((s) => [s]);
  return null;
}

/** What a face can tap for, or undefined when it has no mana ability. */
export function manaOf(oracle: string | undefined): ManaSource | undefined {
  if (!oracle) return undefined;
  let best: Unit[] | null = null;
  let special = false;
  for (const raw of oracle.split('\n')) {
    // A basic land's ability is all reminder text: "({T}: Add {W}.)"; Dryad Arbor's is quoted in it.
    const line = raw.trim().replace(/^\((\{T\}: Add .*)\)$/, '$1').replace(/^\(.*"(\{T\}: Add [^"]*)"\)$/, '$1');
    // Paying life or sacrificing the source still makes the mana now: those count.
    const ability = line.match(/^\{T\}(?:, (?:Pay \d+ life|Sacrifice (?:this|it)[^:]*))?: Add (.+?)(\.|$)/);
    if (!ability) {
      // Other costs or amounts ("{1}, {T}: Add", "Add {G} for each Elf") are counted as special.
      if (/: Add (\{|one|two|three|X |an amount)/.test(line.replace(/\s*\([^)]*\)/g, ''))) special = true;
      continue;
    }
    const units = added(ability[1]);
    if (!units) {
      special = true;
      continue;
    }
    // A card with several tap abilities uses one: keep the one that makes the most.
    if (!best || units.length > best.length || (units.length === best.length && units[0].length > best[0].length)) best = units;
  }
  if (!best && !special) return undefined;
  return { units: best ?? [], special: special && !best };
}

export interface Pool {
  /** Mana these sources make in all. */
  total: number;
  /** For each color, the most of it they can make. */
  max: Record<Color, number>;
  /** Sources whose mana couldn't be read (their names). */
  special: string[];
}

/** Adds up what the given sources can make. */
export function poolOf(sources: { name: string; source: ManaSource }[]): Pool {
  const pool: Pool = { total: 0, max: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, special: [] };
  for (const { name, source } of sources) {
    if (source.special) pool.special.push(name);
    pool.total += source.units.length;
    for (const unit of source.units) for (const color of unit) pool.max[color]++;
  }
  return pool;
}
