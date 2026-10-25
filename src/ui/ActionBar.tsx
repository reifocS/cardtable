import { zoneOf } from '../core/state';
import type { GameState } from '../core/types';
import { openMenu, openViewer } from './actions';
import { Icon } from './Icon';
import { PLAYMATS, SLEEVES, matId, matsAnimated, savePlaymatPref, saveSleevePref, setMatsAnimated } from './playmats';
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

  const mat = matId(me ? (state.players[me]?.playmat ?? 'felt') : 'felt');
  const sleeve = me ? (state.players[me]?.sleeve ?? 'official') : 'official';
  const setMat = (value: string) => {
    act({ type: 'setPlaymat', mat: value });
    savePlaymatPref(value);
  };
  const setSleeve = (value: string) => {
    act({ type: 'setSleeve', sleeve: value });
    saveSleevePref(value);
  };
  const isImage = (url: string) => /^https:\/\/[^\s"'()]+$/.test(url.trim());
  const customItem = (current: string, set: (v: string) => void) => ({
    label: `${current.startsWith('url:') ? '✓ ' : ''}Custom image…`,
    action: () =>
      ask('Image link (https://…)', current.startsWith('url:') ? current.slice(4) : '', (url) => isImage(url) && set(`url:${url.trim()}`)),
  });
  const looks = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Playmat (everyone sees it)', heading: true },
      ...PLAYMATS.map((m) => ({ label: `${mat === m.id ? '✓ ' : ''}${m.name}`, action: () => setMat(m.id) })),
      customItem(mat, setMat),
      { label: `${matsAnimated() ? '✓ ' : ''}Animated playmats (just for you)`, action: () => setMatsAnimated(!matsAnimated()) },
      { label: 'Sleeves (your card backs)', heading: true },
      ...SLEEVES.map((x) => ({ label: `${sleeve === x.id ? '✓ ' : ''}${x.name}`, action: () => setSleeve(x.id) })),
      customItem(sleeve, setSleeve),
    ]);

  const sideboard = me ? zoneOf(state, me, 'sideboard') : undefined;
  const deck = (e: React.MouseEvent) =>
    openMenu(e, [
      { label: 'Import deck…', action: () => useStore.setState({ dialog: 'import' }) },
      ...(sideboard ? [{ label: `View sideboard (${sideboard.cards.length})`, action: () => openViewer(sideboard) }] : []),
      { label: 'Reset my deck (new game)', action: () => act({ type: 'resetDeck' }) },
      { label: 'Mulligan', hint: 'M', action: () => act({ type: 'mulligan' }) },
    ]);

  return (
    <div className="actions">
      <button className="turn" style={{ color: turnPlayer?.color }} onClick={turnMenu} {...tip('Choose who starts, or whose turn it is')}>
        Turn {state.turn.number}
        <span className="turn-name"> · {turnPlayer?.name}</span> ▾
      </button>
      <button className={`action${myTurn ? ' primary' : ''}`} onClick={() => act({ type: 'passTurn' })} {...tip('Pass the turn')}>
        <Icon name="passTurn" />
        <span className="action-label pass-label">Pass turn</span>
      </button>
      <button className="action" onClick={() => act({ type: 'untapAll' })} {...tip('Untap all (U)')}>
        <Icon name="untap" />
        <span className="action-label">Untap</span>
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
      <button className="action" onClick={looks} {...tip('Playmat and sleeves')}>
        <Icon name="playmat" />
      </button>
      <button className="action" onClick={deck} {...tip('Deck: import, reset, mulligan', 'end')}>
        <Icon name="deck" />
        <span className="action-label">Deck ▾</span>
      </button>
    </div>
  );
}
