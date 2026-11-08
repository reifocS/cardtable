import { useState } from 'react';
import type { Op } from '../core/ops';
import type { Card, GameState, PlayerId, Zone } from '../core/types';
import { CardBack, FaceView } from './CardView';
import { formatCounter } from './counters';
import { Modal } from './Dialogs';
import { act, useStore } from './store';

type Hit = Extract<Op, { type: 'finishReveal' }>['hit'];

/** A cascade or discover of mine under way: what it hit, and what to do with it. */
export function RevealDialog({ state }: { state: GameState }) {
  const me = useStore((s) => s.me);
  const zone = Object.values(state.zones).find((z) => z.owner === me && z.reveal);
  return zone?.reveal ? <RevealPanel state={state} zone={zone} /> : null;
}

function RevealPanel({ state, zone }: { state: GameState; zone: Zone }) {
  const r = zone.reveal!;
  const hit = r.hit ? state.cards[r.hit] : undefined;
  const misses = r.misses.map((id) => state.cards[id]).filter(Boolean);
  const finish = (h: Hit) => act({ type: 'finishReveal', zone: zone.id, hit: h });
  const title = r.as === 'cascade' ? 'Cascade' : r.as === 'discover' ? `Discover ${r.max}` : `Revealed until mana value ${r.max} or less`;
  const choices: [Hit, string][] = !hit
    ? [['bottom', `Put ${misses.length === 1 ? 'it' : 'them'} on the bottom`]]
    : r.as === 'cascade'
      ? [['cast', 'Cast it'], ['bottom', "Don't cast it (to the bottom)"]]
      : r.as === 'discover'
        ? [['cast', 'Cast it'], ['hand', 'Put it into your hand']]
        : [['cast', 'Cast it'], ['hand', 'Into your hand'], ['exile', 'Leave it in exile'], ['bottom', 'To the bottom']];
  // A card imported before mana values were kept stops the reveal: the player checks it fits.
  const unknown = !!hit && hit.faces[0]?.cost === undefined;
  if (unknown && !choices.some(([h]) => h === 'bottom')) choices.push(['bottom', "Doesn't fit: to the bottom"]);

  return (
    // Nothing to close: the reveal waits for a choice, here or after a reload.
    <div className="modal-backdrop">
      <div className="modal wide reveal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <b>{title}</b>
        </div>
        <div className="reveal-body">
          <div className="reveal-hit" style={{ maxWidth: 220 }}>
            {hit ? <CardFace card={hit} width={190} /> : <p className="muted">No nonland card of mana value {r.max} or less.</p>}
            {unknown && <p className="problem">Its mana value isn't known here: check it's {r.max} or less.</p>}
          </div>
          {misses.length > 0 && (
            <div className="reveal-misses">
              <span className="muted">
                Passed {misses.length} card{misses.length === 1 ? '' : 's'}, to the bottom in a random order:
              </span>
              <div className="reveal-miss-cards">
                {misses.map((c) => (
                  <CardFace key={c.id} card={c} width={70} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions end">
          {choices.map(([h, label], i) => (
            <button key={h} className={i === 0 ? 'primary' : undefined} autoFocus={i === 0} onClick={() => finish(h)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CardFace({ card, width }: { card: Card; width: number }) {
  const face = card.faces[card.face] ?? card.faces[0];
  return (
    <div className="card" style={{ width }} onPointerEnter={() => face && useStore.setState({ previewId: card.id })}>
      {face ? <FaceView face={face} width={width} /> : <CardBack />}
    </div>
  );
}

/** Everything proliferate could reach: permanents with counters, players with counters (not life). */
export function ProliferateDialog({ state }: { state: GameState }) {
  const open = useStore((s) => s.dialog === 'proliferate');
  return open ? <ProliferateForm state={state} /> : null;
}

function ProliferateForm({ state }: { state: GameState }) {
  const me = useStore((s) => s.me);
  const close = () => useStore.setState({ dialog: null });
  const life = new Set(['Life', state.preset.commander?.tracker]);
  const playable = state.preset.parts.play;
  const cards = Object.values(state.cards).filter((c) => state.zones[c.zone]?.role === playable && Object.keys(c.counters).length);
  const players = state.seats
    .map((id) => state.players[id])
    .filter(Boolean)
    .map((p) => ({ p, keys: Object.keys(p.trackers).filter((k) => !life.has(k) && p.trackers[k] > 0) }))
    .filter((x) => x.keys.length);
  // Usually: my own permanents, my opponents' poison, and my own counters unless poison is among them
  // (a player gets one more of every kind).
  const [cardIds, setCardIds] = useState(() => new Set(cards.filter((c) => c.owner === me).map((c) => c.id)));
  const [playerIds, setPlayerIds] = useState(
    () => new Set<PlayerId>(players.filter(({ p, keys }) => keys.some((k) => /poison/i.test(k)) !== (p.id === me)).map(({ p }) => p.id)),
  );
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (!next.delete(v)) next.add(v);
    put(next);
  };
  const empty = !cards.length && !players.length;

  return (
    <Modal title="Proliferate" onClose={close} wide>
      {empty && <p className="muted">Nothing has counters yet.</p>}
      {cards.length > 0 && (
        <div className="proliferate-cards">
          {cards.map((c) => {
            const face = c.faces[c.face] ?? c.faces[0];
            const on = cardIds.has(c.id);
            return (
              <label key={c.id} className={`proliferate-card${on ? ' on' : ''}`} onPointerEnter={() => face && useStore.setState({ previewId: c.id })}>
                <input type="checkbox" checked={on} onChange={() => toggle(cardIds, c.id, setCardIds)} />
                <div className="card">{face && !c.faceDown ? <FaceView face={face} width={80} /> : <CardBack sleeve={state.players[c.owner]?.sleeve} />}</div>
                <span className="proliferate-counters">
                  {Object.entries(c.counters)
                    .map(([k, n]) => formatCounter(k, n))
                    .join(' · ')}
                </span>
                <span className="muted" style={{ color: state.players[c.owner]?.color }}>
                  {state.players[c.owner]?.name}
                </span>
              </label>
            );
          })}
        </div>
      )}
      {players.length > 0 && (
        <div className="proliferate-players">
          {players.map(({ p, keys }) => (
            <label key={p.id}>
              <input type="checkbox" checked={playerIds.has(p.id)} onChange={() => toggle(playerIds, p.id, setPlayerIds)} />{' '}
              <b style={{ color: p.color }}>{p.name}</b> <span className="muted">{keys.map((k) => `${k} ${p.trackers[k]}`).join(' · ')}</span>
            </label>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <span className="muted">+1 of each kind of counter on what's checked</span>
        <button
          className="primary"
          disabled={!cardIds.size && !playerIds.size}
          onClick={() => {
            close();
            act({ type: 'proliferate', cards: [...cardIds], players: [...playerIds] });
          }}
        >
          Proliferate
        </button>
      </div>
    </Modal>
  );
}
