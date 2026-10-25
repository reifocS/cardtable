import type React from 'react';

/** Built-in playmats, drawn in CSS (see .mat-* in styles.css). */
export const PLAYMATS = [
  { id: 'felt', name: 'Felt' },
  { id: 'futuristic', name: 'Futuristic' },
  { id: 'medieval', name: 'Medieval' },
  { id: 'arcane', name: 'Arcane' },
  { id: 'stone', name: 'Stone' },
] as const;

const PREF_KEY = 'cardtable:playmat';

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
