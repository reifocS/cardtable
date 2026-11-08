/**
 * How the command palette matches what's typed: a name or an action, by its start, a word in it, every
 * word typed, or failing that its letters in order ("slrg" finds Sol Ring). A number at the end is a
 * count for the action ("scry 2"), not part of the name.
 */

/** How well `text` matches `query` (both any case): 0 for not at all, higher for better. */
export function score(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (t.startsWith(q)) return 100 - Math.min(t.length, 99) / 100;
  const at = t.indexOf(q);
  if (at > 0) return /[\s(·'’-]/.test(t[at - 1]) ? 70 : 50;
  const words = q.split(/\s+/);
  if (words.every((w) => t.includes(w))) return 30;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

/** Every word typed somewhere in `text`, in any order: how a name is found by where it is ("bolt graveyard"). */
export const hasWords = (text: string, query: string) => {
  const t = text.toLowerCase();
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => t.includes(w));
};

/** Letters in order are a last resort: once anything matches better, they're left out. */
export const CLOSE = 30;

/** What's typed, and the count it ends with if any: "scry 2" → { text: "scry", count: 2 }. */
export function withCount(query: string): { text: string; count: number | null } {
  const m = /^(.*\S)\s+(\d{1,3})$/.exec(query.trim());
  return m ? { text: m[1], count: Number(m[2]) } : { text: query.trim(), count: null };
}
