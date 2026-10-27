import { useState } from 'react';
import type { GameState } from '../core/types';
import { Icon } from './Icon';
import { openMenu, switchToNextSeat } from './actions';
import { act, ask, useStore } from './store';
import { tip } from './tip';

/** Room-level controls only: invite, connection, who I am, help. Game actions live in the bottom bar. */
export function TopBar({ state }: { state: GameState }) {
  const session = useStore((s) => s.session)!;
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const route = useStore((s) => s.route);
  const me = useStore((s) => s.me);
  const spectating = !!session.spectating;
  const controlled = useStore((s) => s.controlled);
  const [copied, setCopied] = useState(false);

  const seatsMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Seats you play', heading: true },
      ...controlled.map((pid) => ({
        label: `${pid === me ? '✓ ' : ''}${state.players[pid]?.name ?? pid}`,
        action: () => session.switchSeat?.(pid),
      })),
      { label: 'Add a seat you play yourself…', action: () => ask('Name of the seat', 'Opponent', (name) => session.addSeat?.(name)) },
    ]);

  const confirmLeave = () =>
    useStore.setState({
      confirm: {
        title: 'Leave the table?',
        message:
          session.role === 'host'
            ? "You're hosting: leaving closes the table for everyone. The game is saved, and you can resume it from the lobby."
            : 'You can come back any time with the same invite link.',
        label: 'Leave',
        onConfirm: () => useStore.getState().leave(),
      },
    });

  const [copiedWatch, setCopiedWatch] = useState(false);
  const copyLink = async (watch: boolean) => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${session.code}${watch ? '/watch' : ''}`);
    (watch ? setCopiedWatch : setCopied)(true);
    setTimeout(() => (watch ? setCopiedWatch : setCopied)(false), 1500);
  };
  const copyInvite = () => copyLink(false);

  const turnPlayer = state.turn.player ? state.players[state.turn.player] : undefined;

  return (
    <header className="topbar">
      {/* The turn, in a medallion hanging from the middle of the bar, in the colour of whose turn it is. */}
      <div
        className="turn-medal"
        style={{ '--player': turnPlayer?.color ?? '#555' } as React.CSSProperties}
        {...tip(turnPlayer ? `Turn ${state.turn.number}: ${turnPlayer.name}` : `Turn ${state.turn.number}`)}
      >
        <span>{state.turn.number}</span>
      </div>
      <span className="brand">Cardtable</span>
      <button className="code" onClick={copyInvite} {...tip('Copy the invite link')}>
        {copied ? (
          'Link copied!'
        ) : (
          <>
            <span className="code-word">Table </span>
            {session.code}
          </>
        )}
      </button>
      <button className="icon-btn" onClick={() => copyLink(true)} {...tip(copiedWatch ? 'Watch link copied!' : 'Copy a link to watch the game without a seat')}>
        <Icon name="watch" />
      </button>
      <span className={`status ${status}`} title={error ?? status}>
        {session.role === 'host' ? 'hosting' : status}
        {route && ` · ${route === 'relay' ? 'via relay' : 'direct'}`}
        {error && ` · ${error}`}
      </span>
      <div className="spacer" />
      {spectating && <span className="watching-badge">Watching</span>}
      {me && controlled.length > 1 && (
        <button
          className="seat-switch"
          style={{ color: state.players[me]?.color }}
          onClick={() => switchToNextSeat()}
          {...tip('Switch to your other seat (`)')}
        >
          <span className="seat-word">Playing as </span>
          {state.players[me]?.name} ⇄
        </button>
      )}
      {session.role === 'host' && (
        <button className="icon-btn" onClick={seatsMenu} {...tip('Seats you play yourself', 'end')}>
          <Icon name="seats" />
        </button>
      )}
      {me && state.players[me] && (
        <button
          className="icon-btn"
          {...tip('Rename me', 'end')}
          onClick={() => ask('Your name', state.players[me].name, (name) => act({ type: 'rename', name }))}
        >
          <Icon name="rename" />
          <span className="me-name">{state.players[me].name}</span>
        </button>
      )}
      <button
        className="icon-btn"
        {...tip('Leave the table', 'end')}
        onClick={confirmLeave}
      >
        <Icon name="leave" />
      </button>
      <button className="icon-btn" onClick={() => useStore.setState({ dialog: 'help' })} {...tip('Help and shortcuts (?)', 'end')}>
        <Icon name="help" />
      </button>
    </header>
  );
}
