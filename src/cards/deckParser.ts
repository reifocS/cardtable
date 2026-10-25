export type Section = 'main' | 'side' | 'commander';

export interface DeckLine {
  count: number;
  name: string;
  set?: string;
  cn?: string;
  /** Direct image URL: makes the card importable without any card database. */
  image?: string;
  section: Section;
}

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+\/{2,3}\s+/g, ' // ').trim();
/** Split and double-faced cards are only found by their front face name. */
export const frontName = (name: string) => name.split(/\s+\/{2,3}\s+/)[0];
const sameCard = (a: string, b: string) => norm(frontName(a)) === norm(frontName(b));

const HEADERS: Record<string, Section | 'skip'> = {
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  sideboard: 'side',
  side: 'side',
  commander: 'commander',
  commanders: 'commander',
  companion: 'side',
  maybeboard: 'skip',
  considering: 'skip',
  tokens: 'skip',
};

/**
 * Parses the common text decklist formats:
 *   4 Lightning Bolt
 *   4x Lightning Bolt (M10) 146 *F*
 *   SB: 2 Duress
 *   Sideboard / Commander headers, blank line before the sideboard (MTGO)
 *   1 [NPH] Jin-Gitaxias, Core Augur   (MWS; its set codes aren't Scryfall's, so they're dropped)
 *   Magic Ville's Apprentice export, HTML leftovers and all (its commander is the "SB:" line)
 *   2 Pikachu | https://example.com/pikachu.png   (any game, image by URL)
 *   https://example.com/card.png
 */
export function parseDeck(text: string): DeckLine[] {
  const out: DeckLine[] = [];
  let section: Section | 'skip' = 'main';
  let sawHeader = false;
  let commanderFormat = false;
  let magicVille = false;

  for (const raw of text.split(/\r?\n/)) {
    // Lists copied from a web page can carry <br /> tags and links ("Sauvegarder").
    let line = raw.replace(/<a\b[^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
    if (!line) {
      if (!sawHeader && section === 'main' && out.length) section = 'side';
      continue;
    }
    if (/^\/\/\s*format\s*:\s*commander/i.test(line)) commanderFormat = true;
    if (/^\/\/.*magic-ville\.com/i.test(line)) magicVille = true;
    if (line.startsWith('//') || line.startsWith('#')) continue;
    // Magic Ville's page ends the list with a save link, which survives a copy of the page as text.
    if (magicVille && /^(sauvegarder|save)$/i.test(line)) continue;

    const header = HEADERS[line.toLowerCase().replace(/[:\s]+$/, '').replace(/\s*\(\d+\)$/, '')];
    if (header) {
      section = header;
      sawHeader = true;
      continue;
    }
    if (section === 'skip') continue;

    let lineSection: Section = section;
    if (/^sb:\s*/i.test(line)) {
      lineSection = 'side';
      line = line.replace(/^sb:\s*/i, '');
    }

    let count = 1;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (m) {
      count = parseInt(m[1], 10);
      line = m[2];
    }
    if (count <= 0) continue;
    line = line.replace(/^\[[^\]]*\]\s*/, '');

    const url = line.match(/^(?:(.*?)\s*\|\s*)?(https?:\/\/\S+)$/);
    if (url) {
      const name = url[1]?.trim() || decodeURIComponent(url[2].split('/').pop()!.split('?')[0].replace(/\.\w+$/, '')) || 'Card';
      out.push({ count, name, image: url[2], section: lineSection });
      continue;
    }

    line = line.replace(/\s+\*[A-Z]+\*\s*$/, '').replace(/\s+#\S.*$/, '').trim();
    const setInfo = line.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★-]+))?$/);
    if (setInfo) {
      out.push({ count, name: setInfo[1], set: setInfo[2].toLowerCase(), cn: setInfo[3], section: lineSection });
    } else {
      out.push({ count, name: line, section: lineSection });
    }
  }
  // Apprentice files put a Commander deck's commander in the sideboard.
  if (commanderFormat && !out.some((l) => l.section === 'commander')) {
    for (const l of out) if (l.section === 'side') l.section = 'commander';
  }
  return out;
}

/** Points every line for `name` at one printing, keeping counts and sections. */
export function withPrinting(text: string, name: string, set: string, cn: string): string {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const [line] = parseDeck(raw);
      if (!line || line.image || !sameCard(line.name, name)) return raw;
      const sb = /^\s*sb:/i.test(raw) ? 'SB: ' : '';
      return `${sb}${line.count} ${line.name} (${set.toUpperCase()}) ${cn}`;
    })
    .join('\n');
}
