import { BOARD_H, BOARD_W, CARD_H, CARD_W, TABLE, zoneId } from './state';
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
  | { type: 'moveTop'; from: ZoneId; to: ZoneId; n: number; faceDown?: boolean; fromBottom?: boolean }
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
  /** Free text on cards; empty clears it. */
  | { type: 'annotate'; cards: CardId[]; text: string }
  /** New faces (another art, a corrected scan…) for your cards; `sameName` also changes every other card of yours with that name. */
  | { type: 'setFaces'; cards: CardId[]; faces: CardFace[]; sameName?: boolean }
  | { type: 'setTopVisible'; zone: ZoneId; value: 'owner' | 'all' | null }
  | { type: 'sortZone'; zone: ZoneId; by: 'name' | 'type' | 'cost' }
  /** Commander damage is also damage: it lowers the preset's commander tracker (Life) by the same amount. */
  | { type: 'commanderDamage'; player: PlayerId; from: CardId; delta: number }
  | { type: 'create'; zone: ZoneId; cards: CardFace[][]; token: boolean; positions?: [number, number][] }
  | { type: 'delete'; cards: CardId[] }
  /** Attach cards to a host on a battlefield, or detach them (`to: null`). */
  | { type: 'attach'; cards: CardId[]; to: CardId | null }
  /** Replaces your cards with a deck list, by section (see Preset.deckSections). */
  | { type: 'loadDeck'; sections: Record<string, CardFace[][]> }
  | { type: 'resetDeck' }
  | { type: 'mulligan'; n?: number }
  | { type: 'roll'; sides: number }
  /** A card picked by the host's RNG: discarded (see Preset.parts), or revealed to everyone. */
  | { type: 'random'; zone: ZoneId; action: 'discard' | 'reveal' }
  | { type: 'passTurn' }
  /** Hand the turn to a player ('random': the host picks). `restart` starts over at turn 1. */
  | { type: 'setTurn'; player: PlayerId | 'random'; restart?: boolean }
  | { type: 'arrow'; from: string; to: string }
  | { type: 'clearArrows' }
  | { type: 'removeArrow'; from: string; to: string }
  | { type: 'rename'; name: string }
  | { type: 'setPlaymat'; mat: string }
  | { type: 'setSleeve'; sleeve: string }
  | { type: 'chat'; text: string }
  | { type: 'undo' };

/** Ops a client can safely predict locally before the host confirms. */
export const OPTIMISTIC = new Set<Op['type']>(['move', 'tap', 'untapAll', 'flip', 'counter', 'tracker']);

const MAX_LOG = 300;
/** How far each attached card peeks out above its host, in board units. */
const ATTACH_DY = 22;
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
        const n0 = Math.max(0, op.n);
        const ids = op.fromBottom ? from.cards.slice(Math.max(0, from.cards.length - n0)) : from.cards.slice(0, n0);
        if (!ids.length) return;
        const { deck, hand } = s.preset.parts;
        const isDraw = !!deck && from.role === deck && to.role === hand && to.owner === from.owner;
        this.move(ids, to.id, { faceDown: op.faceDown }, isDraw);
        if (isDraw && op.fromBottom) {
          this.log(`drew ${ids.length === 1 ? 'a card' : `${ids.length} cards`} from the bottom`);
        } else if (isDraw) {
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
        const play = this.part('play');
        if (!play) return;
        for (const id of play.cards) s.cards[id].rotation = 0;
        return this.log(`untapped everything on ${this.zoneLabel(play)}`, { merge: { key: 'untapAll' } });
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
        const had = op.key in p.trackers;
        if (op.value === null) delete p.trackers[op.key];
        else p.trackers[op.key] = op.value;
        const who = op.player === this.actor ? '' : ` for ${p.name}`;
        if (op.value === null && had) return this.log(`removed the ${op.key} counter${who}`);
        if (op.value !== null && !had) return this.log(`added a ${op.key} counter${who}`);
        return;
      }
      case 'commanderTax': {
        if (!s.preset.commander) return;
        const cards = this.cards(op.cards);
        for (const c of cards) c.tax = Math.max(0, (c.tax ?? 0) + op.delta);
        if (!cards.length) return;
        return this.log(`${this.label(cards)}: commander tax → ${cards[0].tax}`, { merge: { key: `tax:${op.cards.join(',')}` } });
      }
      case 'annotate': {
        const cards = this.cards(op.cards);
        if (!cards.length) return;
        const text = op.text.trim().slice(0, 80);
        for (const c of cards) {
          if (text) c.note = text;
          else delete c.note;
        }
        return this.log(text ? `noted on ${this.label(cards)}: “${text}”` : `cleared the note on ${this.label(cards)}`);
      }
      case 'setFaces': {
        const picked = this.cards(op.cards).filter((c) => c.owner === this.actor);
        const faces = op.faces.slice(0, 4);
        if (!picked.length || !faces.length || faces.some((f) => typeof f?.name !== 'string')) return;
        // Copies are found here, not by the player: their hidden cards (the library) have no faces on their side.
        const names = new Set(picked.map((c) => c.faces[0]?.name));
        const cards = op.sameName ? Object.values(s.cards).filter((c) => c.owner === this.actor && names.has(c.faces[0]?.name)) : picked;
        for (const c of cards) {
          c.faces = faces.map((f) => ({ ...f }));
          c.face = Math.min(c.face, faces.length - 1);
        }
        const copies = cards.length > picked.length ? ` and ${cards.length - picked.length} other ${cards.length - picked.length > 1 ? 'copies' : 'copy'}` : '';
        return this.log(`changed the art of ${this.label(picked)}${copies}`);
      }
      case 'setTopVisible': {
        const z = this.zone(op.zone);
        if (op.value) z.topVisible = op.value;
        else delete z.topVisible;
        const what = op.value === 'all' ? 'reveals' : op.value === 'owner' ? 'looks at' : 'stops showing';
        return this.log(`${what} the top card of ${this.zoneLabel(z)}${op.value ? ' (stays face up)' : ''}`);
      }
      case 'sortZone': {
        const z = this.zone(op.zone);
        const face = (id: CardId) => s.cards[id].faces[0];
        const key = (id: CardId): string | number =>
          op.by === 'cost' ? (face(id)?.cost ?? 99) : op.by === 'type' ? (face(id)?.type ?? '~') : (face(id)?.name ?? '~');
        z.cards = [...z.cards].sort((a, b) => {
          const ka = key(a);
          const kb = key(b);
          if (ka < kb) return -1;
          if (ka > kb) return 1;
          return (face(a)?.name ?? '').localeCompare(face(b)?.name ?? '');
        });
        return this.log(`sorted ${this.zoneLabel(z)} by ${op.by}`);
      }
      case 'commanderDamage': {
        const rules = s.preset.commander;
        const p = s.players[op.player];
        const src = s.cards[op.from];
        if (!rules || !p || !src || !op.delta) return;
        const dmg = (p.commanderDamage ??= {});
        const before = dmg[op.from] ?? 0;
        const total = Math.max(0, before + op.delta);
        const applied = total - before;
        dmg[op.from] = total;
        const t = rules.tracker;
        const tracked = t in p.trackers;
        if (tracked) p.trackers[t] -= applied;
        const key = `cmd:${op.player}:${op.from}`;
        const start = this.mergeable(key)?.from ?? (p.trackers[t] ?? 0) + applied;
        const life = tracked ? ` · ${t} ${start} → ${p.trackers[t]}` : '';
        return this.log(`${cardName(src)} → ${p.name}: ${total} commander damage${total >= rules.lethal ? ' (lethal)' : ''}${life}`, {
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
      case 'attach': {
        const cards = this.cards(op.cards).filter((c) => c.id !== op.to);
        if (!cards.length) return;
        if (op.to === null) {
          for (const c of cards) delete c.attachedTo;
          return this.log(`detached ${this.label(cards)}`);
        }
        const host = s.cards[op.to];
        const zone = host && s.zones[host.zone];
        if (!host || zone?.kind !== 'free') return;
        // No loops: a host can't end up attached to its own attachment.
        if (host.attachedTo && op.cards.includes(host.attachedTo)) delete host.attachedTo;
        const others = cards.filter((c) => c.zone !== zone.id);
        if (others.length) this.move(others.map((c) => c.id), zone.id, {}, true);
        for (const c of cards) c.attachedTo = host.id;
        this.layoutAttachments(host);
        return this.log(`attached ${this.label(cards)} to ${this.label([host])}`);
      }
      case 'loadDeck': {
        for (const c of Object.values(s.cards)) if (c.owner === this.actor) this.remove(c);
        const counts = new Map<Zone, number>();
        for (const [section, list] of Object.entries(op.sections)) {
          const z = s.zones[zoneId(this.actor, s.preset.deckSections[section] ?? '')];
          if (!z || !list.length) continue;
          for (const faces of list) this.newCard(faces, z, false, undefined, z.role);
          counts.set(z, (counts.get(z) ?? 0) + list.length);
        }
        const deck = this.part('deck');
        this.resetTrackers(!!s.preset.commander && (counts.get(this.part('commander')!) ?? 0) > 0);
        this.shuffleSilently(deck);
        const main = (deck && counts.get(deck)) ?? 0;
        const extra = [...counts].filter(([z]) => z !== deck).map(([z, n]) => `${n} in ${z.name}`);
        return this.log(`loaded a deck: ${main} cards${extra.length ? ` (${extra.join(', ')})` : ''}`);
      }
      case 'resetDeck': {
        let commander = false;
        for (const c of Object.values(s.cards)) {
          if (c.owner !== this.actor) continue;
          if (c.token) {
            this.remove(c);
            continue;
          }
          if (c.home === s.preset.commander?.zone) commander = true;
          this.move([c.id], zoneId(this.actor, c.home), { index: -1 }, true);
          Object.assign(c, { face: 0, faceDown: false, rotation: 0, counters: {}, revealedTo: [] });
          delete c.tax;
          delete c.attachedTo;
          delete c.note;
        }
        s.arrows = s.arrows.filter((a) => s.cards[a.from] || s.players[a.from]);
        this.resetTrackers(commander);
        this.shuffleSilently(this.part('deck'));
        return this.log('reset their deck');
      }
      case 'mulligan': {
        const hand = this.part('hand');
        const lib = this.part('deck');
        if (!hand || !lib) return;
        const n = op.n ?? s.preset.handSize;
        this.move([...hand.cards], lib.id, {}, true);
        this.shuffleSilently(lib);
        this.move(lib.cards.slice(0, n), hand.id, {}, true);
        return this.log(`mulliganed: shuffled their hand away and drew ${n}`);
      }
      case 'random': {
        const z = this.zone(op.zone);
        if (!z.cards.length) return;
        const c = s.cards[z.cards[Math.floor(this.rng() * z.cards.length)]];
        if (op.action === 'reveal') {
          if (!c.revealedTo.includes('*')) c.revealedTo.push('*');
          return this.log(`revealed ${cardName(c)} at random from ${this.zoneLabel(z)}`);
        }
        const gy = s.zones[zoneId(c.owner, s.preset.parts.discard ?? '')];
        if (!gy) return;
        this.move([c.id], gy.id, {}, true);
        return this.log(`discarded ${cardName(c)} at random from ${this.zoneLabel(z)}`);
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
      case 'removeArrow': {
        const i = s.arrows.findIndex((a) => a.from === op.from && a.to === op.to);
        if (i >= 0) s.arrows.splice(i, 1);
        return;
      }
      case 'rename': {
        const p = s.players[this.actor];
        const name = op.name.trim().slice(0, 32);
        if (!p || !name || name === p.name) return;
        this.log(`is now called ${name}`);
        p.name = name;
        return;
      }
      case 'setPlaymat':
      case 'setSleeve': {
        const p = s.players[this.actor];
        const value = (op.type === 'setPlaymat' ? op.mat : op.sleeve).slice(0, 500);
        // Theme ids, or an https image: nothing else ends up in a style attribute.
        if (!p || !(/^[a-z-]{1,20}$/.test(value) || /^url:https:\/\/[^\s"'()]+$/.test(value))) return;
        if ((op.type === 'setPlaymat' ? p.playmat : p.sleeve) === value) return;
        if (op.type === 'setPlaymat') p.playmat = value;
        else p.sleeve = value;
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
    if (z.owner === TABLE) return `the ${z.name}`;
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

  private newCard(faces: CardFace[], z: Zone, token: boolean, pos?: [number, number], home = z.role): Card {
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

  private attachmentsOf(host: Card): Card[] {
    const z = this.s.zones[host.zone];
    return z ? z.cards.map((id) => this.s.cards[id]).filter((c) => c.attachedTo === host.id) : [];
  }

  /** Fans attachments out above their host (moving the host down if needed) and puts them behind it. */
  private layoutAttachments(host: Card) {
    const z = this.s.zones[host.zone];
    const atts = this.attachmentsOf(host);
    if (!z || !atts.length) return;
    host.y = clamp(Math.max(host.y, atts.length * ATTACH_DY), 0, BOARD_H - CARD_H);
    atts.forEach((a, k) => {
      a.x = host.x;
      a.y = host.y - (atts.length - k) * ATTACH_DY;
    });
    const ids = new Set(atts.map((a) => a.id));
    z.cards = z.cards.filter((id) => !ids.has(id));
    z.cards.splice(z.cards.indexOf(host.id), 0, ...atts.map((a) => a.id));
  }

  private remove(c: Card) {
    const z = this.s.zones[c.zone];
    if (z) z.cards = z.cards.filter((id) => id !== c.id);
    delete this.s.cards[c.id];
    for (const other of Object.values(this.s.cards)) if (other.attachedTo === c.id) delete other.attachedTo;
    this.s.arrows = this.s.arrows.filter((a) => a.from !== c.id && a.to !== c.id);
  }

  private resetTrackers(commander: boolean) {
    const p = this.s.players[this.actor];
    const rules = this.s.preset.commander;
    if (!p) return;
    p.trackers = { ...this.s.preset.trackers };
    p.commanderDamage = {};
    if (commander && rules && rules.tracker in p.trackers) p.trackers[rules.tracker] = rules.life;
  }

  /** The actor's zone for a part the preset names (or its commander zone). */
  private part(name: keyof GameState['preset']['parts'] | 'commander'): Zone | undefined {
    const role = name === 'commander' ? this.s.preset.commander?.zone : this.s.preset.parts[name];
    return role ? this.s.zones[zoneId(this.actor, role)] : undefined;
  }

  private shuffleSilently(z: Zone | undefined) {
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
    const rules = this.s.preset.commander;
    const moving = new Set(cards.map((c) => c.id));
    const hosts: Card[] = [];
    cards.forEach((c, i) => {
      const changed = c.zone !== to.id;
      // Moved without its host: it's no longer attached.
      if (c.attachedTo && !moving.has(c.attachedTo)) delete c.attachedTo;
      // Leaving the commander zone for play is how a commander gets cast here.
      if (rules && changed && c.home === rules.zone && from[i].role === rules.zone && to.role === this.s.preset.parts.play) {
        c.tax = (c.tax ?? 0) + rules.tax;
        taxed.push(c);
      }
      c.zone = to.id;
      if (changed) c.revealedTo = [];
      if (to.kind === 'free') {
        if (!changed) hosts.push(c);
        const p = opts.positions?.[c.id] ?? (changed ? this.autoPlace(before + i) : undefined);
        if (p) {
          c.x = clamp(p[0], 0, BOARD_W - CARD_W);
          c.y = clamp(p[1], 0, BOARD_H - CARD_H);
        }
        if (opts.faceDown != null) c.faceDown = opts.faceDown;
        else if (changed && from[i].kind !== 'free') c.faceDown = false;
      } else if (changed) {
        Object.assign(c, { rotation: 0, counters: {}, faceDown: false, face: 0 });
        delete c.note;
      }
    });

    for (const c of cards) {
      if (to.kind !== 'free' || c.zone !== from[cards.indexOf(c)].id) {
        // A host that left its battlefield lets go of everything attached to it.
        for (const a of Object.values(this.s.cards)) if (a.attachedTo === c.id && !moving.has(a.id)) delete a.attachedTo;
      }
    }
    // Attachments follow a host that moved around its battlefield.
    for (const h of hosts) this.layoutAttachments(h);

    if (silent || from.every((z) => z.id === to.id)) return;
    const labels = cards.map((c, i) => (wasPublic[i] || isPublic(c, to) ? cardName(c) : null));
    const sources = [...new Set(from)];
    const fromLabel = sources.length === 1 ? this.zoneLabel(sources[0]) : 'several zones';
    if (to.verb) {
      const fromHand = sources.length === 1 && sources[0].role === this.s.preset.parts.hand;
      return this.log(`${to.verb} ${listLabel(labels)}${fromHand ? '' : ` from ${fromLabel}`}`);
    }
    const bottom = to.kind === 'pile' && opts.index === -1 ? ' (bottom)' : '';
    const tax = taxed.length ? ` (commander tax now ${taxed.map((c) => c.tax).join(', ')})` : '';
    this.log(`moved ${listLabel(labels)} from ${fromLabel} to ${this.zoneLabel(to)}${bottom}${tax}`);
  }
}
