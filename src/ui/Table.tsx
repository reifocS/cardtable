import { useEffect } from 'react';
import { zoneOf } from '../core/state';
import { cardName } from '../core/ops';
import type { Card, GameState, Player, PlayerId } from '../core/types';
import { onKeyDown, onKeyUp, openMenu } from './actions';
import { ActionBar } from './ActionBar';
import { Arrows } from './Arrows';
import { ContextMenu, CreateDialog, HelpDialog, ImportDialog, PromptDialog } from './Dialogs';
import { finishTargeting } from './drag';
import { Icon } from './Icon';
import { SidePanel, ZoomOverlay } from './SidePanel';
import { act, ask, useStore } from './store';
import { TopBar } from './TopBar';
import { Viewer } from './Viewer';
import { Board, Hand, Pile } from './Zones';

const SIDE_PILES = ['graveyard', 'exile', 'command'];

const commandersOf = (state: GameState) => Object.values(state.cards).filter((c) => c.home === 'command' && !c.token);

/** Damage `player` has taken from each enemy commander. Click +1, right-click −1, shift ±5. */
function CommanderDamage({ state, player }: { state: GameState; player: Player }) {
  const sources = commandersOf(state).filter((c) => c.owner !== player.id);
  if (!sources.length) return null;
  const hit = (c: Card, delta: number) => act({ type: 'commanderDamage', player: player.id, from: c.id, delta });
  return (
    <div className="cmd-damage">
      {sources.map((c) => {
        const n = player.commanderDamage?.[c.id] ?? 0;
        const name = c.faces.length ? cardName(c) : 'Commander';
        return (
          <button
            key={c.id}
            className={`cmd-chip${n >= 21 ? ' lethal' : ''}`}
            style={{ '--src': state.players[c.owner]?.color } as React.CSSProperties}
            title={`Commander damage from ${name} (also lowers Life). Click +1, right-click −1, shift ±5`}
            onClick={(e) => hit(c, e.shiftKey ? 5 : 1)}
            onContextMenu={(e) => {
              e.preventDefault();
              hit(c, e.shiftKey ? -5 : -1);
            }}
          >
            <span className="cmd-name">{name.split(/[ ,]/)[0]}</span>
            <b>{n}</b>
          </button>
        );
      })}
    </div>
  );
}

/** Counters that end the game at a threshold get highlighted there. */
const LETHAL: Record<string, (v: number) => boolean> = { Life: (v) => v <= 0, Poison: (v) => v >= 10 };
const COMMON_COUNTERS = ['Poison', 'Energy', 'Experience', 'Rad', 'Tickets'];

function Trackers({ player, editable }: { player: Player; editable: boolean }) {
  const bump = (key: string, delta: number) => act({ type: 'tracker', player: player.id, key, delta });
  const add = (key: string) => act({ type: 'setTracker', player: player.id, key, value: player.trackers[key] ?? 0 });
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Add a counter', heading: true },
      ...COMMON_COUNTERS.filter((k) => !(k in player.trackers)).map((k) => ({ label: k, action: () => add(k) })),
      { label: 'Other…', action: () => ask('Counter name', '', (k) => k.trim() && add(k.trim().slice(0, 20))) },
    ]);
  return (
    <div className="trackers">
      {Object.entries(player.trackers).map(([key, v]) => (
        <div
          key={key}
          className={`tracker${key === 'Life' ? ' life' : ''}${LETHAL[key]?.(v) ? ' lethal' : ''}`}
          title={`${key} · shift-click for ±5${key === 'Life' ? '' : ' · right-click to remove'}`}
          onContextMenu={(e) =>
            key !== 'Life' && openMenu(e, [{ label: `Remove ${key}`, action: () => act({ type: 'setTracker', player: player.id, key, value: null }) }])
          }
        >
          {editable && <button onClick={(e) => bump(key, e.shiftKey ? -5 : -1)}>−</button>}
          <span className="tracker-value">{v}</span>
          <span className="tracker-key">{key}</span>
          {editable && <button onClick={(e) => bump(key, e.shiftKey ? 5 : 1)}>+</button>}
        </div>
      ))}
      {editable && (
        <button className="tracker-add" title="Add a counter (poison, energy…)" onClick={addMenu}>
          +◆
        </button>
      )}
    </div>
  );
}

function PlayerHeader({ state, pid, children }: { state: GameState; pid: PlayerId; children?: React.ReactNode }) {
  const player = state.players[pid];
  const targeting = useStore((s) => s.targeting);
  const active = state.turn.player === pid;
  return (
    <div
      className={`player-header${active ? ' active' : ''}${targeting ? ' targetable' : ''}`}
      data-player-id={pid}
      style={{ '--player': player.color } as React.CSSProperties}
      onClick={() => targeting && finishTargeting(pid)}
    >
      <span className={`dot${player.connected ? '' : ' off'}`} title={player.connected ? 'Connected' : 'Disconnected'} />
      <span className="player-name">{player.name}</span>
      {active && <span className="turn-badge">turn</span>}
      {/* Anyone can adjust anyone's life: at a real table you'd just say it. */}
      <Trackers player={player} editable />
      <CommanderDamage state={state} player={player} />
      {children}
    </div>
  );
}

function OpponentArea({ state, pid }: { state: GameState; pid: PlayerId }) {
  const bf = zoneOf(state, pid, 'battlefield');
  const hand = zoneOf(state, pid, 'hand');
  return (
    <section className="area opponent">
      {/* Laid out like a player sitting across: hand and piles far side, battlefield toward the middle. */}
      <PlayerHeader state={state} pid={pid}>
        <div className="opp-zones">
          {['library', ...SIDE_PILES].map((role) => {
            const z = zoneOf(state, pid, role);
            return z && <Pile key={role} zone={z} state={state} small />;
          })}
          {hand && <Hand zone={hand} state={state} compact />}
        </div>
        <button
          className="icon-btn"
          title={`See ${state.players[pid].name}'s battlefield in big`}
          onClick={(e) => {
            e.stopPropagation();
            useStore.setState({ focus: pid });
          }}
        >
          <Icon name="expand" />
        </button>
      </PlayerHeader>
      <div className="area-body">
        {bf && <Board zone={bf} state={state} flipped />}
      </div>
    </section>
  );
}

function MyArea({ state, me }: { state: GameState; me: PlayerId }) {
  const bf = zoneOf(state, me, 'battlefield');
  const hand = zoneOf(state, me, 'hand');
  const empty = !Object.values(state.cards).some((c) => c.owner === me);
  return (
    <section className="area mine">
      <div className="area-body">
        {bf && (
          <Board zone={bf} state={state}>
            {empty && (
              <div className="empty-hint">
                <button className="primary" onClick={() => useStore.setState({ dialog: 'import' })}>
                  Import a deck
                </button>
                <p>or right-click the board to create cards</p>
              </div>
            )}
          </Board>
        )}
      </div>
      <div className="tray">
        <div className="tray-piles">
          {['library', ...SIDE_PILES, 'sideboard'].map((role) => {
            const z = zoneOf(state, me, role);
            return z && <Pile key={role} zone={z} state={state} />;
          })}
        </div>
        {hand && <Hand zone={hand} state={state} />}
      </div>
      <PlayerHeader state={state} pid={me}>
        <ActionBar state={state} />
      </PlayerHeader>
    </section>
  );
}

/** One opponent's battlefield over the whole table, for reading a busy board. */
function FocusBoard({ state }: { state: GameState }) {
  const focus = useStore((s) => s.focus);
  const bf = focus ? zoneOf(state, focus, 'battlefield') : undefined;
  if (!focus || !bf || !state.players[focus]) return null;
  return (
    <div className="board-focus">
      <div className="board-focus-head">
        <b style={{ color: state.players[focus].color }}>{state.players[focus].name}'s battlefield</b>
        <span className="muted">You can play on it as usual · Esc to close</span>
        <div className="spacer" />
        <button onClick={() => useStore.setState({ focus: null })}>Close</button>
      </div>
      <div className="area-body">
        {/* Let cards grow well past the usual cap: reading a busy board is the point. */}
        <Board zone={bf} state={state} flipped maxScale={3.5} />
      </div>
    </div>
  );
}

export function Table() {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me);
  const targeting = useStore((s) => s.targeting);
  const attaching = useStore((s) => s.targetMode === 'attach');
  const offline = useStore((s) => s.session?.role === 'client' && s.status !== 'connected');

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const blur = () => useStore.setState({ zoom: false });
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', blur);
    };
  }, []);

  if (!state || !me || !state.players[me]) {
    return <div className="connecting">Joining table…</div>;
  }

  const opponents = state.seats.filter((id) => id !== me);
  return (
    <div className={`app${targeting ? ' is-targeting' : ''}`}>
      <TopBar state={state} />
      <main className="table">
        {opponents.length > 0 && (
          <div className="opponents">
            {opponents.map((pid) => (
              <OpponentArea key={pid} state={state} pid={pid} />
            ))}
          </div>
        )}
        {opponents.length > 0 && <div className="table-divider" />}
        <MyArea state={state} me={me} />
      </main>
      <SidePanel state={state} />
      <FocusBoard state={state} />
      <Viewer state={state} />
      <Arrows state={state} />
      <ZoomOverlay state={state} />
      <ContextMenu />
      <PromptDialog />
      <ImportDialog />
      <CreateDialog />
      <HelpDialog />
      {offline && (
        <div className="offline">
          <div>Reconnecting to the host…</div>
          <p className="muted">Actions are paused so nothing gets lost. The table comes back exactly as the host has it.</p>
        </div>
      )}
      {targeting && (
        <div className="targeting-hint">{attaching ? 'Click the card to attach to' : 'Click a card or a player to target'} · Esc to cancel</div>
      )}
    </div>
  );
}
