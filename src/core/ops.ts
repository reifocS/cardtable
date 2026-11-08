import { BOARD_H, BOARD_W, CARD_H, CARD_W, TABLE, zoneId } from './state';
import type { Card, CardFace, CardId, GameState, PlayerId, Reveal, Zone, ZoneId } from './types';
import { entersTapped, entersWithCounters, staysTapped } from './magic';
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
  /**
   * Exiles cards from the top of your pile until a nonland card of mana value `max` or less (cascade: less
   * than the spell's, so one less; discover N: N). The owner then finishes it with `finishReveal`.
   */
  | { type: 'revealUntil'; zone: ZoneId; max: number; as?: Reveal['as'] }
  /** The card it stopped on goes `hit` (cast, hand, stays in exile, or bottom); the others to the bottom in a random order. */
  | { type: 'finishReveal'; zone: ZoneId; hit: 'cast' | 'hand' | 'exile' | 'bottom' }
  /** One more of each kind of counter on these cards, and on these players' counters (all but the life total). */
  | { type: 'proliferate'; cards: CardId[]; players: PlayerId[] }
  | { type: 'tap'; cards: CardId[]; value?: boolean }
  | { type: 'untapAll' }
  | { type: 'flip'; cards: CardId[] }
  | { type: 'transform'; cards: CardId[] }
  /** `why` names it in the log, e.g. a planeswalker's ability: "+1: Draw a card". */
  | { type: 'counter'; cards: CardId[]; key: string; delta: number; why?: string }
  /** Opt out of (or back into) the automatic start of your turn (see Preset.magic). */
  | { type: 'manualTurn'; value: boolean }
  /** Cards from your hand to the bottom of your library, in this order: a London mulligan's. */
  | { type: 'bottom'; cards: CardId[] }
  | { type: 'shuffle'; zone: ZoneId }
  | { type: 'peek'; zone: ZoneId; n?: number }
  | { type: 'unpeek'; zone: ZoneId }
  /**
   * Puts away cards you're looking at in a pile (see `peek`): some back on top in this order (first = top),
   * some on the bottom (last = bottom, or in a random order), others into the pile owner's graveyard, exile
   * or hand (your own pile only). `as` names it in the log: Magic's scry and surveil.
   */
  | { type: 'arrange'; zone: ZoneId; as?: 'scry' | 'surveil'; to: ArrangeTo; randomBottom?: boolean }
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

export interface ArrangeTo {
  top?: CardId[];
  bottom?: CardId[];
  graveyard?: CardId[];
  exile?: CardId[];
  hand?: CardId[];
}

/** Ops a client can safely predict locally before the host confirms. */
export const OPTIMISTIC = new Set<Op['type']>(['move', 'tap', 'untapAll', 'flip', 'counter', 'tracker']);

const MAX_LOG = 300;
/** How far each attached card peeks out above its host, in board units. */
const ATTACH_DY = 22;
const MERGE_WINDOW_MS = 5000;
/**
 * Limits on what one player can put into a game. The host runs every guest's ops, so without them a
 * malicious guest could freeze the host's tab (and the table) with an op of a million cards.
 */
export const LIMITS = { cards: 2500, perCreate: 100, perDeck: 500, faces: 4 };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
/** Only https links to an image: nothing else is ever put in an img src. */
const link = (v: unknown) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]{1,1000}$/.test(v) ? v : undefined);

/** A card face as sent by any client, cut down to known fields of sane sizes. */
export function cleanFace(f: CardFace): CardFace {
  const face: CardFace = { name: text(f?.name, 150)?.trim() || 'Card' };
  const image = link(f.image);
  const imageLarge = link(f.imageLarge);
  const type = text(f.type, 200);
  const body = text(f.text, 4000);
  if (image) face.image = image;
  if (imageLarge) face.imageLarge = imageLarge;
  if (type) face.type = type;
  if (body) face.text = body;
  if (typeof f.cost === 'number' && Number.isFinite(f.cost)) face.cost = clamp(f.cost, 0, 1000);
  if (typeof f.loyalty === 'number' && Number.isFinite(f.loyalty)) face.loyalty = clamp(Math.round(f.loyalty), 0, 99);
  if (typeof f.defense === 'number' && Number.isFinite(f.defense)) face.defense = clamp(Math.round(f.defense), 0, 99);
  if (Array.isArray(f.tokens)) {
    face.tokens = f.tokens
      .slice(0, 20)
      .filter((t) => typeof t?.id === 'string' && typeof t?.name === 'string')
      .map((t) => ({ id: t.id.slice(0, 100), name: t.name.slice(0, 150) }));
  }
  return face;
}

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
        if (op.why) return this.log(`${this.label(cards)}: ${text(op.why, 200)} (${op.key} → ${v})`);
        return this.log(`${this.label(cards)}: ${op.key} counters → ${v}`, { merge: { key: `counter:${op.cards.join(',')}:${op.key}` } });
      }
      case 'shuffle': {
        const z = this.zone(op.zone);
        this.shuffleSilently(z);
        return this.log(`shuffled ${this.zoneLabel(z)}`);
      }
      case 'peek': {
        const z = this.zone(op.zone);
        const ids = op.n == null ? z.cards : z.cards.slice(0, op.n);
        const peeks = (z.peeks ??= {});
        peeks[this.actor] = [...new Set([...(peeks[this.actor] ?? []), ...ids])];
        if (z.visibility === 'public' || (z.visibility === 'owner' && z.owner === this.actor)) return;
        return this.log(op.n == null ? `is searching ${this.zoneLabel(z)}` : `looked at the top ${ids.length} of ${this.zoneLabel(z)}`);
      }
      case 'arrange':
        return this.arrange(op);
      case 'revealUntil':
        return this.revealUntil(op);
      case 'finishReveal':
        return this.finishReveal(op);
      case 'proliferate':
        return this.proliferate(op);
      case 'unpeek': {
        const z = this.zone(op.zone);
        if (!z.peeks) return;
        delete z.peeks[this.actor];
        if (!Object.keys(z.peeks).length) delete z.peeks;
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
        if (op.faces.some((f) => typeof f?.name !== 'string')) return;
        const faces = op.faces.slice(0, LIMITS.faces).map(cleanFace);
        if (!picked.length || !faces.length) return;
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
        if (op.cards.length > LIMITS.perCreate) throw new Error('too many cards at once');
        const z = this.zone(op.zone);
        const created = op.cards.map((faces, i) => this.newCard(faces, z, op.token, op.positions?.[i]));
        for (const c of created) this.arrive(c, z);
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
        // No loops: a host can't stay attached, even through other cards, to what's now attached to it.
        const seen = new Set<CardId>();
        for (let c: Card | undefined = host; c?.attachedTo && !seen.has(c.id); c = s.cards[c.attachedTo]) {
          seen.add(c.id);
          if (op.cards.includes(c.attachedTo)) {
            delete c.attachedTo;
            break;
          }
        }
        const others = cards.filter((c) => c.zone !== zone.id);
        if (others.length) this.move(others.map((c) => c.id), zone.id, {}, true);
        for (const c of cards) c.attachedTo = host.id;
        this.layoutAttachments(host);
        return this.log(`attached ${this.label(cards)} to ${this.label([host])}`);
      }
      case 'loadDeck': {
        this.forgetMulligans();
        if (Object.values(op.sections).reduce((n, list) => n + list.length, 0) > LIMITS.perDeck) throw new Error('deck too big');
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
        this.forgetMulligans();
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
        // London mulligan: a full new hand, then one card to the bottom per mulligan, the first one
        // free in a multiplayer game.
        const me = s.players[this.actor];
        if (s.preset.magic && op.n == null && me) {
          me.mulligans = (me.mulligans ?? 0) + 1;
          const owed = me.mulligans - (s.seats.length > 2 ? 1 : 0);
          if (owed > 0) me.toBottom = owed;
          else delete me.toBottom;
          const tail = owed > 0 ? `, ${owed} to put on the bottom` : ' (free mulligan)';
          return this.log(`mulliganed (${me.mulligans}): drew a new hand of ${n}${tail}`);
        }
        return this.log(`mulliganed: shuffled their hand away and drew ${n}`);
      }
      case 'bottom': {
        const hand = this.part('hand');
        const lib = this.part('deck');
        const me = s.players[this.actor];
        if (!hand || !lib || !me) return;
        const ids = (Array.isArray(op.cards) ? op.cards : []).filter((id) => hand.cards.includes(id));
        if (ids.length) this.move(ids, lib.id, { index: -1 }, true);
        const left = Math.max(0, (me.toBottom ?? 0) - ids.length);
        if (left && ids.length) me.toBottom = left;
        else delete me.toBottom;
        if (!ids.length) return;
        return this.log(`put ${ids.length === 1 ? 'a card' : `${ids.length} cards`} on the bottom of ${this.zoneLabel(lib)}`);
      }
      case 'manualTurn': {
        const me = s.players[this.actor];
        if (!me) return;
        if (op.value) me.manualTurn = true;
        else delete me.manualTurn;
        return;
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
        // The game is under way: mulligans are over.
        for (const pl of Object.values(s.players)) {
          delete pl.mulligans;
          delete pl.toBottom;
        }
        const done = p ? this.startTurn(p.id) : '';
        return this.log(`Turn ${s.turn.number}: ${p?.name ?? '?'}${done}`, { kind: 'turn' });
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
    if (Object.keys(this.s.cards).length >= LIMITS.cards) throw new Error('too many cards in the game');
    const [x, y] = pos ?? this.autoPlace(z.cards.length);
    const card: Card = {
      id: `c${this.s.nextId++}`,
      owner: this.actor,
      zone: z.id,
      faces: faces.length ? faces.slice(0, LIMITS.faces).map(cleanFace) : [{ name: 'Card' }],
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
    if (z) {
      z.cards = z.cards.filter((id) => id !== c.id);
      this.dropPeeks(z, c.id);
    }
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

  private arrange(op: Extract<Op, { type: 'arrange' }>) {
    const z = this.zone(op.zone);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is CardId => typeof x === 'string') : []);
    const top = list(op.to?.top);
    const bottom = list(op.to?.bottom);
    const away = (['graveyard', 'exile', 'hand'] as const).map((role) => ({ role, ids: list(op.to?.[role]) }));
    const all = [top, bottom, ...away.map((a) => a.ids)].flat();
    const seen = z.peeks?.[this.actor] ?? [];
    if (!all.length || new Set(all).size !== all.length) throw new Error('Nothing to arrange');
    // Only cards you're looking at: no reordering a library blind.
    if (all.some((id) => !seen.includes(id) || !z.cards.includes(id))) throw new Error('Not looking at those cards');
    if (away.some((a) => a.ids.length && !this.s.zones[zoneId(z.owner, a.role)])) throw new Error('No such zone');
    if (away[2].ids.length && z.owner !== this.actor) throw new Error("Not your hand's to take");

    const parts: string[] = [];
    if (top.length) parts.push(`${top.length} on top`);
    if (bottom.length) parts.push(`${bottom.length} on the bottom${op.randomBottom && bottom.length > 1 ? ' in a random order' : ''}`);
    for (const { role, ids } of away) {
      if (!ids.length) continue;
      const to = zoneId(z.owner, role);
      this.move(ids, to, {}, true);
      const where = role === 'hand' ? 'into their hand' : role === 'exile' ? 'into exile' : 'into the graveyard';
      parts.push(`${this.label(this.cards(ids))} ${where}`);
    }
    const under = [...bottom];
    if (op.randomBottom) {
      for (let i = under.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [under[i], under[j]] = [under[j], under[i]];
      }
    }
    const placed = new Set([...top, ...bottom]);
    z.cards = [...top, ...z.cards.filter((id) => !placed.has(id)), ...under];
    if (z.peeks) {
      delete z.peeks[this.actor];
      if (!Object.keys(z.peeks).length) delete z.peeks;
    }

    const n = all.length;
    const of = z.owner === this.actor ? '' : ` of ${this.zoneLabel(z)}`;
    const what = op.as === 'scry' ? `scried ${n}${of}` : op.as === 'surveil' ? `surveilled ${n}${of}` : `looked at the top ${n} of ${this.zoneLabel(z)}`;
    // The "looked at the top N" line just before says the same thing: it becomes this one (edited, as
    // patches only ever add or edit log lines).
    const text = `${what}: ${parts.join(', ')}`;
    const last = this.s.log.at(-1);
    if (last?.by === this.actor && last.text === `looked at the top ${n} of ${this.zoneLabel(z)}`) Object.assign(last, { text, time: Date.now() });
    else this.log(text);
  }

  private revealUntil(op: Extract<Op, { type: 'revealUntil' }>) {
    const z = this.zone(op.zone);
    const exile = this.s.zones[zoneId(z.owner, 'exile')];
    if (z.owner !== this.actor || z.kind !== 'pile' || !exile) throw new Error('Not your pile');
    if (z.reveal) throw new Error('Finish the last one first');
    const max = Math.max(-1, Math.floor(Number(op.max) || 0));
    const fits = (c: Card) => {
      const f = c.faces[0];
      return !/\bland\b/i.test(f?.type ?? '') && (f?.cost ?? 0) <= max;
    };
    const misses: CardId[] = [];
    let hit: CardId | null = null;
    for (const id of z.cards) {
      if (fits(this.s.cards[id])) {
        hit = id;
        break;
      }
      misses.push(id);
    }
    // Face up in exile, in the order they came; the hit ends on top.
    this.move([...misses].reverse(), exile.id, {}, true);
    if (hit) this.move([hit], exile.id, {}, true);
    z.reveal = { as: op.as ?? 'reveal', max, hit, misses };
    const what = op.as === 'cascade' ? 'cascaded' : op.as === 'discover' ? `discovered ${max}` : `revealed until a nonland card of mana value ${max} or less`;
    const passed = misses.length ? ` past ${misses.length} card${misses.length === 1 ? '' : 's'}` : '';
    this.log(hit ? `${what}: hit ${cardName(this.s.cards[hit])}${passed}` : `${what}: no card fit${passed}`);
  }

  private finishReveal(op: Extract<Op, { type: 'finishReveal' }>) {
    const z = this.zone(op.zone);
    const r = z.reveal;
    if (z.owner !== this.actor || !r) return;
    delete z.reveal;
    // Only the cards still in exile: anything moved by hand meanwhile stays where it went.
    const exile = this.s.zones[zoneId(z.owner, 'exile')];
    const still = (id: CardId | null): id is CardId => !!id && !!exile?.cards.includes(id);
    const hit = still(r.hit) ? r.hit : null;
    const bottom = r.misses.filter(still);
    let where = '';
    if (hit && op.hit === 'bottom') bottom.push(hit);
    else if (hit && op.hit === 'cast') {
      const stack = this.s.preset.commander?.castThrough;
      const to = (stack && this.s.zones[zoneId(TABLE, stack)]) || this.s.zones[zoneId(z.owner, this.s.preset.parts.play ?? '')];
      if (to) {
        this.move([hit], to.id, {}, true);
        where = `cast ${cardName(this.s.cards[hit])}`;
      }
    } else if (hit && op.hit === 'hand') {
      const hand = this.s.zones[zoneId(z.owner, this.s.preset.parts.hand ?? '')];
      if (hand) {
        this.move([hit], hand.id, {}, true);
        where = `put ${cardName(this.s.cards[hit])} into their hand`;
      }
    }
    for (let i = bottom.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bottom[i], bottom[j]] = [bottom[j], bottom[i]];
    }
    if (bottom.length) this.move(bottom, z.id, { index: -1 }, true);
    const under = bottom.length ? `${bottom.length} card${bottom.length === 1 ? '' : 's'} to the bottom in a random order` : '';
    const parts = [where, under].filter(Boolean);
    if (parts.length) this.log(parts.join(', '));
  }

  private proliferate(op: Extract<Op, { type: 'proliferate' }>) {
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const cards = this.cards(list(op.cards)).filter((c) => this.s.zones[c.zone]?.kind === 'free' && Object.keys(c.counters).length);
    const life = new Set(['Life', this.s.preset.commander?.tracker]);
    const named: string[] = [];
    for (const c of cards) {
      for (const k of Object.keys(c.counters)) c.counters[k] += 1;
      named.push(cardName(c));
    }
    for (const id of new Set(list(op.players))) {
      const p = this.s.players[id];
      const keys = p ? Object.keys(p.trackers).filter((k) => !life.has(k) && p.trackers[k] > 0) : [];
      for (const k of keys) p.trackers[k] += 1;
      if (keys.length) named.push(`${p.name} (${keys.map((k) => `${k} ${p.trackers[k]}`).join(', ')})`);
    }
    if (!named.length) return;
    this.log(`proliferated: ${named.length > 6 ? `${named.slice(0, 6).join(', ')} and ${named.length - 6} more` : named.join(', ')}`);
  }

  private forgetMulligans() {
    const me = this.s.players[this.actor];
    if (!me) return;
    delete me.mulligans;
    delete me.toBottom;
  }

  /** Magic: a card arriving in play enters tapped, or with counters, when its text says so. */
  private arrive(c: Card, to: Zone) {
    if (!this.s.preset.magic || to.role !== this.s.preset.parts.play || c.faceDown) return;
    const face = c.faces[c.face] ?? c.faces[0];
    if (!face) return;
    if (entersTapped(face)) c.rotation = 90;
    for (const [k, n] of Object.entries(entersWithCounters(face))) c.counters[k] = (c.counters[k] ?? 0) + n;
  }

  /** Magic's untap and draw steps, for a player who hasn't opted out. Says what it did, for the turn's log line. */
  private startTurn(pid: PlayerId): string {
    const s = this.s;
    const p = s.players[pid];
    if (!s.preset.magic || !p || p.manualTurn) return '';
    const play = s.preset.parts.play && s.zones[zoneId(pid, s.preset.parts.play)];
    const did: string[] = [];
    if (play) {
      const tapped = play.cards.map((id) => s.cards[id]).filter((c) => c?.rotation);
      const stay = tapped.filter((c) => !c.faceDown && staysTapped(c.faces[c.face] ?? c.faces[0]));
      for (const c of tapped) if (!stay.includes(c)) c.rotation = 0;
      if (tapped.length > stay.length) did.push(`untapped${stay.length ? ` (${stay.map(cardName).join(', ')} stays tapped)` : ''}`);
    }
    const lib = s.preset.parts.deck && s.zones[zoneId(pid, s.preset.parts.deck)];
    const hand = s.preset.parts.hand && s.zones[zoneId(pid, s.preset.parts.hand)];
    if (lib && hand) {
      // The draw is theirs, even though the player passing the turn sent it.
      if (lib.cards.length) {
        const actor = this.actor;
        this.actor = pid;
        this.move([lib.cards[0]], hand.id, {}, true);
        this.actor = actor;
        did.push('drew a card');
      } else did.push("couldn't draw: their library is empty");
    }
    return did.length ? ` — ${did.join(', ')}` : '';
  }

  /** Takes a card that left `z` out of the searches open on it. */
  private dropPeeks(z: Zone, id: CardId) {
    if (!z.peeks) return;
    for (const p of Object.keys(z.peeks)) z.peeks[p] = z.peeks[p].filter((c) => c !== id);
  }

  /** Shuffled cards can't be followed: nobody knows any more which is which. */
  private shuffleSilently(z: Zone | undefined) {
    if (!z) return;
    for (let i = z.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [z.cards[i], z.cards[j]] = [z.cards[j], z.cards[i]];
    }
    for (const id of z.cards) this.s.cards[id].revealedTo = [];
    delete z.peeks;
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
      if (z.id !== to.id) this.dropPeeks(z, c.id);
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
      // Leaving the commander zone for play, directly or through the stack, is how a commander gets cast here.
      if (rules && changed && c.home === rules.zone && from[i].role === rules.zone && (to.role === this.s.preset.parts.play || to.role === rules.castThrough)) {
        c.tax = (c.tax ?? 0) + rules.tax;
        taxed.push(c);
      }
      c.zone = to.id;
      if (changed) c.revealedTo = [];
      // Off the battlefield, what it was pointing at or pointed at by no longer applies.
      if (changed && from[i].kind === 'free' && to.kind !== 'free') this.s.arrows = this.s.arrows.filter((a) => a.from !== c.id && a.to !== c.id);
      if (to.kind === 'free') {
        if (!changed) hosts.push(c);
        const p = opts.positions?.[c.id] ?? (changed ? this.autoPlace(before + i) : undefined);
        if (p) {
          c.x = clamp(p[0], 0, BOARD_W - CARD_W);
          c.y = clamp(p[1], 0, BOARD_H - CARD_H);
        }
        if (opts.faceDown != null) c.faceDown = opts.faceDown;
        else if (changed && from[i].kind !== 'free') c.faceDown = false;
        if (changed && from[i].kind !== 'free') this.arrive(c, to);
      } else if (changed) {
        Object.assign(c, { rotation: 0, counters: {}, faceDown: false, face: 0 });
        delete c.note;
        delete c.attachedTo;
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

    // Off the battlefield (and the stack), a token ceases to exist: after its log line, which still names it.
    const { tokensOnlyInPlay, parts, commander } = this.s.preset;
    const gone = tokensOnlyInPlay && to.role !== parts.play && to.role !== commander?.castThrough ? cards.filter((c) => c.token) : [];
    this.logMove(cards, from, to, wasPublic, opts, taxed, silent, gone.length);
    for (const c of gone) this.remove(c);
  }

  private logMove(
    cards: Card[],
    from: Zone[],
    to: Zone,
    wasPublic: boolean[],
    opts: { index?: number },
    taxed: Card[],
    silent: boolean,
    gone: number,
  ) {
    if (silent || from.every((z) => z.id === to.id)) return;
    const labels = cards.map((c, i) => (wasPublic[i] || isPublic(c, to) ? cardName(c) : null));
    const sources = [...new Set(from)];
    const fromLabel = sources.length === 1 ? this.zoneLabel(sources[0]) : 'several zones';
    const tax = taxed.length ? ` (commander tax now ${taxed.map((c) => c.tax).join(', ')})` : '';
    if (to.verb) {
      const fromHand = sources.length === 1 && sources[0].role === this.s.preset.parts.hand;
      return this.log(`${to.verb} ${listLabel(labels)}${fromHand ? '' : ` from ${fromLabel}`}${tax}`);
    }
    const bottom = to.kind === 'pile' && opts.index === -1 ? ' (bottom)' : '';
    const vanish = gone ? (gone === cards.length ? ' — tokens cease to exist' : ` — ${gone} token${gone === 1 ? '' : 's'} ceased to exist`) : '';
    this.log(`moved ${listLabel(labels)} from ${fromLabel} to ${this.zoneLabel(to)}${bottom}${tax}${vanish}`);
  }
}
