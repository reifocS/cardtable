import { parseDeck } from './deckParser';

const KEY = 'cardtable:decks';
const LAST_KEY = 'cardtable:lastDeck';

export interface SavedDeck {
  name: string;
  text: string;
  savedAt: number;
}

/** Decklists saved in this browser, most recent first. */
export function listDecks(): SavedDeck[] {
  try {
    const decks = JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedDeck[];
    return decks.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function write(decks: SavedDeck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks));
  } catch {
    // Storage full or blocked: saving decks is a convenience, the import still works.
  }
}

/** Saves under `name`, replacing a deck with the same name. */
export function saveDeck(name: string, text: string): SavedDeck[] {
  const decks = listDecks().filter((d) => d.name !== name);
  write([{ name, text, savedAt: Date.now() }, ...decks]);
  return listDecks();
}

export function deleteDeck(name: string): SavedDeck[] {
  write(listDecks().filter((d) => d.name !== name));
  return listDecks();
}

/** A sensible default name: the commander, else the most played non-basic card. */
export function guessDeckName(text: string): string {
  const lines = parseDeck(text);
  const commander = lines.find((l) => l.section === 'commander');
  if (commander) return commander.name;
  const basics = /^(snow-covered )?(plains|island|swamp|mountain|forest|wastes)$/i;
  const main = lines.filter((l) => l.section === 'main' && !basics.test(l.name)).sort((a, b) => b.count - a.count);
  return main[0]?.name ?? 'My deck';
}

/** The list last imported in this browser. */
export const loadLastDeck = () => localStorage.getItem(LAST_KEY) ?? '';

export function saveLastDeck(text: string) {
  try {
    localStorage.setItem(LAST_KEY, text);
  } catch {
    // Same as above: a convenience.
  }
}

/** Edits the last imported list, and the saved decks it came from. */
export function editLastDeck(edit: (text: string) => string) {
  const old = loadLastDeck();
  const text = old && edit(old);
  if (!text || text === old) return;
  saveLastDeck(text);
  write(listDecks().map((d) => (d.text === old ? { ...d, text } : d)));
}
