import type { Card, GameState, PlayerId, Zone } from './types';

const isShownTop = (card: Card, zone: Zone) => !!zone.topVisible && zone.cards[0] === card.id;

export function canSee(card: Card, zone: Zone, viewer: PlayerId): boolean {
  if (card.revealedTo.includes('*') || card.revealedTo.includes(viewer)) return true;
  if (isShownTop(card, zone) && (zone.topVisible === 'all' || zone.owner === viewer)) return true;
  // You may always look at your own face-down cards.
  if (card.faceDown) return zone.owner === viewer;
  if (zone.visibility === 'public') return true;
  if (zone.visibility === 'owner') return zone.owner === viewer;
  return false;
}

/** Visible to every player at the table. */
export function isPublic(card: Card, zone: Zone): boolean {
  if (isShownTop(card, zone) && zone.topVisible === 'all') return true;
  return card.revealedTo.includes('*') || (!card.faceDown && zone.visibility === 'public');
}

/** The state as `viewer` is allowed to know it: faces of unseen cards are stripped. */
export function redact(s: GameState, viewer: PlayerId): GameState {
  const cards: GameState['cards'] = {};
  for (const card of Object.values(s.cards)) {
    const zone = s.zones[card.zone];
    cards[card.id] = zone && canSee(card, zone, viewer) ? card : { ...card, faces: [], face: 0 };
  }
  return { ...s, cards };
}
