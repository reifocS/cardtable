import { COLORS, manaOf, poolOf, type Color } from '../cards/mana';
import type { GameState, PlayerId } from '../core/types';
import { tip } from './tip';

const NAMES: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless' };

/**
 * The mana I can make right now: my untapped sources in play, read from their Oracle text (see
 * cards/mana). Each color shows the most of it I can get; sources that can't be read are counted
 * apart, never guessed.
 */
export function ManaPool({ state, me }: { state: GameState; me: PlayerId }) {
  const play = state.preset.parts.play;
  const zone = play ? state.zones[`${me}:${play}`] : undefined;
  if (!zone) return null;
  const sources = zone.cards.flatMap((id) => {
    const card = state.cards[id];
    if (!card || card.rotation || card.faceDown) return [];
    const face = card.faces[card.face];
    const source = manaOf(face?.text);
    return source ? [{ name: face.name, source }] : [];
  });
  if (!sources.length) return null;
  const pool = poolOf(sources);
  const colors = COLORS.filter((c) => pool.max[c] > 0);
  const detail = [
    `${pool.total} mana from untapped sources`,
    ...colors.map((c) => `up to ${pool.max[c]} ${NAMES[c]}`),
    ...(pool.special.length ? [`not counted: ${pool.special.join(', ')}`] : []),
  ].join(' · ');
  return (
    <div className="mana-pool" {...tip(detail)}>
      <span className="mana-total">{pool.total}</span>
      {colors.map((c) => (
        <span key={c} className={`mana-pip mana-${c}`}>
          {pool.max[c]}
        </span>
      ))}
      {pool.special.length > 0 && <span className="mana-special">+{pool.special.length}?</span>}
    </div>
  );
}
