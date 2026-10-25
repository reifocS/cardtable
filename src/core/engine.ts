import { apply, type Op } from './ops';
import { addPlayer, createGame, withSharedZones } from './state';
import type { GameState, PlayerId } from './types';

const HISTORY = 100;

export const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/** The authoritative game, run by the host. Applies ops and keeps per-op history for undo. */
export class Engine {
  state: GameState;
  private past: { state: GameState; actor: PlayerId }[] = [];
  private subs = new Set<() => void>();

  constructor(state?: GameState) {
    this.state = state ? withSharedZones(state) : createGame();
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private commit(s: GameState) {
    this.state = s;
    this.subs.forEach((fn) => fn());
  }

  /** Adds a player, or reconnects `want` if that seat exists. */
  join(name: string, want?: PlayerId): PlayerId {
    const s = structuredClone(this.state);
    const now = Date.now();
    if (want && s.players[want]) {
      // Only worth a log line if they had actually dropped.
      if (!s.players[want].connected) s.log.push({ id: s.nextId++, by: want, text: 'reconnected', time: now });
      s.players[want].connected = true;
      this.commit(s);
      return want;
    }
    const id = addPlayer(s, name);
    s.log.push({ id: s.nextId++, by: id, text: 'joined the table', time: now });
    // History snapshots predate this player's zones; restoring one would drop them.
    this.past = [];
    this.commit(s);
    return id;
  }

  /** `silent` skips the log line, e.g. when the host resumes a saved game. */
  setConnected(id: PlayerId, connected: boolean, silent = false) {
    const p = this.state.players[id];
    if (!p || p.connected === connected) return;
    const s = structuredClone(this.state);
    s.players[id].connected = connected;
    if (!connected && !silent) s.log.push({ id: s.nextId++, by: id, text: 'disconnected', time: Date.now() });
    this.commit(s);
  }

  dispatch(actor: PlayerId, op: Op) {
    if (!this.state.players[actor] || !op || typeof op.type !== 'string') return;
    if (op.type === 'undo') return this.undo(actor);
    let next: GameState;
    try {
      next = apply(this.state, actor, op, secureRandom);
    } catch (e) {
      console.warn('Rejected op', op, e);
      return;
    }
    this.past.push({ state: this.state, actor });
    if (this.past.length > HISTORY) this.past.shift();
    this.commit(next);
  }

  /** Reverts the latest op, only if `actor` made it. The log keeps both the action and the undo. */
  private undo(actor: PlayerId) {
    const last = this.past[this.past.length - 1];
    if (!last || last.actor !== actor) return;
    this.past.pop();
    const s = structuredClone(last.state);
    for (const [id, p] of Object.entries(this.state.players)) {
      if (s.players[id]) Object.assign(s.players[id], { connected: p.connected, name: p.name });
    }
    s.nextId = this.state.nextId;
    s.log = structuredClone(this.state.log);
    s.log.push({ id: s.nextId++, by: actor, text: 'undid their last action', time: Date.now() });
    this.commit(s);
  }
}
