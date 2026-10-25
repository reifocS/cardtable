import Peer, { type DataConnection } from 'peerjs';
import { applyPatch, diffState } from '../core/diff';
import { Engine } from '../core/engine';
import type { Op } from '../core/ops';
import type { GameState, PlayerId } from '../core/types';
import { redact } from '../core/visibility';
import { iceServers } from './ice';
import { Presence, type PointTarget } from './presence';
import { Emitter, HEARTBEAT_MS, PEER_PREFIX, makeCode, wire, type Session, type Status, type ToClient, type ToHost } from './session';

const SAVE_PREFIX = 'cardtable:hosted:';
const LEGACY_SAVE_KEY = 'cardtable:hosted';
const MAX_SAVES = 8;

export interface SavedGame {
  code: string;
  me: PlayerId;
  state: GameState;
  savedAt: number;
  /** Seats this browser plays itself (two-seat practice); `me` is the active one. */
  controlled?: PlayerId[];
}

export function deleteSavedGame(code: string) {
  try {
    localStorage.removeItem(SAVE_PREFIX + code);
  } catch {
    // Storage blocked: nothing to delete anyway.
  }
}

/** Hosted games on this browser, newest first. One per table code, so tabs don't overwrite each other. */
export function listSavedGames(): SavedGame[] {
  try {
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (legacy) {
      const g = JSON.parse(legacy) as SavedGame;
      localStorage.setItem(SAVE_PREFIX + g.code, JSON.stringify({ ...g, savedAt: g.savedAt ?? Date.now() }));
      localStorage.removeItem(LEGACY_SAVE_KEY);
    }
    const games: SavedGame[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(SAVE_PREFIX)) games.push(JSON.parse(localStorage.getItem(key)!));
    }
    games.sort((a, b) => b.savedAt - a.savedAt);
    for (const old of games.slice(MAX_SAVES)) localStorage.removeItem(SAVE_PREFIX + old.code);
    return games.slice(0, MAX_SAVES);
  } catch {
    return [];
  }
}

/**
 * This tab holds the authoritative game. Peers connect to it by table code;
 * each one only ever receives the state redacted for its own player.
 */
export class HostSession extends Emitter implements Session {
  readonly role = 'host';
  readonly code: string;
  /** The seat I'm acting as right now (one of `controlled`). */
  me: PlayerId;
  /** Seats I play myself: mine, plus any added for practice. */
  controlled: PlayerId[];
  status: Status = 'connecting';
  error: string | null = null;
  readonly route = null;

  private engine: Engine;
  private peer: Peer | null = null;
  private conns = new Map<DataConnection, PlayerId | null>();
  /** Last view sent on each connection and its version, so later updates only carry what changed. */
  private sent = new Map<DataConnection, { view: GameState; v: number }>();
  private view: GameState;
  private closed = false;
  private saveTimer = 0;
  private heartbeat = 0;
  private presence = new Presence(() => this.emit());

  /**
   * `persist: false` keeps the game out of saved tables; `keepPresence` leaves players' connected
   * flags as saved (both for dev presets, whose other players are only in the state).
   */
  constructor(name: string, saved?: SavedGame, private opts: { persist?: boolean; keepPresence?: boolean } = {}) {
    super();
    this.code = saved?.code ?? makeCode();
    this.engine = new Engine(saved?.state);
    if (!opts.keepPresence) for (const id of Object.keys(this.engine.state.players)) this.engine.setConnected(id, false, true);
    this.me = this.engine.join(name, saved?.me);
    this.controlled = [...new Set([this.me, ...(saved?.controlled ?? [])])].filter((p) => this.engine.state.players[p]);
    for (const p of this.controlled) this.engine.setConnected(p, true);
    this.view = redact(this.engine.state, this.me);
    this.engine.subscribe(() => this.onChange());
    this.save();
    this.openPeer(0);
    this.heartbeat = window.setInterval(() => {
      for (const conn of this.conns.keys()) this.send(conn, { t: 'ping', v: this.sent.get(conn)?.v ?? 0 });
    }, HEARTBEAT_MS);
  }

  private async openPeer(attempt: number) {
    if (this.closed) return;
    const peer = new Peer(PEER_PREFIX + this.code, { debug: 1, config: { iceServers: await iceServers() } });
    this.peer = peer;
    peer.on('open', () => {
      this.status = 'connected';
      this.error = null;
      this.emit();
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      // After a reload the signaling server holds our old id for a few seconds.
      if (err.type === 'unavailable-id' && attempt < 15) {
        peer.destroy();
        this.error = 'Reclaiming table code…';
        this.emit();
        setTimeout(() => this.openPeer(attempt + 1), 2000);
        return;
      }
      this.error =
        err.type === 'unavailable-id'
          ? 'This table is already open in another tab or window: close it there, then resume here.'
          : err.message || String(err.type);
      this.emit();
    });
  }

  private accept(conn: DataConnection) {
    this.conns.set(conn, null);
    conn.on('data', (raw) => this.receive(conn, raw as ToHost));
    const drop = () => {
      const pid = this.conns.get(conn);
      this.conns.delete(conn);
      this.sent.delete(conn);
      if (pid && ![...this.conns.values()].includes(pid)) {
        this.engine.setConnected(pid, false);
        this.relayHover(pid, null);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private send(conn: DataConnection, msg: ToClient) {
    if (!conn.open) return;
    try {
      conn.send(wire(msg));
    } catch (e) {
      console.warn('Send failed', e);
    }
  }

  private sync(conn: DataConnection, pid: PlayerId) {
    const view = redact(this.engine.state, pid);
    const prev = this.sent.get(conn);
    const v = (prev?.v ?? 0) + 1;
    this.send(conn, prev ? { t: 'patch', patch: diffState(prev.view, view), base: prev.v, v } : { t: 'state', state: view, v });
    this.sent.set(conn, { view, v });
  }

  private receive(conn: DataConnection, msg: ToHost) {
    if (msg?.t === 'hello') {
      // Nobody else may take a seat I play myself.
      const want = msg.playerId && !this.controlled.includes(msg.playerId) ? msg.playerId : undefined;
      const pid = this.engine.join(String(msg.name || 'Player').slice(0, 32), want);
      this.conns.set(conn, pid);
      this.sent.delete(conn);
      this.send(conn, { t: 'welcome', playerId: pid });
      this.sync(conn, pid);
      for (const [by, card] of Object.entries(this.presence.hovers)) if (by !== pid) this.send(conn, { t: 'hover', by, card });
    } else if (msg?.t === 'op') {
      const pid = this.conns.get(conn);
      if (pid) this.engine.dispatch(pid, msg.op);
    } else if (msg?.t === 'hover') {
      const pid = this.conns.get(conn);
      if (pid) this.relayHover(pid, typeof msg.card === 'string' ? msg.card : null);
    } else if (msg?.t === 'point') {
      const pid = this.conns.get(conn);
      if (pid && msg.target) this.relayPoint(pid, msg.target);
    } else if (msg?.t === 'resync') {
      const pid = this.conns.get(conn);
      if (!pid) return;
      // Keep counting versions up, so a late patch can never be mistaken for a current one.
      const v = this.sent.get(conn)?.v ?? 0;
      this.sent.delete(conn);
      const view = redact(this.engine.state, pid);
      this.send(conn, { t: 'state', state: view, v: v + 1 });
      this.sent.set(conn, { view, v: v + 1 });
    }
  }

  private onChange() {
    const s = this.engine.state;
    // The engine rebuilds every object on each op; keep the unchanged ones, as a client's patches do,
    // so only what changed renders again.
    this.view = applyPatch(this.view, diffState(this.view, redact(s, this.me)));
    for (const [conn, pid] of this.conns) if (pid) this.sync(conn, pid);
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 500);
    this.emit();
  }

  private save() {
    if (this.opts.persist === false) return;
    try {
      const saved: SavedGame = { code: this.code, me: this.me, state: this.engine.state, savedAt: Date.now(), controlled: this.controlled };
      localStorage.setItem(SAVE_PREFIX + this.code, JSON.stringify(saved));
    } catch {
      // Storage full or blocked: the game still works, it just won't survive a reload.
    }
  }

  private relayHover(by: PlayerId, card: string | null) {
    this.presence.setHover(by, card);
    for (const [conn, pid] of this.conns) if (pid && pid !== by) this.send(conn, { t: 'hover', by, card });
  }

  private relayPoint(by: PlayerId, target: PointTarget) {
    this.presence.addPing(by, target);
    for (const [conn, pid] of this.conns) if (pid && pid !== by) this.send(conn, { t: 'point', by, target });
  }

  get hovers() {
    return this.presence.hovers;
  }

  get pings() {
    return this.presence.pings;
  }

  hover(card: string | null) {
    this.relayHover(this.me, card);
  }

  point(target: PointTarget) {
    this.relayPoint(this.me, target);
  }

  /** Adds a seat at the table that I play myself (practice against my own second deck). */
  addSeat(name: string): PlayerId {
    const id = this.engine.join(name.trim().slice(0, 32) || 'Opponent');
    this.controlled = [...this.controlled, id];
    this.save();
    this.emit();
    return id;
  }

  /** Acts as another seat I control: the view turns to that side of the table. */
  switchSeat(id: PlayerId) {
    if (!this.controlled.includes(id) || id === this.me) return;
    this.hover(null);
    this.me = id;
    this.view = redact(this.engine.state, this.me);
    this.save();
    this.emit();
  }

  getState() {
    return this.view;
  }

  dispatch(op: Op) {
    this.engine.dispatch(this.me, op);
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    this.save();
    this.peer?.destroy();
  }
}
