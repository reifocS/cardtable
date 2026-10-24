import { useState } from 'react';
import type { GameState } from '../core/types';
import { openMenu } from './actions';
import { act, ask, useStore } from './store';

export function TopBar({ state }: { state: GameState }) {
  const session = useStore((s) => s.session)!;
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const me = useStore((s) => s.me)!;
  const [copied, setCopied] = useState(false);
  const turnPlayer = state.turn.player ? state.players[state.turn.player] : null;

  const copyInvite = async () => {
    await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${session.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const dice = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Flip a coin', action: () => act({ type: 'roll', sides: 2 }) },
      ...[4, 6, 8, 10, 12, 20].map((n) => ({ label: `Roll d${n}`, action: () => act({ type: 'roll', sides: n }) })),
      { label: 'Roll dN…', action: () => ask('Number of sides', '100', (v) => act({ type: 'roll', sides: parseInt(v, 10) })) },
    ]);

  const deck = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Import deck…', action: () => useStore.setState({ dialog: 'import' }) },
      { label: 'Reset my deck (new game)', action: () => act({ type: 'resetDeck' }) },
      { label: 'Create card / token…', hint: 'C', action: () => useStore.setState({ dialog: 'create' }) },
      { label: 'Rename me…', action: () => ask('Your name', state.players[me].name, (name) => act({ type: 'rename', name })) },
      { label: 'Leave table', action: () => useStore.getState().leave() },
    ]);

  return (
    <header className="topbar">
      <span className="brand">Cardtable</span>
      <button className="code" onClick={copyInvite} title="Copy invite link">
        {copied ? 'Link copied!' : `Table ${session.code}`}
      </button>
      <span className={`status ${status}`} title={error ?? status}>
        {session.role === 'host' ? 'hosting' : status}
        {error && ` · ${error}`}
      </span>
      <div className="spacer" />
      <span className="turn" style={{ color: turnPlayer?.color }}>
        Turn {state.turn.number} · {turnPlayer?.name}
      </span>
      <button onClick={() => act({ type: 'passTurn' })}>Pass turn</button>
      <button onClick={() => act({ type: 'untapAll' })} title="Untap all (U)">
        Untap
      </button>
      <button onClick={dice}>🎲</button>
      {state.arrows.length > 0 && <button onClick={() => act({ type: 'clearArrows' })}>Clear arrows</button>}
      <button onClick={() => act({ type: 'undo' })} title="Undo your last action (Ctrl/⌘Z)">
        Undo
      </button>
      <button onClick={deck}>Deck ▾</button>
      <button onClick={() => useStore.setState({ dialog: 'help' })} title="Shortcuts (?)">
        ?
      </button>
    </header>
  );
}
