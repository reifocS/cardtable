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
 *   2 Pikachu | https://example.com/pikachu.png   (any game, image by URL)
 *   https://example.com/card.png
 */
export function parseDeck(text: string): DeckLine[] {
  const out: DeckLine[] = [];
  let section: Section | 'skip' = 'main';
  let sawHeader = false;

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) {
      if (!sawHeader && section === 'main' && out.length) section = 'side';
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;

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
  return out;
}
