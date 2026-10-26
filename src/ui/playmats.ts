import type React from 'react';
import { ARCANE } from './shaders/arcane';
import deskPropsA from './shaders/desk-props-a.webp';
import deskPropsB from './shaders/desk-props-b.webp';
import deskPropsC from './shaders/desk-props-c.webp';
import deskPropsD from './shaders/desk-props-d.webp';
import deskWood from './shaders/desk-wood.jpg';
import { FELT } from './shaders/felt';
import { FUTURISTIC } from './shaders/futuristic';
import mordorHeat from './shaders/mordor-heat.jpg';
import mordorRock from './shaders/mordor-rock.jpg';
import { MORDOR } from './shaders/mordor';
import { STORM } from './shaders/storm';
import { TAVERN } from './shaders/tavern';

/** Built-in playmats, drawn in CSS (see .mat-* in styles.css). */
export const PLAYMATS = [
  { id: 'felt', name: 'Felt' },
  { id: 'futuristic', name: 'Futuristic' },
  { id: 'tavern', name: 'Tavern' },
  { id: 'arcane', name: "Wizard's desk" },
  { id: 'storm', name: 'Stormy sea' },
  { id: 'mordor', name: 'Mordor' },
] as const;

/** Built-in sleeves (card backs), drawn in CSS (see .sleeve-* in styles.css). */
export const SLEEVES = [
  { id: 'official', name: 'Official' },
  { id: 'classic', name: 'Classic' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'crimson', name: 'Crimson' },
  { id: 'emerald', name: 'Emerald' },
  { id: 'circuit', name: 'Circuit' },
] as const;

const PREF_KEY = 'cardtable:playmat';
const STILL_KEY = 'cardtable:stillMats';
const SLEEVE_KEY = 'cardtable:sleeve';

/** Themes that were renamed, as saved games and preferences may still name them. */
const RENAMED: Record<string, string> = { medieval: 'tavern' };

/** The current id of a built-in playmat (or the value itself: another theme, a custom image). */
export const matId = (mat: string) => RENAMED[mat] ?? mat;

/** Class and style that paint a playmat: a theme, or a custom image under a dark veil. */
export function matLook(mat: string | undefined): { className: string; style?: React.CSSProperties } {
  if (mat?.startsWith('url:')) {
    const url = mat.slice(4);
    return {
      className: 'mat mat-image',
      style: { backgroundImage: `linear-gradient(#0007, #0007), url("${url}")` },
    };
  }
  const id = mat && PLAYMATS.some((m) => m.id === matId(mat)) ? matId(mat) : 'felt';
  return { className: `mat mat-${id}` };
}

/** Playmats painted live by a fragment shader (see ShaderMat); their CSS look is the fallback. */
const SHADERS: Record<string, { fragment: string; moving: boolean; textures?: Record<string, string> }> = {
  felt: { fragment: FELT, moving: false },
  futuristic: { fragment: FUTURISTIC, moving: true },
  tavern: { fragment: TAVERN, moving: true },
  arcane: { fragment: ARCANE, moving: true, textures: { uWood: deskWood, uPropsA: deskPropsA, uPropsB: deskPropsB, uPropsC: deskPropsC, uPropsD: deskPropsD } },
  storm: { fragment: STORM, moving: true },
  mordor: { fragment: MORDOR, moving: true, textures: { uRock: mordorRock, uHeat: mordorHeat } },
};

/** The shader for a playmat: unknown themes are felt, as in matLook; custom images have none. */
export function matShader(mat: string | undefined) {
  if (mat?.startsWith('url:')) return undefined;
  return SHADERS[mat ? matId(mat) : 'felt'] ?? SHADERS.felt;
}

/** Class and style for a card back in a player's sleeves (default: the official back). */
export function sleeveLook(sleeve: string | undefined): { className: string; style?: React.CSSProperties } {
  if (sleeve?.startsWith('url:')) return { className: 'sleeve-image', style: { '--sleeve-image': `url("${sleeve.slice(4)}")` } as React.CSSProperties };
  if (sleeve === 'classic') return { className: '' };
  // Until a player picks sleeves, their cards show the game's own back.
  return { className: `sleeve-${SLEEVES.some((x) => x.id === sleeve) ? sleeve : 'official'}` };
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
    const mat = localStorage.getItem(PREF_KEY);
    return mat && matId(mat);
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

/** Playmat animations are a viewer's comfort setting: on unless this browser turned them off. */
export function matsAnimated(): boolean {
  try {
    return localStorage.getItem(STILL_KEY) !== '1';
  } catch {
    return true;
  }
}

export function setMatsAnimated(on: boolean) {
  document.documentElement.classList.toggle('mats-still', !on);
  try {
    if (on) localStorage.removeItem(STILL_KEY);
    else localStorage.setItem(STILL_KEY, '1');
  } catch {
    // Applies until the page reloads.
  }
}

document.documentElement.classList.toggle('mats-still', !matsAnimated());
