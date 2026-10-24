import { useState } from 'react';
import type { GameState } from '../core/types';
import { Icon } from './Icon';
import { act, ask, useStore } from './store';

/** Room-level controls only: invite, connection, who I am, help. Game actions live in the bottom bar. */
export function TopBar({ state }: { state: GameState }) {
  const session = useStore((s) => s.session)!;
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const route = useStore((s) => s.route);
  const me = useStore((s) => s.me)!;
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${session.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <header className="topbar">
      <span className="brand">Cardtable</span>
      <button className="code" onClick={copyInvite} title="Copy invite link">
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
        title="Rename me"
        onClick={() => ask('Your name', state.players[me].name, (name) => act({ type: 'rename', name }))}
      >
        <Icon name="rename" />
        <span>{state.players[me].name}</span>
      </button>
      <button
        className="icon-btn"
        title={session.role === 'host' ? 'Leave (the game is saved; resume it from the lobby)' : 'Leave table'}
        onClick={() => useStore.getState().leave()}
      >
        <Icon name="leave" />
      </button>
      <button className="icon-btn" onClick={() => useStore.setState({ dialog: 'help' })} title="Help and shortcuts (?)">
        <Icon name="help" />
      </button>
    </header>
  );
}
