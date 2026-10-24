import { memo, type CSSProperties } from 'react';
import type { Card, CardFace, Zone } from '../core/types';
import { cardMenu, openMenu, toMyBattlefield } from './actions';
import { onCardPointerDown } from './drag';
import { act, useStore } from './store';

export function FaceView({ face, large }: { face: CardFace; large?: boolean }) {
  if (face.image) return <img src={large ? (face.imageLarge ?? face.image) : face.image} alt={face.name} draggable={false} loading="lazy" />;
  return (
    <div className="text-card">
      <div className="text-card-name">{face.name}</div>
      {face.text && <div className="text-card-text">{face.text}</div>}
    </div>
  );
}

export function CardBack() {
  return <div className="card-back" />;
}

function hover(card: Card) {
  useStore.setState(card.faces.length ? { hovered: card.id, previewId: card.id } : { hovered: card.id });
}

function unhover(card: Card) {
  if (useStore.getState().hovered === card.id) useStore.setState({ hovered: null });
}

function onDoubleClick(card: Card, zone: Zone) {
  if (zone.kind === 'free') act({ type: 'tap', cards: [card.id] });
  else toMyBattlefield([card.id]);
}

interface Props {
  card: Card;
  zone: Zone;
  style?: CSSProperties;
  /** Shown as the top of a pile: right-click and double-click belong to the pile, not the card. */
  pileTop?: boolean;
}

export const CardView = memo(function CardView({ card, zone, style, pileTop }: Props) {
  const selected = useStore((s) => s.selection.includes(card.id));
  const me = useStore((s) => s.me);
  const face = card.faces[card.face] ?? card.faces[0];
  const counters = Object.entries(card.counters);
  const onBoard = zone.kind === 'free';
  const classes = ['card', selected && 'selected', onBoard && card.rotation && 'tapped', card.revealedTo.some((p) => p !== me) && 'revealed'];

  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      data-card-id={card.id}
      style={{ ...style, ...(onBoard && card.rotation ? { transform: `rotate(${card.rotation}deg)` } : null) }}
      onPointerDown={(e) => onCardPointerDown(e, card, zone)}
      onPointerEnter={() => hover(card)}
      onPointerLeave={() => unhover(card)}
      onDoubleClick={pileTop ? undefined : () => onDoubleClick(card, zone)}
      onContextMenu={pileTop ? undefined : (e) => openMenu(e, cardMenu(card, zone))}
    >
      {face && !card.faceDown ? <FaceView face={face} /> : <CardBack />}
      {card.faceDown && face && <span className="peek" title="Face down — only you can see it">👁</span>}
      {card.token && <span className="token-badge">token</span>}
      {!!card.tax && <span className="tax-badge" title="Commander tax">+{card.tax}</span>}
      {counters.length > 0 && (
        <div className="counters">
          {counters.map(([key, n]) => (
            <button
              key={key}
              className="counter"
              title={`${key} — click +1, right-click −1`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => act({ type: 'counter', cards: [card.id], key, delta: 1 })}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                act({ type: 'counter', cards: [card.id], key, delta: -1 });
              }}
            >
              {key === '+1/+1' ? `+${n}/+${n}` : `${key} ${n}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
