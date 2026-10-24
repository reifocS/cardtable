import { BOARD_H, BOARD_W, CARD_H, CARD_W, zoneId } from './state';
import type { Card, CardFace, CardId, GameState, PlayerId, Zone, ZoneId } from './types';
import { isPublic } from './visibility';

export type Op =
  | {
      type: 'move';
      cards: CardId[];
      to: ZoneId;
      /** Insertion index; -1 = end (bottom of a pile). Default: top of piles, end of other zones. */
      index?: number;
      positions?: Record<CardId, [number, number]>;
      faceDown?: boolean;
    }
  | { type: 'moveTop'; from: ZoneId; to: ZoneId; n: number; faceDown?: boolean }
  | { type: 'tap'; cards: CardId[]; value?: boolean }
  | { type: 'untapAll' }
  | { type: 'flip'; cards: CardId[] }
  | { type: 'transform'; cards: CardId[] }
  | { type: 'counter'; cards: CardId[]; key: string; delta: number }
  | { type: 'shuffle'; zone: ZoneId }
  | { type: 'peek'; zone: ZoneId; n?: number }
  | { type: 'unpeek'; zone: ZoneId }
  | { type: 'reveal'; cards: CardId[]; to: string }
  | { type: 'hide'; cards: CardId[] }
  | { type: 'tracker'; player: PlayerId; key: string; delta: number }
  | { type: 'setTracker'; player: PlayerId; key: string; value: number | null }
  | { type: 'commanderTax'; cards: CardId[]; delta: number }
  /** Commander damage is also damage: it lowers Life by the same amount. */
  | { type: 'commanderDamage'; player: PlayerId; from: CardId; delta: number }
  | { type: 'create'; zone: ZoneId; cards: CardFace[][]; token: boolean; positions?: [number, number][] }
  | { type: 'delete'; cards: CardId[] }
  | { type: 'loadDeck'; main: CardFace[][]; side: CardFace[][]; commander: CardFace[][] }
  | { type: 'resetDeck' }
  | { type: 'mulligan'; n?: number }
  | { type: 'roll'; sides: number }
  | { type: 'passTurn' }
  /** Hand the turn to a player ('random': the host picks). `restart` starts over at turn 1. */
  | { type: 'setTurn'; player: PlayerId | 'random'; restart?: boolean }
  | { type: 'arrow'; from: string; to: string }
  | { type: 'clearArrows' }
  | { type: 'rename'; name: string }
  | { type: 'chat'; text: string }
  | { type: 'undo' };

/** Ops a client can safely predict locally before the host confirms. */
export const OPTIMISTIC = new Set<Op['type']>(['move', 'tap', 'untapAll', 'flip', 'counter', 'tracker']);

const MAX_LOG = 300;
const MERGE_WINDOW_MS = 5000;

/** Returns a new state with `op` applied by `actor`. Never mutates `prev`. */
export function apply(prev: GameState, actor: PlayerId, op: Op, rng: () => number = Math.random): GameState {
  const s = structuredClone(prev);
  new Mutation(s, actor, rng).run(op);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  return s;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cardName(c: Card): string {
  return c.faces[c.face]?.name ?? c.faces[0]?.name ?? 'a card';
}

function listLabel(labels: (string | null)[]): string {
  const n = labels.length;
  if (labels.every((l) => l === null)) return n === 1 ? 'a card' : `${n} cards`;
  if (n > 3) return `${n} cards`;
  return labels.map((l) => l ?? 'a card').join(', ');
}

class Mutation {
  constructor(
    private s: GameState,
    private actor: PlayerId,
    private rng: () => number,
  ) {}

  run(op: Op) {
    const s = this.s;
    switch (op.type) {
      case 'move':
        return this.move(op.cards, op.to, op);
      case 'moveTop': {
        const from = this.zone(op.from);
        const to = this.zone(op.to);
        const ids = from.cards.slice(0, Math.max(0, op.n));
        if (!ids.length) return;
        const isDraw = from.role === 'library' && to.role === 'hand' && to.owner === from.owner;
        this.move(ids, to.id, { faceDown: op.faceDown }, isDraw);
        if (isDraw) {
          const key = `draw:${to.id}`;
          const n = (this.mergeable(key)?.n ?? 0) + ids.length;
          this.log(`drew ${n === 1 ? 'a card' : `${n} cards`}`, { merge: { key, n } });
        }
        return;
      }
      case 'tap': {
        const cards = this.cards(op.cards);
        if (!cards.length) return;
        const value = op.value ?? cards.some((c) => c.rotation === 0);
        for (const c of cards) c.rotation = value ? 90 : 0;
        return this.log(`${value ? 'tapped' : 'untapped'} ${this.label(cards)}`);
      }
      case 'untapAll': {
        const bf = this.s.zones[zoneId(this.actor, 'battlefield')];
        if (!bf) return;
        for (const id of bf.cards) s.cards[id].rotation = 0;
        return this.log('untapped all permanents', { merge: { key: 'untapAll' } });
      }
      case 'flip': {
        const cards = this.cards(op.cards);
        if (!cards.length) return;
        for (const c of cards) c.faceDown = !c.faceDown;
        const down = cards.every((c) => c.faceDown);
        return this.log(down ? `turned ${listLabel(cards.map(() => null))} face down` : `turned ${this.label(cards)} face up`);
      }
      case 'transform': {
        const cards = this.cards(op.cards);
        for (const c of cards) c.face = (c.face + 1) % Math.max(1, c.faces.length);
        return this.log(`transformed into ${this.label(cards)}`);
      }
      case 'counter': {
        const cards = this.cards(op.cards);
        if (!cards.length || !op.key) return;
        for (const c of cards) {
          const v = (c.counters[op.key] ?? 0) + op.delta;
          if (v > 0) c.counters[op.key] = v;
          else delete c.counters[op.key];
        }
        const v = cards[0].counters[op.key] ?? 0;
        return this.log(`${this.label(cards)}: ${op.key} counters → ${v}`, { merge: { key: `counter:${op.cards.join(',')}:${op.key}` } });
      }
      case 'shuffle': {
        const z = this.zone(op.zone);
        for (let i = z.cards.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [z.cards[i], z.cards[j]] = [z.cards[j], z.cards[i]];
        }
        for (const id of z.cards) s.cards[id].revealedTo = [];
        return this.log(`shuffled ${this.zoneLabel(z)}`);
      }
      case 'peek': {
        const z = this.zone(op.zone);
        const ids = op.n == null ? z.cards : z.cards.slice(0, op.n);
        for (const id of ids) {
          const c = s.cards[id];
          if (!c.revealedTo.includes(this.actor)) c.revealedTo.push(this.actor);
        }
        if (z.visibility === 'public' || (z.visibility === 'owner' && z.owner === this.actor)) return;
        return this.log(op.n == null ? `is searching ${this.zoneLabel(z)}` : `looked at the top ${ids.length} of ${this.zoneLabel(z)}`);
      }
      case 'unpeek': {
        const z = this.zone(op.zone);
        for (const id of z.cards) {
          const c = s.cards[id];
          c.revealedTo = c.revealedTo.filter((p) => p !== this.actor);
        }
        return;
      }
      case 'reveal': {
        const cards = this.cards(op.cards);
        if (!cards.length) return;
        for (const c of cards) if (!c.revealedTo.includes(op.to)) c.revealedTo.push(op.to);
        if (op.to === '*') return this.log(`revealed ${this.label(cards)}`);
        return this.log(`revealed ${listLabel(cards.map(() => null))} to ${this.playerName(op.to)}`);
      }
      case 'hide':
        for (const c of this.cards(op.cards)) c.revealedTo = [];
        return;
      case 'tracker': {
        const p = s.players[op.player];
        if (!p) return;
        const from = p.trackers[op.key] ?? 0;
        p.trackers[op.key] = from + op.delta;
        const key = `tracker:${op.player}:${op.key}`;
        const start = this.mergeable(key)?.from ?? from;
        const who = op.player === this.actor ? '' : `${p.name}'s `;
        return this.log(`${who}${op.key}: ${start} → ${p.trackers[op.key]}`, { merge: { key, from: start } });
      }
      case 'setTracker': {
        const p = s.players[op.player];
        if (!p || !op.key) return;
        if (op.value === null) delete p.trackers[op.key];
        else p.trackers[op.key] = op.value;
        return;
      }
      case 'commanderTax': {
        const cards = this.cards(op.cards);
        for (const c of cards) c.tax = Math.max(0, (c.tax ?? 0) + op.delta);
        if (!cards.length) return;
        return this.log(`${this.label(cards)}: commander tax → ${cards[0].tax}`, { merge: { key: `tax:${op.cards.join(',')}` } });
      }
      case 'commanderDamage': {
        const p = s.players[op.player];
        const src = s.cards[op.from];
        if (!p || !src || !op.delta) return;
        const dmg = (p.commanderDamage ??= {});
        const before = dmg[op.from] ?? 0;
        const total = Math.max(0, before + op.delta);
        const applied = total - before;
        dmg[op.from] = total;
        if ('Life' in p.trackers) p.trackers.Life -= applied;
        const key = `cmd:${op.player}:${op.from}`;
        const start = this.mergeable(key)?.from ?? p.trackers.Life + applied;
        const life = 'Life' in p.trackers ? ` · Life ${start} → ${p.trackers.Life}` : '';
        return this.log(`${cardName(src)} → ${p.name}: ${total} commander damage${total >= 21 ? ' (lethal)' : ''}${life}`, {
          merge: { key, from: start },
        });
      }
      case 'create': {
        const z = this.zone(op.zone);
        const created = op.cards.map((faces, i) => this.newCard(faces, z, op.token, op.positions?.[i]));
        return this.log(`created ${this.label(created)}`);
      }
      case 'delete': {
        const cards = this.cards(op.cards);
        if (!cards.length) return;
        const label = this.label(cards);
        for (const c of cards) this.remove(c);
        return this.log(`removed ${label}`);
      }
      case 'loadDeck': {
        for (const c of Object.values(s.cards)) if (c.owner === this.actor) this.remove(c);
        const add = (list: CardFace[][], role: string) => {
          const z = s.zones[zoneId(this.actor, role)];
          if (z) for (const faces of list) this.newCard(faces, z, false, undefined, role);
        };
        add(op.main, 'library');
        add(op.side, 'sideboard');
        add(op.commander, 'command');
        this.resetTrackers(op.commander.length > 0);
        this.shuffleSilently('library');
        const extra = [op.side.length && `${op.side.length} in sideboard`, op.commander.length && `${op.commander.length} commander`].filter(Boolean);
        return this.log(`loaded a deck: ${op.main.length} cards${extra.length ? ` (${extra.join(', ')})` : ''}`);
      }
      case 'resetDeck': {
        let commander = false;
        for (const c of Object.values(s.cards)) {
          if (c.owner !== this.actor) continue;
          if (c.token) {
            this.remove(c);
            continue;
          }
          if (c.home === 'command') commander = true;
          this.move([c.id], zoneId(this.actor, c.home), { index: -1 }, true);
          Object.assign(c, { face: 0, faceDown: false, rotation: 0, counters: {}, revealedTo: [] });
          delete c.tax;
        }
        s.arrows = s.arrows.filter((a) => s.cards[a.from] || s.players[a.from]);
        this.resetTrackers(commander);
        this.shuffleSilently('library');
        return this.log('reset their deck');
      }
      case 'mulligan': {
        const hand = s.zones[zoneId(this.actor, 'hand')];
        const lib = s.zones[zoneId(this.actor, 'library')];
        if (!hand || !lib) return;
        const n = op.n ?? s.preset.handSize;
        this.move([...hand.cards], lib.id, {}, true);
        this.shuffleSilently('library');
        this.move(lib.cards.slice(0, n), hand.id, {}, true);
        return this.log(`mulliganed: shuffled their hand away and drew ${n}`);
      }
      case 'roll': {
        const sides = clamp(Math.floor(op.sides) || 6, 2, 1000);
        const v = 1 + Math.floor(this.rng() * sides);
        return this.log(sides === 2 ? `flipped a coin: ${v === 1 ? 'heads' : 'tails'}` : `rolled a d${sides}: ${v}`);
      }
      case 'passTurn': {
        const i = s.seats.indexOf(s.turn.player ?? '');
        s.turn.player = s.seats[(i + 1) % s.seats.length] ?? null;
        s.turn.number++;
        s.arrows = [];
        const p = s.turn.player ? s.players[s.turn.player] : null;
        return this.log(`Turn ${s.turn.number}: ${p?.name ?? '?'}`, { kind: 'turn' });
      }
      case 'setTurn': {
        const pid = op.player === 'random' ? s.seats[Math.floor(this.rng() * s.seats.length)] : op.player;
        const p = pid ? s.players[pid] : undefined;
        if (!p) return;
        s.turn.player = p.id;
        if (op.restart) s.turn.number = 1;
        s.arrows = [];
        const how = op.player === 'random' ? ' (picked at random)' : '';
        return this.log(op.restart ? `${p.name} goes first${how}` : `Turn ${s.turn.number}: ${p.name}`, { kind: 'turn' });
      }
      case 'arrow': {
        if (op.from === op.to || !this.exists(op.from) || !this.exists(op.to)) return;
        s.arrows.push({ from: op.from, to: op.to, by: this.actor });
        return this.log(`${this.targetLabel(op.from)} → ${this.targetLabel(op.to)}`);
      }
      case 'clearArrows':
        s.arrows = [];
        return;
      case 'rename': {
        const p = s.players[this.actor];
        const name = op.name.trim().slice(0, 32);
        if (!p || !name || name === p.name) return;
        this.log(`is now called ${name}`);
        p.name = name;
        return;
      }
      case 'chat': {
        const text = op.text.trim().slice(0, 500);
        if (text) this.log(text, { kind: 'chat' });
        return;
      }
      case 'undo':
        return; // handled by the engine, which keeps history
    }
  }

  // ---- helpers -------------------------------------------------------------

  private zone(id: ZoneId): Zone {
    const z = this.s.zones[id];
    if (!z) throw new Error(`Unknown zone ${id}`);
    return z;
  }

  private cards(ids: CardId[]): Card[] {
    return ids.map((id) => this.s.cards[id]).filter(Boolean);
  }

  private exists(id: string) {
    return !!(this.s.cards[id] || this.s.players[id]);
  }

  private playerName(id: PlayerId) {
    return this.s.players[id]?.name ?? '?';
  }

  private zoneLabel(z: Zone) {
    return z.owner === this.actor ? z.name : `${this.playerName(z.owner)}'s ${z.name}`;
  }

  /** Names of cards everyone can see, "a card" for the others. */
  private label(cards: Card[]) {
    return listLabel(cards.map((c) => (isPublic(c, this.s.zones[c.zone]) ? cardName(c) : null)));
  }

  private targetLabel(id: string) {
    const c = this.s.cards[id];
    return c ? this.label([c]) : this.playerName(id);
  }

  /** The merge info of the last log line, if `key` can still merge into it. */
  private mergeable(key: string) {
    const last = this.s.log[this.s.log.length - 1];
    return last?.merge?.key === key && last.by === this.actor && Date.now() - last.time < MERGE_WINDOW_MS ? last.merge : undefined;
  }

  private log(text: string, opts: { merge?: { key: string; from?: number; n?: number }; kind?: 'chat' | 'turn' } = {}) {
    const log = this.s.log;
    const { merge, kind } = opts;
    if (merge && this.mergeable(merge.key)) {
      const last = log[log.length - 1];
      last.text = text;
      last.time = Date.now();
      if (merge.n !== undefined) last.merge!.n = merge.n;
      return;
    }
    log.push({
      id: this.s.nextId++,
      by: this.actor,
      text,
      time: Date.now(),
      ...(kind && { kind }),
      ...(merge && { merge: { key: merge.key, from: merge.from ?? 0, ...(merge.n !== undefined && { n: merge.n }) } }),
    });
  }

  private autoPlace(k: number): [number, number] {
    // x is proportional on each screen (ui/fit.ts), so spread a row of slots across the full width:
    // they overlap a little on narrow boards and leave gaps on wide ones.
    const slots = 10;
    const step = (BOARD_W - CARD_W - 32) / (slots - 1);
    // Two rows: the top one (toward the middle of the table), then the bottom one.
    const row = Math.floor(k / slots) % 2;
    return [16 + (k % slots) * step, row * (BOARD_H - CARD_H)];
  }

  private newCard(faces: CardFace[], z: Zone, token: boolean, pos?: [number, number], home = 'library'): Card {
    const [x, y] = pos ?? this.autoPlace(z.cards.length);
    const card: Card = {
      id: `c${this.s.nextId++}`,
      owner: this.actor,
      zone: z.id,
      faces: faces.length ? faces : [{ name: 'Card' }],
      face: 0,
      faceDown: false,
      rotation: 0,
      x: clamp(x, 0, BOARD_W - CARD_W),
      y: clamp(y, 0, BOARD_H - CARD_H),
      counters: {},
      revealedTo: [],
      token,
      home,
    };
    this.s.cards[card.id] = card;
    if (z.kind === 'pile') z.cards.unshift(card.id);
    else z.cards.push(card.id);
    return card;
  }

  private remove(c: Card) {
    const z = this.s.zones[c.zone];
    if (z) z.cards = z.cards.filter((id) => id !== c.id);
    delete this.s.cards[c.id];
    this.s.arrows = this.s.arrows.filter((a) => a.from !== c.id && a.to !== c.id);
  }

  private resetTrackers(commander: boolean) {
    const p = this.s.players[this.actor];
    if (!p) return;
    p.trackers = { ...this.s.preset.trackers };
    p.commanderDamage = {};
    if (commander && 'Life' in p.trackers) p.trackers.Life = 40;
  }

  private shuffleSilently(role: string) {
    const z = this.s.zones[zoneId(this.actor, role)];
    if (!z) return;
    for (let i = z.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [z.cards[i], z.cards[j]] = [z.cards[j], z.cards[i]];
    }
  }

  private move(
    ids: CardId[],
    toId: ZoneId,
    opts: { index?: number; positions?: Record<CardId, [number, number]>; faceDown?: boolean },
    silent = false,
  ) {
    const to = this.zone(toId);
    const cards = this.cards(ids);
    if (!cards.length) return;
    const from = cards.map((c) => this.s.zones[c.zone]);
    const wasPublic = cards.map((c, i) => isPublic(c, from[i]));

    for (const c of cards) {
      const z = this.s.zones[c.zone];
      z.cards = z.cards.filter((id) => id !== c.id);
    }
    const before = to.cards.length;
    let index = opts.index ?? (to.kind === 'pile' ? 0 : before);
    if (index < 0 || index > before) index = before;
    to.cards.splice(index, 0, ...cards.map((c) => c.id));

    const taxed: Card[] = [];
    cards.forEach((c, i) => {
      const changed = c.zone !== to.id;
      // Leaving the command zone for the battlefield is how a commander gets cast here.
      if (changed && c.home === 'command' && from[i].role === 'command' && to.role === 'battlefield') {
        c.tax = (c.tax ?? 0) + 2;
        taxed.push(c);
      }
      c.zone = to.id;
      if (changed) c.revealedTo = [];
      if (to.kind === 'free') {
        const p = opts.positions?.[c.id] ?? (changed ? this.autoPlace(before + i) : undefined);
        if (p) {
          c.x = clamp(p[0], 0, BOARD_W - CARD_W);
          c.y = clamp(p[1], 0, BOARD_H - CARD_H);
        }
        if (opts.faceDown != null) c.faceDown = opts.faceDown;
        else if (changed && from[i].kind !== 'free') c.faceDown = false;
      } else if (changed) {
        Object.assign(c, { rotation: 0, counters: {}, faceDown: false, face: 0 });
      }
    });

    if (silent || from.every((z) => z.id === to.id)) return;
    const labels = cards.map((c, i) => (wasPublic[i] || isPublic(c, to) ? cardName(c) : null));
    const sources = [...new Set(from)];
    const fromLabel = sources.length === 1 ? this.zoneLabel(sources[0]) : 'several zones';
    const bottom = to.kind === 'pile' && opts.index === -1 ? ' (bottom)' : '';
    const tax = taxed.length ? ` (commander tax now ${taxed.map((c) => c.tax).join(', ')})` : '';
    this.log(`moved ${listLabel(labels)} from ${fromLabel} to ${this.zoneLabel(to)}${bottom}${tax}`);
  }
}
