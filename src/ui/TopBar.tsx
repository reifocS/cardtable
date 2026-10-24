import { useState } from 'react';
import type { GameState } from '../core/types';
import { Icon } from './Icon';
import { act, ask, useStore } from './store';
import { tip } from './tip';

/** Room-level controls only: invite, connection, who I am, help. Game actions live in the bottom bar. */
export function TopBar({ state }: { state: GameState }) {
  const session = useStore((s) => s.session)!;
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const route = useStore((s) => s.route);
  const me = useStore((s) => s.me)!;
  const [copied, setCopied] = useState(false);

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

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${session.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <header className="topbar">
      <span className="brand">Cardtable</span>
      <button className="code" onClick={copyInvite} {...tip('Copy the invite link')}>
        {copied ? 'Link copied!' : `Table ${session.code}`}
      </button>
      <span className={`status ${status}`} title={error ?? status}>
        {session.role === 'host' ? 'hosting' : status}
        {route && ` · ${route === 'relay' ? 'via relay' : 'direct'}`}
        {error && ` · ${error}`}
      </span>
      <div className="spacer" />
      <button
        className="icon-btn"
        {...tip('Rename me', 'end')}
        onClick={() => ask('Your name', state.players[me].name, (name) => act({ type: 'rename', name }))}
      >
        <Icon name="rename" />
        <span>{state.players[me].name}</span>
      </button>
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
