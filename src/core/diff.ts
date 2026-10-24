import type { Card, GameState, LogEntry, Player, Zone } from './types';

const META = ['version', 'preset', 'seats', 'turn', 'arrows', 'nextId'] as const;
type Meta = Pick<GameState, (typeof META)[number]>;

/** What changed between two views of the game. `null` means removed. */
export interface Patch {
  cards?: Record<string, Card | null>;
  zones?: Record<string, Zone | null>;
  players?: Record<string, Player | null>;
  /** New or edited log entries (merged lines are edited in place). */
  log?: LogEntry[];
  logLength: number;
  meta?: Partial<Meta>;
}

function diffRecord<T>(prev: Record<string, T>, next: Record<string, T>): Record<string, T | null> | undefined {
  const out: Record<string, T | null> = {};
  let changed = false;
  for (const [id, v] of Object.entries(next)) {
    if (!(id in prev) || JSON.stringify(prev[id]) !== JSON.stringify(v)) {
      out[id] = v;
      changed = true;
    }
  }
  for (const id of Object.keys(prev)) {
    if (!(id in next)) {
      out[id] = null;
      changed = true;
    }
  }
  return changed ? out : undefined;
}

function patchRecord<T>(base: Record<string, T>, changes: Record<string, T | null> | undefined): Record<string, T> {
  if (!changes) return base;
  const out = { ...base };
  for (const [id, v] of Object.entries(changes)) {
    if (v === null) delete out[id];
    else out[id] = v;
  }
  return out;
}

export function diffState(prev: GameState, next: GameState): Patch {
  const patch: Patch = { logLength: next.log.length };
  const cards = diffRecord(prev.cards, next.cards);
  const zones = diffRecord(prev.zones, next.zones);
  const players = diffRecord(prev.players, next.players);
  if (cards) patch.cards = cards;
  if (zones) patch.zones = zones;
  if (players) patch.players = players;

  const old = new Map(prev.log.map((l) => [l.id, JSON.stringify(l)]));
  const log = next.log.filter((l) => old.get(l.id) !== JSON.stringify(l));
  if (log.length) patch.log = log;

  const meta: Partial<Meta> = {};
  for (const key of META) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) Object.assign(meta, { [key]: next[key] });
  }
  if (Object.keys(meta).length) patch.meta = meta;
  return patch;
}

export function applyPatch(s: GameState, patch: Patch): GameState {
  let log = s.log;
  if (patch.log) {
    const edits = new Map(patch.log.map((l) => [l.id, l]));
    log = s.log.map((l) => edits.get(l.id) ?? l);
    const known = new Set(s.log.map((l) => l.id));
    log.push(...patch.log.filter((l) => !known.has(l.id)));
    log.sort((a, b) => a.id - b.id);
  }
  // Undo can shorten history; the host's length is the truth.
  if (log.length > patch.logLength) log = log.slice(log.length - patch.logLength);
  return {
    ...s,
    ...patch.meta,
    cards: patchRecord(s.cards, patch.cards),
    zones: patchRecord(s.zones, patch.zones),
    players: patchRecord(s.players, patch.players),
    log,
  };
}
