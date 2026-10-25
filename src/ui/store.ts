import { create } from 'zustand';
import type { Op } from '../core/ops';
import { zoneOf } from '../core/state';
import type { CardFace, CardId, GameState, PlayerId, Zone, ZoneId } from '../core/types';
import type { Ping } from '../net/presence';
import type { Route, Session, Status } from '../net/session';

export interface MenuItem {
  label: string;
  hint?: string;
  action?: () => void;
  /** Section heading, not clickable. */
  heading?: boolean;
  disabled?: boolean;
}

/** A yes/no question before something hard to undo. */
export interface Confirm {
  title: string;
  message: string;
  label: string;
  onConfirm: () => void;
}

export interface Prompt {
  title: string;
  value: string;
  submit: (value: string) => void;
}

export interface Store {
  session: Session | null;
  state: GameState | null;
  me: PlayerId | null;
  status: Status;
  error: string | null;
  route: Route;
  /** Seats I play myself (more than one when practicing both sides). */
  controlled: PlayerId[];
  /** Card each other player is hovering, and live pings (ephemeral, see net/presence). */
  hovers: Record<PlayerId, CardId>;
  pings: Ping[];

  selection: CardId[];
  hovered: CardId | null;
  /** Last card worth showing in the preview panel; sticks after the pointer leaves. */
  previewId: CardId | null;
  zoom: boolean;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  /** Floating list of a zone's cards. `ids` limits it to the cards that were looked at. */
  viewer: { zone: ZoneId; ids?: CardId[]; peeked: boolean } | null;
  dialog: 'import' | 'create' | 'help' | null;
  /** Deck list typed in the import dialog and not imported yet (null: none). */
  deckDraft: string | null;
  /** Card whose other printings are being picked from. */
  artFor: CardId | null;
  /** Opponent whose battlefield is shown big over the table. */
  focus: PlayerId | null;
  prompt: Prompt | null;
  confirm: Confirm | null;
  /** Source id while the player is picking a target: for an arrow, or a host to attach to. */
  targeting: string | null;
  targetMode: 'arrow' | 'attach';
  /** Cards to attach once the host is picked. */
  attachCards: CardId[];
  /** Logical width each battlefield is laid out at on this screen (see Board). */
  boardWidths: Record<ZoneId, number>;
  /** Faces of the last token I created, for "Create another". */
  lastToken: CardFace[] | null;

  connect(session: Session): void;
  leave(): void;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export const useStore = create<Store>((set, get) => ({
  session: null,
  state: null,
  me: null,
  status: 'connecting',
  error: null,
  route: null,
  controlled: [],
  hovers: {},
  pings: [],
  selection: [],
  hovered: null,
  previewId: null,
  zoom: false,
  menu: null,
  viewer: null,
  dialog: null,
  deckDraft: null,
  artFor: null,
  focus: null,
  prompt: null,
  confirm: null,
  targeting: null,
  targetMode: 'arrow',
  attachCards: [],
  boardWidths: {},
  lastToken: null,

  connect(session) {
    const sync = () => {
      const state = session.getState();
      const prev = get();
      // A selection belongs to one seat's view: switching seats starts afresh.
      const selection = state && session.me === prev.me ? prev.selection.filter((id) => state.cards[id]) : [];
      const controlled = session.controlled ?? (session.me ? [session.me] : []);
      set({
        state,
        me: session.me,
        status: session.status,
        error: session.error,
        route: session.route,
        // Same contents, same array: whatever reads these doesn't render again for nothing.
        controlled: sameIds(controlled, prev.controlled) ? prev.controlled : controlled,
        hovers: session.hovers,
        pings: session.pings,
        selection: sameIds(selection, prev.selection) ? prev.selection : selection,
      });
    };
    session.subscribe(sync);
    set({ session });
    sync();
  },

  leave() {
    get().session?.close();
    set({ session: null, state: null, me: null, selection: [], viewer: null, menu: null, dialog: null, artFor: null });
    history.replaceState(null, '', location.pathname);
  },
}));

export const act = (op: Op) => useStore.getState().session?.dispatch(op);

/** Zone `role` of `player`, defaulting to me. */
export function myZone(role: string, player?: PlayerId): Zone | undefined {
  const { state, me } = useStore.getState();
  const owner = player ?? me;
  return state && owner ? zoneOf(state, owner, role) : undefined;
}

export function setSelection(ids: CardId[]) {
  useStore.setState({ selection: ids });
}

/** Cards a shortcut or menu acts on: the selection if the hovered card is in it, else the hovered card. */
export function targetCards(hint?: CardId): CardId[] {
  const { selection, hovered } = useStore.getState();
  const focus = hint ?? hovered;
  if (focus) return selection.includes(focus) ? selection : [focus];
  return selection;
}

export function setBoardWidth(zone: ZoneId, width: number) {
  useStore.setState((s) => (s.boardWidths[zone] === width ? s : { boardWidths: { ...s.boardWidths, [zone]: width } }));
}

export function ask(title: string, value: string, submit: (v: string) => void) {
  useStore.setState({ prompt: { title, value, submit } });
}

export function askNumber(title: string, value: number, submit: (n: number) => void) {
  ask(title, String(value), (v) => {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) submit(n);
  });
}

// Dev only: when hot reload swaps this module out, close the session it holds. Otherwise the old
// one keeps running invisibly, holds the table code, and keeps answering peers.
import.meta.hot?.dispose(() => useStore.getState().session?.close());

// Dev only: reach the live store from the browser console (`__cardtable.getState()`).
if (import.meta.env.DEV) Object.assign(window, { __cardtable: useStore });
