import type { Patch } from '../core/diff';
import type { Op } from '../core/ops';
import type { GameState, PlayerId } from '../core/types';

export const PEER_PREFIX = 'cardtable-v1-';

export type ToHost = { t: 'hello'; name: string; playerId?: PlayerId } | { t: 'op'; op: Op };
export type ToClient =
  | { t: 'welcome'; playerId: PlayerId }
  | { t: 'state'; state: GameState }
  | { t: 'patch'; patch: Patch }
  | { t: 'ping' };

/** The host pings this often; a client that hears nothing for HEARTBEAT_TIMEOUT_MS reconnects. */
export const HEARTBEAT_MS = 3000;
// Generous: background tabs may delay timers.
export const HEARTBEAT_TIMEOUT_MS = 15000;

export type Status = 'connecting' | 'connected' | 'reconnecting';

/** What the UI talks to, whether this tab hosts the game or joined one. */
export interface Session {
  readonly role: 'host' | 'client';
  readonly code: string;
  readonly me: PlayerId | null;
  readonly status: Status;
  readonly error: string | null;
  /** The game as this player is allowed to see it. */
  getState(): GameState | null;
  dispatch(op: Op): void;
  subscribe(fn: () => void): () => void;
  close(): void;
}

/**
 * Drops `undefined` fields before sending. Binary serialization would turn them into `null`,
 * which then reads as a real value ("look at the top null cards").
 */
export function wire<T>(msg: T): T {
  return JSON.parse(JSON.stringify(msg));
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function makeCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export class Emitter {
  private subs = new Set<() => void>();
  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
  emit() {
    this.subs.forEach((fn) => fn());
  }
}
