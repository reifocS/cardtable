/**
 * How a counter reads on a card. Power/toughness counters add up ("-1/-1" ×2 → "-2/-2"); others
 * show their count, with "×" when the name itself ends in a digit so the two can't run together.
 */
export function formatCounter(key: string, n: number): string {
  const pt = key.match(/^([+-])(\d+)\/([+-])(\d+)$/);
  if (pt) {
    const part = (sign: string, v: string) => `${sign === '-' ? '−' : '+'}${Number(v) * n}`;
    return `${part(pt[1], pt[2])}/${part(pt[3], pt[4])}`;
  }
  return /\d$/.test(key) ? `${key} ×${n}` : `${key} ${n}`;
}
