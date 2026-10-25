import { memo } from 'react';
import type { Card, CardFace, Zone } from '../core/types';
import { isPublic } from '../core/visibility';
import { STACK, cardMenu, castToStack, isSpell, openMenu, resolve, toMyBattlefield } from './actions';
import { formatCounter } from './counters';
import { sleeveLook } from './playmats';
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

/** A card back, in its owner's sleeves when known. */
export function CardBack({ sleeve }: { sleeve?: string }) {
  const look = sleeveLook(sleeve);
  return <div className={`card-back ${look.className}`} style={look.style} />;
}

function hover(card: Card, zone: Zone) {
  useStore.setState(card.faces.length ? { hovered: card.id, previewId: card.id } : { hovered: card.id });
  // Others only see what I look at among cards they can see: never my hand or library.
  useStore.getState().session?.hover(isPublic(card, zone) ? card.id : null);
}

function unhover(card: Card) {
  if (useStore.getState().hovered !== card.id) return;
  useStore.setState({ hovered: null });
  useStore.getState().session?.hover(null);
}

/** Tap on a battlefield, resolve on the stack; from elsewhere, cast spells and play permanents. */
function onDoubleClick(card: Card, zone: Zone) {
  if (zone.kind === 'free') act({ type: 'tap', cards: [card.id] });
  else if (zone.id === STACK) resolve(card);
  else if (isSpell(card) && useStore.getState().state?.zones[STACK]) castToStack([card.id]);
  else toMyBattlefield([card.id]);
}

interface Props {
  card: Card;
  zone: Zone;
  /** Position on a board, in pixels. Plain numbers, not a style object, so memo can skip unchanged cards. */
  left?: number;
  top?: number;
  /** Shown as the top of a pile: right-click and double-click belong to the pile, not the card. */
  pileTop?: boolean;
}

export const CardView = memo(function CardView({ card, zone, left, top, pileTop }: Props) {
  const selected = useStore((s) => s.selection.includes(card.id));
  const me = useStore((s) => s.me);
  const sleeve = useStore((s) => s.state?.players[card.owner]?.sleeve);
  // Colors of the other players hovering this card (a string, so the selector stays cheap).
  const watchers = useStore((s) =>
    Object.entries(s.hovers)
      .filter(([p, c]) => c === card.id && p !== s.me)
      .map(([p]) => s.state?.players[p]?.color)
      .join(' '),
  );
  const ping = useStore((s) => s.pings.filter((p) => p.card === card.id).at(-1));
  const pingColor = useStore((s) => (ping ? s.state?.players[ping.by]?.color : undefined));
  const face = card.faces[card.face] ?? card.faces[0];
  const counters = Object.entries(card.counters);
  const onBoard = zone.kind === 'free';
  const classes = ['card', selected && 'selected', onBoard && card.rotation && 'tapped', card.revealedTo.some((p) => p !== me) && 'revealed', watchers && 'watched'];

  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      data-card-id={card.id}
      style={{
        ...(left != null && { left, top }),
        ...(onBoard && card.rotation ? { transform: `rotate(${card.rotation}deg)` } : null),
        ...(watchers ? ({ '--watch': watchers.split(' ')[0] } as React.CSSProperties) : null),
      }}
      onPointerDown={(e) => onCardPointerDown(e, card)}
      onPointerEnter={() => hover(card, zone)}
      onPointerLeave={() => unhover(card)}
      onDoubleClick={pileTop ? undefined : () => onDoubleClick(card, zone)}
      onContextMenu={pileTop ? undefined : (e) => openMenu(e, cardMenu(card, zone))}
    >
      {face && !card.faceDown ? <FaceView face={face} /> : <CardBack sleeve={sleeve} />}
      {card.faceDown && face && <span className="peek" title="Face down — only you can see it">👁</span>}
      {card.token && <span className="token-badge">token</span>}
      {card.note && <span className="note-badge">{card.note}</span>}
      {ping && <span key={ping.id} className="ping-ring" style={{ '--c': pingColor } as React.CSSProperties} />}
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
              {formatCounter(key, n)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
