/**
 * The bits of Magic's rules the engine applies by itself, read from a card's Oracle text with fixed
 * patterns. Only unconditional wordings count: "This land enters tapped." does, "…enters tapped
 * unless you control a Forest." doesn't. A wording the patterns don't know is left to the players.
 */
import type { CardFace } from './types';

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Sentences of the rules text, reminder text left out. */
function sentences(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, '')
    .split(/(?<=[.!])\s+|\n/)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

/** How the card calls itself: "This creature", its name, or a legend's short name ("Ezuri"). */
function selfPattern(name: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const short = name.split(',')[0];
  return `(?:this [a-z]+(?: [a-z]+)?|${esc(name)}${short !== name ? `|${esc(short)}` : ''})`;
}

export function entersTapped(face: CardFace): boolean {
  if (!face.text) return false;
  const re = new RegExp(`^${selfPattern(face.name)} enters(?: the battlefield)? tapped$`, 'i');
  return sentences(face.text).some((s) => re.test(s));
}

/** Counters it enters with: "enters with two +1/+1 counters on it", loyalty, defense, a Saga's first lore counter. */
export function entersWithCounters(face: CardFace): Record<string, number> {
  const out: Record<string, number> = {};
  if (face.loyalty) out.Loyalty = face.loyalty;
  if (face.defense) out.Defense = face.defense;
  if (/\bsaga\b/i.test(face.type ?? '')) out.Lore = 1;
  if (face.text) {
    const re = new RegExp(`^${selfPattern(face.name)} enters(?: the battlefield)? with (\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) ([+-]\\d+/[+-]\\d+|[a-z]+) counters? on it$`, 'i');
    for (const s of sentences(face.text)) {
      const m = re.exec(s);
      if (!m) continue;
      const n = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
      const kind = /^[+-]/.test(m[2]) ? m[2] : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
      if (n > 0) out[kind] = (out[kind] ?? 0) + n;
    }
  }
  return out;
}

/** "Mana Vault doesn't untap during your untap step." */
export function staysTapped(face: CardFace): boolean {
  if (!face.text) return false;
  const re = new RegExp(`^${selfPattern(face.name)} doesn't untap during your untap step$`, 'i');
  return sentences(face.text).some((s) => re.test(s));
}

export interface LoyaltyAbility {
  /** As printed: "+1", "−3", "0", "−X". */
  cost: string;
  /** Change to loyalty; null for X. */
  delta: number | null;
  text: string;
}

/** A planeswalker's loyalty abilities, one per line: "+1: Draw a card." */
export function loyaltyAbilities(face: CardFace): LoyaltyAbility[] {
  if (!face.text || !/\bplaneswalker\b/i.test(face.type ?? '')) return [];
  const out: LoyaltyAbility[] = [];
  for (const line of face.text.split('\n')) {
    const m = /^\s*([+−-]?)(\d+|X): (.+)$/.exec(line);
    if (!m) continue;
    const sign = m[1] === '+' ? 1 : m[1] ? -1 : m[2] === '0' ? 0 : 1;
    const delta = m[2] === 'X' ? null : sign * Number(m[2]);
    out.push({ cost: `${m[1] === '-' ? '−' : m[1]}${m[2]}`, delta, text: m[3].trim() });
  }
  return out;
}
