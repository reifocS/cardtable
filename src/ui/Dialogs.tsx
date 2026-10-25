import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseDeck, withPrinting, type DeckLine, type Section } from '../cards/deckParser';
import { deleteDeck, editLastDeck, guessDeckName, listDecks, loadLastDeck, saveDeck, saveLastDeck } from '../cards/decks';
import { lookupKey, printingsOf, resolveCards, searchCards, type Printing } from '../cards/scryfall';
import type { CardFace } from '../core/types';
import { CardImage } from './Zones';
import { createTokens } from './actions';
import { GithubLink } from './Icon';
import { act, useStore } from './store';
import { tip } from './tip';

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - r.width - 8),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && useStore.setState({ menu: null });
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  if (!menu) return null;
  return (
    <div className="menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((item, i) =>
        item.heading ? (
          <div key={i} className="menu-heading">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              useStore.setState({ menu: null });
              item.action?.();
            }}
          >
            <span>{item.label}</span>
            {item.hint && <kbd>{item.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <b>{title}</b>
          <button onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const closeDialog = () => useStore.setState({ dialog: null });

export function ConfirmDialog() {
  const confirm = useStore((s) => s.confirm);
  if (!confirm) return null;
  const close = () => useStore.setState({ confirm: null });
  return (
    <Modal title={confirm.title} onClose={close}>
      <p className="confirm-message">{confirm.message}</p>
      <div className="modal-actions end">
        {/* Focus starts on Cancel: Enter shouldn't leave by accident. */}
        <button autoFocus onClick={close}>
          Cancel
        </button>
        <button
          className="danger"
          onClick={() => {
            close();
            confirm.onConfirm();
          }}
        >
          {confirm.label}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialog() {
  const prompt = useStore((s) => s.prompt);
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(prompt?.value ?? '');
  }, [prompt]);
  if (!prompt) return null;
  const close = () => useStore.setState({ prompt: null });
  return (
    <Modal title={prompt.title} onClose={close}>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          close();
          prompt.submit(value);
        }}
      >
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        <button className="primary">OK</button>
      </form>
    </Modal>
  );
}

const PLACEHOLDER = `Paste a decklist. Supported:
4 Lightning Bolt
4x Lightning Bolt (M10) 146
Commander / Deck / Sideboard headers

Any other game: name | image URL
3 Pikachu | https://example.com/pikachu.png`;

export function ImportDialog() {
  const open = useStore((s) => s.dialog === 'import');
  const [text, setText] = useState(loadLastDeck);
  // Follow the last imported list when it changes elsewhere (a new art), unless it was edited here.
  const shown = useRef(text);
  useEffect(() => {
    if (!open) return;
    const last = loadLastDeck();
    if (text === shown.current) setText(last);
    shown.current = last;
  }, [open]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [decks, setDecks] = useState(listDecks);
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  if (!open) return null;

  const fetchLink = async () => {
    if (!link.trim()) return;
    setProblem(null);
    setBusy('Fetching the deck…');
    try {
      const res = await fetch(`/api/deck?url=${encodeURIComponent(link.trim())}`);
      const body = (await res.json().catch(() => ({}))) as { name?: string; text?: string; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `The server answered ${res.status}.`);
      setText(body.text);
      if (body.name) setName(body.name);
      setLink('');
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!text.trim()) return;
    const n = name.trim() || guessDeckName(text);
    setName(n);
    setDecks(saveDeck(n, text));
  };

  const run = async () => {
    const lines = parseDeck(text);
    if (!lines.length) return setProblem('No cards found in that list.');
    setProblem(null);
    setBusy('Looking up cards…');
    try {
      const lookups = lines.filter((l) => !l.image);
      const { found, missing } = lookups.length
        ? await resolveCards(lookups, (done, total) => setBusy(`Looking up cards… ${done}/${total}`))
        : { found: new Map<string, CardFace[]>(), missing: [] };
      const out: Record<Section, CardFace[][]> = { main: [], side: [], commander: [] };
      const facesFor = (l: DeckLine): CardFace[] =>
        l.image ? [{ name: l.name, image: l.image, imageLarge: l.image }] : (found.get(lookupKey(l)) ?? [{ name: l.name }]);
      for (const l of lines) for (let i = 0; i < l.count; i++) out[l.section].push(facesFor(l));
      act({ type: 'loadDeck', sections: out });
      saveLastDeck(text);
      shown.current = text;
      if (missing.length) {
        setProblem(`Imported, but not found on Scryfall (added as text cards): ${missing.join(', ')}`);
      } else {
        closeDialog();
      }
    } catch (e) {
      setProblem(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Import deck" onClose={closeDialog}>
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          fetchLink();
        }}
      >
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Deck link (Archidekt), or paste the list below" />
        <button disabled={!!busy || !link.trim()}>Fetch</button>
      </form>
      {decks.length > 0 && (
        <div className="saved-decks">
          {decks.map((d) => (
            <span key={d.name} className={`saved-deck${d.name === name ? ' on' : ''}`}>
              <button
                onClick={() => {
                  setText(d.text);
                  setName(d.name);
                }}
              >
                {d.name}
              </button>
              <button className="saved-deck-x" title={`Delete ${d.name}`} onClick={() => setDecks(deleteDeck(d.name))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea className="deck-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} autoFocus spellCheck={false} />
      <form
        className="prompt"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={text.trim() ? guessDeckName(text) : 'Deck name'} maxLength={60} />
        <button disabled={!text.trim()}>Save deck</button>
      </form>
      {problem && <p className="problem">{problem}</p>}
      <div className="modal-actions">
        <span className="muted">Replaces your current deck and shuffles it.</span>
        <button className="primary" disabled={!!busy || !text.trim()} onClick={run}>
          {busy ?? 'Import'}
        </button>
      </div>
    </Modal>
  );
}

/** Pick another printing of one of your cards; for all copies, the deck list remembers it. */
export function ArtDialog() {
  const card = useStore((s) => (s.artFor ? s.state?.cards[s.artFor] : undefined));
  const name = card?.faces[0]?.name;
  const [prints, setPrints] = useState<Printing[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [all, setAll] = useState(true);
  useEffect(() => {
    if (!name) return;
    let live = true;
    setPrints(null);
    setProblem(null);
    printingsOf(name).then(
      (p) => live && setPrints(p),
      (e: Error) => live && setProblem(e.message),
    );
    return () => {
      live = false;
    };
  }, [name]);
  if (!card || !name) return null;

  const close = () => useStore.setState({ artFor: null });
  const pick = (p: Printing) => {
    act({ type: 'setFaces', cards: [card.id], faces: p.faces, sameName: all });
    if (all) editLastDeck((text) => withPrinting(text, name, p.set, p.cn));
    close();
  };
  return (
    <Modal title={`Art for ${name}`} onClose={close} wide>
      <label className="check">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
        Every copy in my deck, and remember it in my deck list
      </label>
      {problem && <p className="problem">{problem}</p>}
      <div className="results">
        {prints?.map((p) => (
          <button key={`${p.set}:${p.cn}`} className={`result${p.faces[0].image === card.faces[0].image ? ' on' : ''}`} onClick={() => pick(p)} {...tip(p.label)}>
            <CardImage faces={p.faces} />
          </button>
        ))}
        {!prints && !problem && <p className="muted">Looking up printings…</p>}
        {prints?.length === 0 && <p className="muted">No other printings found.</p>}
      </div>
    </Modal>
  );
}

export function CreateDialog() {
  const open = useStore((s) => s.dialog === 'create');
  const [tab, setTab] = useState<'search' | 'custom'>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardFace[][]>([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState({ name: '', text: '', image: '', count: 1 });
  if (!open) return null;

  const create = (faces: CardFace[], count = 1) => createTokens(faces, count);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await searchCards(query));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Create card or token" onClose={closeDialog} wide>
      <div className="tabs">
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>
          Search Scryfall
        </button>
        <button className={tab === 'custom' ? 'on' : ''} onClick={() => setTab('custom')}>
          Custom card
        </button>
      </div>
      {tab === 'search' ? (
        <>
          <form
            className="prompt"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder='e.g. "t:token goblin" or "Treasure"' />
            <button className="primary" disabled={busy}>
              {busy ? '…' : 'Search'}
            </button>
          </form>
          <div className="results">
            {results.map((faces, i) => (
              <button key={i} className="result" title={`Create ${faces[0].name}`} onClick={() => create(faces)}>
                <CardImage faces={faces} />
              </button>
            ))}
            {!busy && query && results.length === 0 && <p className="muted">No results yet. Press Enter to search.</p>}
          </div>
        </>
      ) : (
        <form
          className="custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (!custom.name.trim()) return;
            create([{ name: custom.name.trim(), text: custom.text || undefined, image: custom.image || undefined, imageLarge: custom.image || undefined }], custom.count);
            closeDialog();
          }}
        >
          <input autoFocus placeholder="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          <textarea placeholder="Text (optional)" value={custom.text} onChange={(e) => setCustom({ ...custom, text: e.target.value })} />
          <input placeholder="Image URL (optional)" value={custom.image} onChange={(e) => setCustom({ ...custom, image: e.target.value })} />
          <label>
            Count{' '}
            <input type="number" min={1} max={50} value={custom.count} onChange={(e) => setCustom({ ...custom, count: Math.max(1, Math.min(50, +e.target.value || 1)) })} />
          </label>
          <button className="primary">Create</button>
        </form>
      )}
      <p className="muted">Created cards are tokens on your battlefield. Click a result as many times as you need.</p>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Hover', 'Preview card in the side panel'],
  ['Hold Z', 'Zoom the hovered card'],
  ['Drag', 'Move cards (Alt-drop on a battlefield: face down; Shift-drop on a pile: bottom)'],
  ['Shift/⌘-click, drag on board', 'Multi-select'],
  ['Double-click', 'Tap · cast an instant or sorcery · play a permanent · resolve from the stack'],
  ['Drop on "Stack"', 'Cast a spell where everyone sees it; double-click it to resolve'],
  ['Right-click', 'Everything else'],
  ['T', 'Tap / untap'],
  ['F', 'Turn face down / up'],
  ['X', 'Transform (next face)'],
  ['+ / −', '+1/+1 counter'],
  ['A', 'Target with an arrow (click an arrow to remove it)'],
  ['N', 'Write a note on the card'],
  ['Shift C', 'Create another of the last token'],
  ['⌘/Ctrl A', 'Select every card on your battlefield'],
  ['Right-click → Attach to…', 'Attach an aura or equipment; it moves with the card'],
  ['R', 'Reveal to everyone'],
  ['P / Alt-click', 'Ping a card (or a spot on a battlefield) for everyone'],
  ['B / H / G / E / L', 'To battlefield / hand / graveyard / exile / library'],
  ['D', 'Draw'],
  ['S', 'Shuffle library'],
  ['U', 'Untap all'],
  ['M', 'Mulligan'],
  ['C', 'Create card / token'],
  ['Del', 'Delete token'],
  ['⌘/Ctrl Z', 'Undo your last action'],
  ['`', 'Two-seat practice: switch to your other seat'],
  ['Esc', 'Cancel / close / deselect'],
];

export function HelpDialog() {
  const open = useStore((s) => s.dialog === 'help');
  if (!open) return null;
  return (
    <Modal title="Controls" onClose={closeDialog}>
      <table className="help">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">No rules are enforced: do what you would do at a real table, and the log keeps everyone honest.</p>
      <GithubLink />
      <p className="muted credits">
        Icons by Lorc, Delapouite, Catsu, Faithtoken, Quoting and Sbed from{' '}
        <a href="https://game-icons.net" target="_blank" rel="noreferrer">
          game-icons.net
        </a>
        , CC BY 3.0. Card data and images from{' '}
        <a href="https://scryfall.com" target="_blank" rel="noreferrer">
          Scryfall
        </a>
        .
      </p>
    </Modal>
  );
}
