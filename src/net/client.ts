import Peer, { type DataConnection } from 'peerjs';
import { applyPatch } from '../core/diff';
import { apply, OPTIMISTIC, type Op } from '../core/ops';
import type { GameState, PlayerId } from '../core/types';
import { iceServers, routeOf } from './ice';
import { Presence, type PointTarget } from './presence';
import { Emitter, HEARTBEAT_TIMEOUT_MS, PEER_PREFIX, wire, type Route, type Session, type Status, type ToClient, type ToHost } from './session';

const RETRY_MS = 2000;

/** Joins a hosted table. Predicts simple ops locally so drags feel instant, then takes the host's word. */
export class ClientSession extends Emitter implements Session {
  readonly role = 'client';
  me: PlayerId | null;
  status: Status = 'connecting';
  error: string | null = null;
  route: Route = null;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  /** The host's word, at version `version`. */
  private confirmed: GameState | null = null;
  private version = -1;
  /** A resync was requested; ignore patches until the full state arrives. */
  private resyncing = false;
  /** `confirmed` plus local predictions; replaced by the next host update. */
  private view: GameState | null = null;
  private closed = false;
  private retryTimer = 0;
  private watchdog = 0;
  private lastHeard = 0;
  // sessionStorage, not localStorage: two tabs on one machine stay two players.
  private seatKey: string;
  private presence = new Presence(() => this.emit());
  private lastHover: string | null = null;

  constructor(
    private name: string,
    readonly code: string,
    /** Watch the table without a seat. */
    readonly spectating = false,
  ) {
    super();
    this.seatKey = `cardtable:seat:${code}`;
    this.me = spectating ? null : sessionStorage.getItem(this.seatKey);
    this.watchdog = window.setInterval(() => {
      if (this.status === 'connected' && Date.now() - this.lastHeard > HEARTBEAT_TIMEOUT_MS) this.lost();
    }, 1000);
    this.openPeer();
  }

  private async openPeer() {
    const peer = new Peer({ debug: 1, config: { iceServers: await iceServers() } });
    if (this.closed) return peer.destroy();
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => {
      this.error = err.type === 'peer-unavailable' ? 'Table not found. Is the host online? Retrying…' : err.message || String(err.type);
      this.emit();
      if (err.type === 'peer-unavailable') this.scheduleRetry();
    });
  }

  private connect() {
    if (this.closed || !this.peer) return;
    // Binary serialization chunks large messages; the JSON channel caps them at ~16KB.
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'binary' });
    this.conn = conn;
    conn.on('open', () => {
      this.send({ t: 'hello', name: this.name, playerId: this.me ?? undefined, spectate: this.spectating || undefined });
    });
    conn.on('data', (raw) => {
      if (this.conn !== conn) return;
      this.lastHeard = Date.now();
      this.receive(raw as ToClient);
    });
    conn.on('close', () => {
      if (this.conn === conn) this.lost();
    });
    conn.on('error', () => {
      if (this.conn === conn) this.lost();
    });
  }

  private receive(msg: ToClient) {
    switch (msg.t) {
      case 'watching':
        this.status = 'connected';
        this.error = null;
        break;
      case 'full':
        // No point dialling again: say so and stay put.
        this.closed = true;
        clearTimeout(this.retryTimer);
        this.error = 'This table is full.';
        break;
      case 'welcome':
        this.me = msg.playerId;
        sessionStorage.setItem(this.seatKey, msg.playerId);
        this.status = 'connected';
        this.error = null;
        routeOf(this.conn?.peerConnection).then((r) => {
          this.route = r;
          this.emit();
        });
        break;
      case 'state':
        this.confirmed = this.view = msg.state;
        this.version = msg.v;
        this.resyncing = false;
        break;
      case 'patch':
        if (this.resyncing) return;
        if (!this.confirmed || msg.base !== this.version) return this.resync();
        this.confirmed = this.view = applyPatch(this.confirmed, msg.patch);
        this.version = msg.v;
        break;
      case 'hover':
        return this.presence.setHover(msg.by, msg.card);
      case 'point':
        return this.presence.addPing(msg.by, msg.target);
      case 'ping':
        // The host is ahead of us: a patch went missing.
        if (msg.v !== this.version && !this.resyncing) this.resync();
        return;
    }
    this.emit();
  }

  private resync() {
    this.resyncing = true;
    this.send({ t: 'resync' });
  }

  private send(msg: ToHost) {
    if (this.conn?.open) this.conn.send(wire(msg));
  }

  /** The connection is gone or silent: drop it and dial again. */
  private lost() {
    if (this.closed) return;
    const conn = this.conn;
    this.conn = null;
    conn?.close();
    this.status = 'reconnecting';
    this.route = null;
    this.view = this.confirmed;
    this.emit();
    this.scheduleRetry();
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      if (this.closed || !this.peer) return;
      if (this.peer.disconnected) this.peer.reconnect();
      this.connect();
    }, RETRY_MS);
  }

  get hovers() {
    return this.presence.hovers;
  }

  get pings() {
    return this.presence.pings;
  }

  hover(card: string | null) {
    if (card === this.lastHover || this.status !== 'connected' || this.spectating) return;
    this.lastHover = card;
    this.send({ t: 'hover', card });
  }

  point(target: PointTarget) {
    if (this.status !== 'connected' || !this.me) return;
    // Show my own ping right away; the host relays it to the others.
    this.presence.addPing(this.me, target);
    this.send({ t: 'point', target });
  }

  getState() {
    return this.view;
  }

  /** Ops are only sent while connected; the table is locked while reconnecting (see Table). */
  dispatch(op: Op) {
    if (this.status !== 'connected' || !this.conn?.open || !this.me) return;
    if (this.view && OPTIMISTIC.has(op.type)) {
      try {
        this.view = apply(this.view, this.me, op);
        this.emit();
      } catch {
        // The host is the judge; a failed prediction just waits for its update.
      }
    }
    this.send({ t: 'op', op });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    this.peer?.destroy();
  }
}
