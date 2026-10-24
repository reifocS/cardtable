import type { GameState } from '../core/types';
import { openMenu } from './actions';
import { Icon } from './Icon';
import { act, ask, useStore } from './store';
import { tip } from './tip';

/** My game actions, next to my cards. */
export function ActionBar({ state }: { state: GameState }) {
  const me = useStore((s) => s.me);
  const turnPlayer = state.turn.player ? state.players[state.turn.player] : null;
  const myTurn = state.turn.player === me;

  const turnMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Who goes first?', heading: true },
      { label: 'Random player', action: () => act({ type: 'setTurn', player: 'random', restart: true }) },
      ...state.seats.map((pid) => ({
        label: `${state.players[pid].name} goes first`,
        action: () => act({ type: 'setTurn', player: pid, restart: true }),
      })),
      { label: 'Give the turn to', heading: true },
      ...state.seats.map((pid) => ({
        label: state.players[pid].name,
        disabled: pid === state.turn.player,
        action: () => act({ type: 'setTurn', player: pid }),
      })),
    ]);

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
      { label: 'Mulligan', hint: 'M', action: () => act({ type: 'mulligan' }) },
    ]);

  return (
    <div className="actions">
      <button className="turn" style={{ color: turnPlayer?.color }} onClick={turnMenu} {...tip('Choose who starts, or whose turn it is')}>
        Turn {state.turn.number} · {turnPlayer?.name} ▾
      </button>
      <button className={`action${myTurn ? ' primary' : ''}`} onClick={() => act({ type: 'passTurn' })} {...tip('Pass the turn')}>
        <Icon name="passTurn" />
        <span>Pass turn</span>
      </button>
      <button className="action" onClick={() => act({ type: 'untapAll' })} {...tip('Untap all (U)')}>
        <Icon name="untap" />
        <span>Untap</span>
      </button>
      <button className="action" onClick={dice} {...tip('Dice and coin')}>
        <Icon name="dice" />
      </button>
      <button className="action" onClick={() => useStore.setState({ dialog: 'create' })} {...tip('Create a card or token (C)')}>
        <Icon name="token" />
      </button>
      {state.arrows.length > 0 && (
        <button className="action" onClick={() => act({ type: 'clearArrows' })} {...tip('Clear all arrows (or click one to remove it)')}>
          <Icon name="clearArrows" />
        </button>
      )}
      <button className="action" onClick={() => act({ type: 'undo' })} {...tip('Undo your last action (Ctrl/⌘Z)')}>
        <Icon name="undo" />
      </button>
      <button className="action" onClick={deck} {...tip('Deck: import, reset, mulligan', 'end')}>
        <Icon name="deck" />
        <span>Deck ▾</span>
      </button>
    </div>
  );
}
