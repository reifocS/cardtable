/** What a card's rules text asks for often enough to deserve a shortcut in its menu. */
export interface TextAction {
  kind: 'scry' | 'surveil' | 'draw' | 'mill' | 'look';
  /** How many cards; null for X (asked when used). */
  n: number | null;
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const NUM = '(\\d+|x|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';

const PATTERNS: [TextAction['kind'], RegExp][] = [
  ['scry', new RegExp(`\\bscry ${NUM}\\b`, 'gi')],
  ['surveil', new RegExp(`\\bsurveil ${NUM}\\b`, 'gi')],
  ['draw', new RegExp(`\\bdraws? ${NUM} (?:additional )?cards?\\b`, 'gi')],
  ['mill', new RegExp(`\\bmills? ${NUM} cards?\\b`, 'gi')],
  ['look', new RegExp(`\\blook at the top ${NUM} cards? of (?:your|their|that player's|target player's) library\\b`, 'gi')],
];

const count = (word: string) => (word.toLowerCase() === 'x' ? null : (WORDS[word.toLowerCase()] ?? Number(word)));

/** Shortcuts found in rules text, in the order they appear, without repeats. Reminder text is ignored. */
export function textActions(text: string | undefined): TextAction[] {
  if (!text) return [];
  // "(Look at the top card of your library…)" only explains a keyword already found.
  const rules = text.replace(/\([^)]*\)/g, '');
  const found: (TextAction & { at: number })[] = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of rules.matchAll(re)) {
      const n = count(m[1]);
      if (n !== null && !(n > 0 && n <= 99)) continue;
      if (!found.some((f) => f.kind === kind && f.n === n)) found.push({ kind, n, at: m.index ?? 0 });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ kind, n }) => ({ kind, n }));
}

export function textActionLabel({ kind, n }: TextAction): string {
  const x = n ?? 'X';
  switch (kind) {
    case 'scry':
      return `Scry ${x}`;
    case 'surveil':
      return `Surveil ${x}`;
    case 'draw':
      return n === 1 ? 'Draw a card' : `Draw ${x} cards`;
    case 'mill':
      return n === 1 ? 'Mill a card' : `Mill ${x} cards`;
    case 'look':
      return n === 1 ? 'Look at the top card…' : `Look at the top ${x}…`;
  }
}
