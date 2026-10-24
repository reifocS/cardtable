import type { CardId, PlayerId, ZoneId } from '../core/types';

/** Where a ping points: a card, or a spot on a battlefield (stored coordinates). */
export interface PointTarget {
  card?: CardId;
  zone?: ZoneId;
  x?: number;
  y?: number;
}

export interface Ping extends PointTarget {
  id: number;
  by: PlayerId;
}

const PING_MS = 2200;

/**
 * Ephemeral "who's looking at what": the card each player hovers and short-lived pings.
 * Never part of the game state: not logged, not undoable, not saved.
 */
export class Presence {
  hovers: Record<PlayerId, CardId> = {};
  pings: Ping[] = [];
  private nextId = 1;

  constructor(private changed: () => void) {}

  setHover(by: PlayerId, card: CardId | null) {
    if ((this.hovers[by] ?? null) === card) return;
    const next = { ...this.hovers };
    if (card) next[by] = card;
    else delete next[by];
    this.hovers = next;
    this.changed();
  }

  addPing(by: PlayerId, target: PointTarget) {
    const ping: Ping = { ...target, id: this.nextId++, by };
    this.pings = [...this.pings, ping];
    this.changed();
    setTimeout(() => {
      this.pings = this.pings.filter((p) => p !== ping);
      this.changed();
    }, PING_MS);
  }

  forget(by: PlayerId) {
    this.setHover(by, null);
  }
}
