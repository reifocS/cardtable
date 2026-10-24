import Peer, { type DataConnection } from 'peerjs';
import { applyPatch } from '../core/diff';
import { apply, OPTIMISTIC, type Op } from '../core/ops';
import type { GameState, PlayerId } from '../core/types';
import { Emitter, HEARTBEAT_TIMEOUT_MS, PEER_PREFIX, wire, type Session, type Status, type ToClient, type ToHost } from './session';

const RETRY_MS = 2000;

/** Joins a hosted table. Predicts simple ops locally so drags feel instant, then takes the host's word. */
export class ClientSession extends Emitter implements Session {
  readonly role = 'client';
  me: PlayerId | null;
  status: Status = 'connecting';
  error: string | null = null;

  private peer: Peer;
  private conn: DataConnection | null = null;
  /** The host's word. */
  private confirmed: GameState | null = null;
  /** `confirmed` plus local predictions; replaced by the next host update. */
  private view: GameState | null = null;
  private closed = false;
  private retryTimer = 0;
  private watchdog = 0;
  private lastHeard = 0;
  // sessionStorage, not localStorage: two tabs on one machine stay two players.
  private seatKey: string;

  constructor(
    private name: string,
    readonly code: string,
  ) {
    super();
    this.seatKey = `cardtable:seat:${code}`;
    this.me = sessionStorage.getItem(this.seatKey);
    this.peer = new Peer({ debug: 1 });
    this.peer.on('open', () => this.connect());
    this.peer.on('disconnected', () => {
      if (!this.closed && !this.peer.destroyed) this.peer.reconnect();
    });
    this.peer.on('error', (err) => {
      this.error = err.type === 'peer-unavailable' ? 'Table not found. Is the host online? Retrying…' : err.message || String(err.type);
      this.emit();
      if (err.type === 'peer-unavailable') this.scheduleRetry();
    });
    this.watchdog = window.setInterval(() => {
      if (this.status === 'connected' && Date.now() - this.lastHeard > HEARTBEAT_TIMEOUT_MS) this.lost();
    }, 1000);
  }

  private connect() {
    if (this.closed) return;
    // Binary serialization chunks large messages; the JSON channel caps them at ~16KB.
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'binary' });
    this.conn = conn;
    conn.on('open', () => {
      const hello: ToHost = { t: 'hello', name: this.name, playerId: this.me ?? undefined };
      conn.send(wire(hello));
    });
    conn.on('data', (raw) => {
      if (this.conn !== conn) return;
      this.lastHeard = Date.now();
      const msg = raw as ToClient;
      if (msg.t === 'ping') return;
      if (msg.t === 'welcome') {
        this.me = msg.playerId;
        sessionStorage.setItem(this.seatKey, msg.playerId);
        this.status = 'connected';
        this.error = null;
      } else if (msg.t === 'state') {
        this.confirmed = this.view = msg.state;
      } else if (msg.t === 'patch' && this.confirmed) {
        this.confirmed = this.view = applyPatch(this.confirmed, msg.patch);
      }
      this.emit();
    });
    conn.on('close', () => {
      if (this.conn === conn) this.lost();
    });
    conn.on('error', () => {
      if (this.conn === conn) this.lost();
    });
  }

  /** The connection is gone or silent: drop it and dial again. */
  private lost() {
    if (this.closed) return;
    const conn = this.conn;
    this.conn = null;
    conn?.close();
    this.status = 'reconnecting';
    this.view = this.confirmed;
    this.emit();
    this.scheduleRetry();
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      if (this.closed) return;
      if (this.peer.disconnected) this.peer.reconnect();
      this.connect();
    }, RETRY_MS);
  }

  getState() {
    return this.view;
  }

  dispatch(op: Op) {
    if (!this.conn?.open || !this.me) return;
    if (this.view && OPTIMISTIC.has(op.type)) {
      try {
        this.view = apply(this.view, this.me, op);
        this.emit();
      } catch {
        // The host is the judge; a failed prediction just waits for its update.
      }
    }
    const msg: ToHost = { t: 'op', op };
    this.conn.send(wire(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.watchdog);
    this.peer.destroy();
  }
}
