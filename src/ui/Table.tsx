import { useEffect } from 'react';
import { zoneOf } from '../core/state';
import { cardName } from '../core/ops';
import type { Card, GameState, Player, PlayerId } from '../core/types';
import { onKeyDown, onKeyUp } from './actions';
import { Arrows } from './Arrows';
import { ContextMenu, CreateDialog, HelpDialog, ImportDialog, PromptDialog } from './Dialogs';
import { finishTargeting } from './drag';
import { SidePanel, ZoomOverlay } from './SidePanel';
import { act, useStore } from './store';
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

function Trackers({ player, editable }: { player: Player; editable: boolean }) {
  const bump = (key: string, delta: number) => act({ type: 'tracker', player: player.id, key, delta });
  return (
    <div className="trackers">
      {Object.entries(player.trackers).map(([key, v]) => (
        <div key={key} className={`tracker${key === 'Life' ? ' life' : ''}`} title={`${key} — shift-click for ±5`}>
          {editable && <button onClick={(e) => bump(key, e.shiftKey ? -5 : -1)}>−</button>}
          <span className="tracker-value">{v}</span>
          <span className="tracker-key">{key}</span>
          {editable && <button onClick={(e) => bump(key, e.shiftKey ? 5 : 1)}>+</button>}
        </div>
      ))}
    </div>
  );
}

function PlayerHeader({ state, pid }: { state: GameState; pid: PlayerId }) {
  const player = state.players[pid];
  const targeting = useStore((s) => s.targeting);
  const hand = zoneOf(state, pid, 'hand');
  const lib = zoneOf(state, pid, 'library');
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
      <span className="counts">
        ✋ {hand?.cards.length ?? 0} · 📚 {lib?.cards.length ?? 0}
      </span>
    </div>
  );
}

function OpponentArea({ state, pid }: { state: GameState; pid: PlayerId }) {
  const bf = zoneOf(state, pid, 'battlefield');
  const hand = zoneOf(state, pid, 'hand');
  return (
    <section className="area opponent">
      {/* Laid out like a player sitting across: hand and piles far side, battlefield toward the middle. */}
      <PlayerHeader state={state} pid={pid} />
      <div className="opp-strip">
        {['library', ...SIDE_PILES].map((role) => {
          const z = zoneOf(state, pid, role);
          return z && <Pile key={role} zone={z} state={state} small />;
        })}
        {hand && <Hand zone={hand} state={state} compact />}
      </div>
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
      <PlayerHeader state={state} pid={me} />
    </section>
  );
}

export function Table() {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me);
  const targeting = useStore((s) => s.targeting);

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
      <Viewer state={state} />
      <Arrows state={state} />
      <ZoomOverlay state={state} />
      <ContextMenu />
      <PromptDialog />
      <ImportDialog />
      <CreateDialog />
      <HelpDialog />
      {targeting && <div className="targeting-hint">Click a card or a player to target · Esc to cancel</div>}
    </div>
  );
}
