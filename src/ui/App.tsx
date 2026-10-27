import { Component, Suspense, lazy, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { ClientSession } from '../net/client';
import { HostSession, deleteSavedGame, listSavedGames, type SavedGame } from '../net/host';
import type { Session } from '../net/session';
import { GithubLink } from './Icon';
import { useStore } from './store';
import { tip } from './tip';
import { Table } from './Table';

const NAME_KEY = 'cardtable:name';
// Dev builds only; the import is dropped from production bundles.
const DevPresets = import.meta.env.DEV ? lazy(() => import('../dev/DevPresets')) : null;
/** Effects run twice in dev (StrictMode); only ever auto-join once per page load. */
let autoJoined = false;

function timeAgo(t: number) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** A saved table: click to resume; ✕ then "Delete?" to forget it (two clicks, it can't be undone). */
function SavedRow({ game, onResume, onDelete }: { game: SavedGame; onResume: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <div className="saved-row">
      <button className="saved-game" onClick={onResume}>
        <span className="code">{game.code}</span>
        <span className="muted">{Object.values(game.state.players).map((p) => p.name).join(', ')}</span>
        <span className="muted">{timeAgo(game.savedAt)}</span>
      </button>
      {confirming ? (
        <button className="danger" onClick={onDelete}>
          Delete?
        </button>
      ) : (
        <button className="saved-delete" onClick={() => setConfirming(true)} {...tip(`Delete table ${game.code}`, 'end')}>
          ✕
        </button>
      )}
    </div>
  );
}

/** The public demo: a ready-made table to try everything out. Loaded on demand, it needs card data. */
function DemoButton() {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const [{ openPreset }, { DEMO }] = await Promise.all([import('../dev/DevPresets'), import('../dev/presets')]);
      await openPreset(DEMO);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={open} disabled={busy} title="A Commander duel, midgame, both seats yours to play">
      {busy ? 'Setting the table…' : 'Try a demo table'}
    </button>
  );
}

function Lobby() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  // #code joins a table; #code/watch opens it to watch.
  const [code, setCode] = useState(() => location.hash.slice(1).replace(/\/watch$/, ''));
  const watchLink = location.hash.endsWith('/watch');
  const [saved, setSaved] = useState(listSavedGames);
  const connect = useStore((s) => s.connect);

  const start = (make: (n: string) => Session) => {
    const n = name.trim() || 'Player';
    localStorage.setItem(NAME_KEY, n);
    const session = make(n);
    connect(session);
    // Joiners keep the code in the URL so a reload rejoins; hosts resume from the lobby instead.
    history.replaceState(null, '', session.role === 'client' ? `#${session.code}${session.spectating ? '/watch' : ''}` : location.pathname);
  };

  const join = () => code.trim() && start((n) => new ClientSession(n, code.trim().toLowerCase()));
  const watch = () => code.trim() && start((n) => new ClientSession(n, code.trim().toLowerCase(), true));

  // A reload while seated at a table goes straight back to it.
  const rejoin = useEffectEvent(() => {
    if (autoJoined || !code) return;
    // A watch link opens the table straight away; a seat is only taken back after a reload.
    if (watchLink) {
      autoJoined = true;
      return watch();
    }
    if (!sessionStorage.getItem(`cardtable:seat:${code}`)) return;
    autoJoined = true;
    join();
  });
  useEffect(() => {
    rejoin();
  }, []);

  return (
    <div className="lobby">
      <h1>Cardtable</h1>
      <p className="muted">A table for any card game. Import a deck, share the code, hop in voice, play.</p>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Player" maxLength={32} autoFocus />
      </label>
      <button className="primary big" onClick={() => start((n) => new HostSession(n))}>
        Create a table
      </button>
      <button
        onClick={() =>
          start((n) => {
            const session = new HostSession(n);
            session.addSeat('Practice opponent');
            return session;
          })
        }
        title="One table, two seats you play yourself: test a deck against another"
      >
        Practice: play both sides
      </button>
      <DemoButton />
      {saved.length > 0 && (
        <div className="saved">
          <div className="or">or resume one you hosted</div>
          {saved.map((g) => (
            <SavedRow
              key={g.code}
              game={g}
              onResume={() => start((n) => new HostSession(n, g))}
              onDelete={() => {
                deleteSavedGame(g.code);
                setSaved(listSavedGames());
              }}
            />
          ))}
        </div>
      )}
      <div className="or">or join a friend</div>
      <form
        className="lobby-row"
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
      >
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Table code" />
        <button disabled={!code.trim()}>Join</button>
        <button type="button" disabled={!code.trim()} onClick={watch} {...tip('Watch the game without a seat')}>
          Watch
        </button>
      </form>
      {DevPresets && (
        <Suspense fallback={null}>
          <DevPresets />
        </Suspense>
      )}
      <footer className="lobby-footer">
        <GithubLink label="Open source on GitHub" />
      </footer>
    </div>
  );
}

class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lobby">
        <h1>Something broke</h1>
        <pre className="problem">{this.state.error.message}</pre>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
        <p className="muted">If you were hosting, use "Resume table" in the lobby. The game is saved.</p>
      </div>
    );
  }
}

export function App() {
  const session = useStore((s) => s.session);
  return <Crash>{session ? <Table /> : <Lobby />}</Crash>;
}
