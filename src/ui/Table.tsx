import { useEffect } from 'react';
import { zoneOf } from '../core/state';
import { cardName } from '../core/ops';
import type { Card, GameState, Player, PlayerId } from '../core/types';
import { onKeyDown, onKeyUp, openMenu } from './actions';
import { ActionBar } from './ActionBar';
import { Arrows } from './Arrows';
import { ArtDialog, ConfirmDialog, ContextMenu, CreateDialog, HelpDialog, ImportDialog, PromptDialog } from './Dialogs';
import { finishTargeting } from './drag';
import { opponentLayout } from './fit';
import { Icon } from './Icon';
import { SidePanel, ZoomOverlay } from './SidePanel';
import { act, ask, useStore } from './store';
import { loadPlaymatPref, loadSleevePref } from './playmats';
import { tip } from './tip';
import { TopBar } from './TopBar';
import { Viewer } from './Viewer';
import { Board, Hand, Pile, StackZone, ZoomBoard } from './Zones';

const SIDE_PILES = ['graveyard', 'exile', 'command'];
/** CSS grid placement for opponent `i`: columns are shared by both rows, so each row fills the width. */
function opponentCell(rows: number[], i: number): React.CSSProperties {
  const cols = rows.length === 1 ? rows[0] : rows[0] * rows[1];
  const row = i < rows[0] ? 0 : 1;
  // Each opponent spans two grid rows (header, board) and lays its own out on them (subgrid).
  return { gridRow: `${row * 2 + 1} / span 2`, gridColumn: `span ${cols / rows[row]}` };
}

/** Commanders on the table, for presets with commander rules. */
const commandersOf = (state: GameState) => {
  const zone = state.preset.commander?.zone;
  return zone ? Object.values(state.cards).filter((c) => c.home === zone && !c.token) : [];
};

/**
 * Damage `player` has taken from each enemy commander. Only commanders that have dealt some get a
 * chip (click +1, right-click −1, shift ±5); the ⚔ button adds damage from any of them.
 */
function CommanderDamage({ state, player }: { state: GameState; player: Player }) {
  const sources = commandersOf(state).filter((c) => c.owner !== player.id);
  const rules = state.preset.commander;
  if (!rules || !sources.length) return null;
  const hit = (c: Card, delta: number) => act({ type: 'commanderDamage', player: player.id, from: c.id, delta });
  const nameOf = (c: Card) => (c.faces.length ? cardName(c) : 'Commander');
  const dealt = sources.filter((c) => (player.commanderDamage?.[c.id] ?? 0) > 0);
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: `Commander damage to ${player.name}`, heading: true },
      ...sources.map((c) => ({
        label: `+1 from ${nameOf(c)} (${player.commanderDamage?.[c.id] ?? 0})`,
        action: () => hit(c, 1),
      })),
    ]);
  return (
    <div className="cmd-damage">
      <button className="cmd-add" onClick={addMenu} {...tip(`Commander damage (also lowers ${rules.tracker})`)}>
        ⚔
      </button>
      {dealt.map((c) => {
        const n = player.commanderDamage?.[c.id] ?? 0;
        const name = nameOf(c);
        return (
          <button
            key={c.id}
            className={`cmd-chip${n >= rules.lethal ? ' lethal' : ''}`}
            style={{ '--src': state.players[c.owner]?.color } as React.CSSProperties}
            {...tip(`Commander damage from ${name} (also lowers ${rules.tracker}) · click +1, right-click −1, shift ±5`)}
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

/**
 * A player's counters. Full (− value +) in my own bar; compact chips in opponent headers, where
 * space is short: click +1, right-click −1, shift for ±5. Counters other than Life are removed
 * from the +◆ menu (or right-click in the full version).
 */
function Trackers({ player, compact }: { player: Player; compact?: boolean }) {
  const bump = (key: string, delta: number) => act({ type: 'tracker', player: player.id, key, delta });
  const add = (key: string) => act({ type: 'setTracker', player: player.id, key, value: player.trackers[key] ?? 0 });
  const remove = (key: string) => act({ type: 'setTracker', player: player.id, key, value: null });
  const removable = Object.keys(player.trackers).filter((k) => k !== 'Life');
  const addMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Add a counter', heading: true },
      ...COMMON_COUNTERS.filter((k) => !(k in player.trackers)).map((k) => ({ label: k, action: () => add(k) })),
      { label: 'Other…', action: () => ask('Counter name', '', (k) => k.trim() && add(k.trim().slice(0, 20))) },
      ...(removable.length ? [{ label: 'Remove', heading: true }, ...removable.map((k) => ({ label: k, action: () => remove(k) }))] : []),
    ]);
  return (
    <div className={`trackers${compact ? ' compact' : ''}`}>
      {Object.entries(player.trackers).map(([key, v]) => {
        const cls = `tracker${key === 'Life' ? ' life' : ''}${LETHAL[key]?.(v) ? ' lethal' : ''}`;
        if (compact) {
          return (
            <button
              key={key}
              className={`${cls} tracker-chip`}
              {...tip(`${key} · click +1, right-click −1, shift ±5`)}
              onClick={(e) => bump(key, e.shiftKey ? 5 : 1)}
              onContextMenu={(e) => {
                e.preventDefault();
                bump(key, e.shiftKey ? -5 : -1);
              }}
            >
              <span className="tracker-value">{v}</span>
              {/* Short labels: the tooltip has the full name. */}
              <span className="tracker-key">{key === 'Life' ? '♥' : key.slice(0, 3)}</span>
            </button>
          );
        }
        return (
          <div
            key={key}
            className={cls}
            {...tip(`${key} · shift-click for ±5${key === 'Life' ? '' : ' · right-click to remove'}`)}
            onContextMenu={(e) => key !== 'Life' && openMenu(e, [{ label: `Remove ${key}`, action: () => remove(key) }])}
          >
            <button onClick={(e) => bump(key, e.shiftKey ? -5 : -1)}>−</button>
            <span className="tracker-value">{v}</span>
            <span className="tracker-key">{key}</span>
            <button onClick={(e) => bump(key, e.shiftKey ? 5 : 1)}>+</button>
          </div>
        );
      })}
      <button className="tracker-add" {...tip('Add or remove a counter (poison, energy…)')} onClick={addMenu}>
        +◆
      </button>
    </div>
  );
}

function PlayerHeader({
  state,
  pid,
  opponent,
  children,
}: {
  state: GameState;
  pid: PlayerId;
  opponent?: boolean;
  children?: React.ReactNode;
}) {
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
      {/* Opponents' headers are tinted on their turn; the badge would only cost room. */}
      {active && !opponent && <span className="turn-badge">turn</span>}
      {/* Anyone can adjust anyone's life: at a real table you'd just say it. */}
      <Trackers player={player} compact={!!opponent} />
      <CommanderDamage state={state} player={player} />
      {children}
    </div>
  );
}

function OpponentArea({ state, pid, style }: { state: GameState; pid: PlayerId; style?: React.CSSProperties }) {
  const bf = zoneOf(state, pid, 'battlefield');
  const hand = zoneOf(state, pid, 'hand');
  return (
    <section className="area opponent" style={style}>
      {/* Laid out like a player sitting across: hand and piles far side, battlefield toward the middle. */}
      <PlayerHeader state={state} pid={pid} opponent>
        <div className="opp-zones">
          {['library', ...SIDE_PILES].map((role) => {
            const z = zoneOf(state, pid, role);
            return z && <Pile key={role} zone={z} state={state} small />;
          })}
          {hand && <Hand zone={hand} state={state} compact />}
        </div>
        <button
          className="icon-btn"
          {...tip(`See ${state.players[pid].name}'s battlefield in big`, 'end')}
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
        <span className="muted">Pinch or Ctrl/⌘ + wheel to zoom · scroll to move · Esc to close</span>
        <div className="spacer" />
        <button onClick={() => useStore.setState({ focus: null })}>Close</button>
      </div>
      <ZoomBoard key={focus} zone={bf} state={state} flipped />
    </div>
  );
}

/** Before the host has answered: say what's happening, and offer a way out. */
function Joining() {
  const code = useStore((s) => s.session?.code);
  const error = useStore((s) => s.error);
  const status = useStore((s) => s.status);
  return (
    <div className="connecting">
      <h2>Joining table {code}…</h2>
      <p className={error ? 'problem' : 'muted'}>
        {error ?? (status === 'reconnecting' ? 'Reconnecting to the host…' : 'Connecting to the host…')}
      </p>
      <p className="muted">It keeps trying on its own: once the host opens the table, you'll be in.</p>
      <button onClick={() => useStore.getState().leave()}>Back to the lobby</button>
    </div>
  );
}

export function Table() {
  const state = useStore((s) => s.state);
  const me = useStore((s) => s.me);
  const targeting = useStore((s) => s.targeting);
  const attaching = useStore((s) => s.targetMode === 'attach');
  const offline = useStore((s) => s.session?.role === 'client' && s.status !== 'connected');

  // Bring my preferred playmat and sleeves to this table, once (changing them later saves new preferences).
  const seated = useStore((s) => !!(s.me && s.state?.players[s.me]));
  useEffect(() => {
    if (!seated) return;
    const { me, state } = useStore.getState();
    const player = me ? state?.players[me] : undefined;
    const mat = loadPlaymatPref();
    if (mat && mat !== player?.playmat) act({ type: 'setPlaymat', mat });
    const sleeve = loadSleevePref();
    if (sleeve && sleeve !== player?.sleeve) act({ type: 'setSleeve', sleeve });
  }, [seated]);

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

  if (!state || !me || !state.players[me]) return <Joining />;

  const opponents = state.seats.filter((id) => id !== me);
  const layout = opponentLayout(opponents.length);
  return (
    <div className={`app${targeting ? ' is-targeting' : ''}`}>
      <TopBar state={state} />
      <main className="table">
        {opponents.length > 0 && (
          <div
            className="opponents"
            style={{
              flexBasis: `${layout.share}%`,
              gridTemplateColumns: `repeat(${layout.rows.length === 1 ? layout.rows[0] : layout.rows[0] * layout.rows[1]}, minmax(0, 1fr))`,
              // Per row of opponents: headers (as tall as the tallest one), then boards.
              gridTemplateRows: `repeat(${layout.rows.length}, auto minmax(0, 1fr))`,
            }}
          >
            {opponents.map((pid, i) => (
              <OpponentArea key={pid} state={state} pid={pid} style={opponentCell(layout.rows, i)} />
            ))}
          </div>
        )}
        <div className={`table-divider${opponents.length ? '' : ' alone'}`}>
          <StackZone state={state} />
        </div>
        <MyArea state={state} me={me} />
      </main>
      <SidePanel state={state} />
      <FocusBoard state={state} />
      <Viewer state={state} />
      <Arrows state={state} />
      <ZoomOverlay state={state} />
      <ContextMenu />
      <PromptDialog />
      <ConfirmDialog />
      <ImportDialog />
      <CreateDialog />
      <ArtDialog />
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
