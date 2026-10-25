import { STEPS_IN_ORDER, firesOn, triggersOf, type Trigger } from '../cards/triggers';
import type { Card, GameState } from '../core/types';
import { useStore } from './store';
import { tip } from './tip';

interface Reminder {
  card: Card;
  trigger: Trigger;
  step: number;
}

/** What triggers during the current player's turn, from the cards in play, in turn order. */
function thisTurn(state: GameState): Reminder[] {
  const play = state.preset.parts.play;
  if (!play) return [];
  const out: Reminder[] = [];
  for (const zone of Object.values(state.zones)) {
    if (zone.role !== play) continue;
    for (const id of zone.cards) {
      const card = state.cards[id];
      const face = card?.faceDown ? undefined : card?.faces[card.face];
      for (const trigger of triggersOf(face?.text)) {
        if (!firesOn(trigger, zone.owner, state.turn.player)) continue;
        out.push({ card, trigger, step: STEPS_IN_ORDER.findIndex((s) => s.id === trigger.phase) });
      }
    }
  }
  return out.sort((a, b) => a.step - b.step);
}

const SHOWN = 3;

/**
 * This turn's triggers, on the line across the table: each card in play whose Oracle text fires
 * during the current player's turn, in turn order (read with fixed patterns, see cards/triggers).
 * Hints only, like a friend saying "don't forget your upkeep"; they update as the turn passes.
 */
export function Reminders({ state }: { state: GameState }) {
  const on = useStore((s) => s.reminders);
  const reminders = on ? thisTurn(state) : [];
  if (!reminders.length) return null;
  return (
    <div className="reminders">
      <span className="reminders-label">This turn</span>
      {reminders.slice(0, SHOWN).map(({ card, trigger, step }, i) => (
        <button
          key={`${card.id}:${i}`}
          className="reminder"
          style={{ '--owner': state.players[state.zones[card.zone]?.owner]?.color } as React.CSSProperties}
          {...tip(trigger.text, 'end')}
          onPointerEnter={() => useStore.setState({ previewId: card.id })}
          onClick={() => useStore.getState().session?.point({ card: card.id })}
        >
          <span className="reminder-step">{STEPS_IN_ORDER[step]?.name}</span>
          <span className="reminder-name">{card.faces[card.face]?.name}</span>
        </button>
      ))}
      {reminders.length > SHOWN && (
        <span className="reminder more" {...tip(reminders.slice(SHOWN).map((r) => r.card.faces[r.card.face]?.name).join(', '), 'end')}>
          +{reminders.length - SHOWN}
        </span>
      )}
    </div>
  );
}
