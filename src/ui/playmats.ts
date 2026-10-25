import type React from 'react';

/** Built-in playmats, drawn in CSS (see .mat-* in styles.css). */
export const PLAYMATS = [
  { id: 'felt', name: 'Felt' },
  { id: 'futuristic', name: 'Futuristic' },
  { id: 'medieval', name: 'Medieval' },
  { id: 'arcane', name: 'Arcane' },
  { id: 'stone', name: 'Stone' },
] as const;

/** Built-in sleeves (card backs), drawn in CSS (see .sleeve-* in styles.css). */
export const SLEEVES = [
  { id: 'classic', name: 'Classic' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'crimson', name: 'Crimson' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'circuit', name: 'Circuit' },
] as const;

const PREF_KEY = 'cardtable:playmat';
const SLEEVE_KEY = 'cardtable:sleeve';

/** Class and style that paint a playmat: a theme, or a custom image under a dark veil. */
export function matLook(mat: string | undefined): { className: string; style?: React.CSSProperties } {
  if (mat?.startsWith('url:')) {
    const url = mat.slice(4);
    return {
      className: 'mat mat-image',
      style: { backgroundImage: `linear-gradient(#0007, #0007), url("${url}")` },
    };
  }
  const id = PLAYMATS.some((m) => m.id === mat) ? mat : 'felt';
  return { className: `mat mat-${id}` };
}

/** Class and style for a card back in a player's sleeves (default: classic). */
export function sleeveLook(sleeve: string | undefined): { className: string; style?: React.CSSProperties } {
  if (sleeve?.startsWith('url:')) return { className: 'sleeve-image', style: { '--sleeve-image': `url("${sleeve.slice(4)}")` } as React.CSSProperties };
  return { className: SLEEVES.some((x) => x.id === sleeve) && sleeve !== 'classic' ? `sleeve-${sleeve}` : '' };
}

export function loadSleevePref(): string | null {
  try {
    return localStorage.getItem(SLEEVE_KEY);
  } catch {
    return null;
  }
}

export function saveSleevePref(sleeve: string) {
  try {
    localStorage.setItem(SLEEVE_KEY, sleeve);
  } catch {
    // Not remembered across tables; it still applies here.
  }
}

/** My preferred playmat, applied to every table I sit at. */
export function loadPlaymatPref(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

export function savePlaymatPref(mat: string) {
  try {
    localStorage.setItem(PREF_KEY, mat);
  } catch {
    // Not remembered across tables; it still applies here.
  }
}
