export type PlayerId = string;
export type CardId = string;
export type ZoneId = string;

/** One printable side of a card. Any game: an image, plain text, or both. */
export interface CardFace {
  name: string;
  image?: string;
  imageLarge?: string;
  /** Type line, e.g. "Basic Land — Plains". Used to filter when searching a zone. */
  type?: string;
  text?: string;
  /** Tokens (and emblems) this card makes, by card-database id. Kept on the first face. */
  tokens?: { id: string; name: string }[];
}

export interface Card {
  id: CardId;
  owner: PlayerId;
  zone: ZoneId;
  /** Empty when the viewer is not allowed to see this card. */
  faces: CardFace[];
  face: number;
  faceDown: boolean;
  /** Degrees. 90 = tapped. */
  rotation: number;
  /** Position on a free-form zone, in board units. */
  x: number;
  y: number;
  counters: Record<string, number>;
  /** Player ids, or '*' for everyone. Cleared when the card changes zone. */
  revealedTo: string[];
  token: boolean;
  /** Zone role the card returns to when its owner resets their deck. */
  home: string;
  /** Commander tax: extra cost for the next cast from the command zone. Survives zone changes. */
  tax?: number;
  /** The card this one is attached to (an aura, equipment…). It sits behind its host and moves with it. */
  attachedTo?: CardId;
}

/** pile: stacked, top = index 0. fan: spread out (a hand). free: positioned cards (a battlefield). */
export type ZoneKind = 'pile' | 'fan' | 'free';
/** public: everyone, owner: only the zone owner, hidden: nobody (a library). */
export type Visibility = 'public' | 'owner' | 'hidden';

export interface ZoneSpec {
  role: string;
  name: string;
  kind: ZoneKind;
  visibility: Visibility;
}

export interface Zone extends ZoneSpec {
  id: ZoneId;
  owner: PlayerId;
  cards: CardId[];
}

/** Describes a game: which zones each player gets and which counters they track. */
export interface Preset {
  id: string;
  name: string;
  zones: ZoneSpec[];
  trackers: Record<string, number>;
  handSize: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  trackers: Record<string, number>;
  connected: boolean;
  /** Commander damage taken, by source commander card id. */
  commanderDamage?: Record<string, number>;
}

/** A "this targets that" pointer between two cards or a card and a player. */
export interface Arrow {
  from: string;
  to: string;
  by: PlayerId;
}

export interface LogEntry {
  id: number;
  by: PlayerId | null;
  text: string;
  time: number;
  kind?: 'chat' | 'turn';
  /** Consecutive entries with the same key (life clicks, draws) are merged into one line. */
  merge?: { key: string; from: number; n?: number };
}

export interface GameState {
  version: 1;
  preset: Preset;
  seats: PlayerId[];
  players: Record<PlayerId, Player>;
  zones: Record<ZoneId, Zone>;
  cards: Record<CardId, Card>;
  turn: { player: PlayerId | null; number: number };
  arrows: Arrow[];
  log: LogEntry[];
  nextId: number;
}
