import type { GameState, PlayerId, Preset, Zone } from './types';

// Wide and short, like the space a battlefield actually gets on screen. Cards scale with it.
export const BOARD_W = 1300;
export const BOARD_H = 340;
export const CARD_W = 72;
export const CARD_H = 100;

export const MTG: Preset = {
  id: 'mtg',
  name: 'Magic: The Gathering',
  handSize: 7,
  trackers: { Life: 20 },
  zones: [
    { role: 'library', name: 'Library', kind: 'pile', visibility: 'hidden' },
    { role: 'hand', name: 'Hand', kind: 'fan', visibility: 'owner' },
    { role: 'battlefield', name: 'Battlefield', kind: 'free', visibility: 'public' },
    { role: 'graveyard', name: 'Graveyard', kind: 'pile', visibility: 'public' },
    { role: 'exile', name: 'Exile', kind: 'pile', visibility: 'public' },
    { role: 'command', name: 'Command', kind: 'pile', visibility: 'public' },
    { role: 'sideboard', name: 'Sideboard', kind: 'pile', visibility: 'owner' },
  ],
  // Spells being cast, in the middle where everyone sees them. Top (index 0) = last cast.
  shared: [{ role: 'stack', name: 'Stack', kind: 'pile', visibility: 'public', verb: 'cast' }],
  parts: { deck: 'library', hand: 'hand', play: 'battlefield', discard: 'graveyard' },
  deckSections: { main: 'library', side: 'sideboard', commander: 'command' },
  commander: { zone: 'command', tax: 2, tracker: 'Life', life: 40, lethal: 21 },
};

/** Owner of the table's shared zones. */
export const TABLE = 'table';

const COLORS = ['#e8a33d', '#4fa3e0', '#d0605e', '#5dbb7a', '#a67fd6', '#d98bb5', '#4cc2c0', '#c7b65a'];

export function createGame(preset: Preset = MTG): GameState {
  return migrateGame({
    version: 1,
    preset,
    seats: [],
    players: {},
    zones: {},
    cards: {},
    turn: { player: null, number: 1 },
    arrows: [],
    log: [],
    nextId: 1,
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Brings a saved game up to date with its preset: the built-in one is refreshed (old saves pick up
 * its new zones and rules), missing shared zones are added, zones take their spec's latest fields.
 * Returns the same object if nothing changed.
 */
export function migrateGame(s: GameState): GameState {
  const preset = s.preset.id === MTG.id && !same(s.preset, MTG) ? MTG : s.preset;
  let zones = s.zones;
  const put = (z: Zone) => {
    if (zones === s.zones) zones = { ...s.zones };
    zones[z.id] = z;
  };
  for (const spec of preset.shared ?? []) {
    const id = zoneId(TABLE, spec.role);
    if (!zones[id]) put({ ...spec, id, owner: TABLE, cards: [] });
  }
  for (const z of Object.values(zones)) {
    const spec = (z.owner === TABLE ? (preset.shared ?? []) : preset.zones).find((x) => x.role === z.role);
    if (spec && !same({ ...z, ...spec }, z)) put({ ...z, ...spec });
  }
  return zones === s.zones && preset === s.preset ? s : { ...s, preset, zones };
}

/** Mutates `s`. */
export function addPlayer(s: GameState, name: string): PlayerId {
  const id = `p${s.nextId++}`;
  s.players[id] = {
    id,
    name,
    color: COLORS[s.seats.length % COLORS.length],
    trackers: { ...s.preset.trackers },
    connected: true,
  };
  s.seats.push(id);
  for (const spec of s.preset.zones) {
    const zid = zoneId(id, spec.role);
    s.zones[zid] = { ...spec, id: zid, owner: id, cards: [] };
  }
  if (!s.turn.player) s.turn.player = id;
  return id;
}

export const zoneId = (player: PlayerId, role: string) => `${player}:${role}`;

export function zoneOf(s: GameState, player: PlayerId, role: string): Zone | undefined {
  return s.zones[zoneId(player, role)];
}
