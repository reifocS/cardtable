import type { Patch } from '../core/diff';
import type { Op } from '../core/ops';
import type { CardId, GameState, PlayerId } from '../core/types';
import type { Ping, PointTarget } from './presence';

export const PEER_PREFIX = 'cardtable-v1-';

/**
 * Sync protocol. Every state or patch carries the version `v` it produces; a patch also names the
 * `base` it applies to. A client that sees a gap (or a ping announcing a newer `v`) asks for a
 * resync and gets the full state again, so it is either exactly in step with the host or knows
 * it isn't.
 */
export type ToHost =
  | { t: 'hello'; name: string; playerId?: PlayerId }
  | { t: 'op'; op: Op }
  | { t: 'resync' }
  // Presence: ephemeral, relayed by the host to everyone else.
  | { t: 'hover'; card: CardId | null }
  | { t: 'point'; target: PointTarget };
export type ToClient =
  | { t: 'welcome'; playerId: PlayerId }
  /** The table has no seat left: the guest should stop trying. */
  | { t: 'full' }
  | { t: 'state'; state: GameState; v: number }
  | { t: 'patch'; patch: Patch; base: number; v: number }
  | { t: 'ping'; v: number }
  | { t: 'hover'; by: PlayerId; card: CardId | null }
  | { t: 'point'; by: PlayerId; target: PointTarget };

/** The host pings this often; a client that hears nothing for HEARTBEAT_TIMEOUT_MS reconnects. */
export const HEARTBEAT_MS = 3000;
// Generous: background tabs may delay timers.
export const HEARTBEAT_TIMEOUT_MS = 15000;

export type Status = 'connecting' | 'connected' | 'reconnecting';
export type Route = 'direct' | 'relay' | null;

/** What the UI talks to, whether this tab hosts the game or joined one. */
export interface Session {
  readonly role: 'host' | 'client';
  readonly code: string;
  readonly me: PlayerId | null;
  readonly status: Status;
  readonly error: string | null;
  /** How this client reaches the host. Null for the host itself, or until known. */
  readonly route: Route;
  /** The game as this player is allowed to see it. */
  getState(): GameState | null;
  dispatch(op: Op): void;
  /** Card each other player is hovering, and live pings. */
  readonly hovers: Record<PlayerId, CardId>;
  readonly pings: Ping[];
  /** Share the card I'm hovering (only public cards should be passed). */
  hover(card: CardId | null): void;
  point(target: PointTarget): void;
  /** Seats this browser plays (host only; more than one in two-seat practice). */
  readonly controlled?: PlayerId[];
  addSeat?(name: string): PlayerId;
  switchSeat?(id: PlayerId): void;
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
