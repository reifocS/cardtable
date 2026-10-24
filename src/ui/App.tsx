import { Component, useEffect, useState, type ReactNode } from 'react';
import { ClientSession } from '../net/client';
import { HostSession, listSavedGames } from '../net/host';
import type { Session } from '../net/session';
import { GithubLink } from './Icon';
import { useStore } from './store';
import { Table } from './Table';

const NAME_KEY = 'cardtable:name';
/** Effects run twice in dev (StrictMode); only ever auto-join once per page load. */
let autoJoined = false;

function timeAgo(t: number) {
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function Lobby() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState(() => location.hash.slice(1));
  const [saved] = useState(listSavedGames);
  const connect = useStore((s) => s.connect);

  const start = (make: (n: string) => Session) => {
    const n = name.trim() || 'Player';
    localStorage.setItem(NAME_KEY, n);
    const session = make(n);
    connect(session);
    // Joiners keep the code in the URL so a reload rejoins; hosts resume from the lobby instead.
    history.replaceState(null, '', session.role === 'client' ? `#${session.code}` : location.pathname);
  };

  const join = () => code.trim() && start((n) => new ClientSession(n, code.trim().toLowerCase()));

  // A reload while seated at a table goes straight back to it.
  useEffect(() => {
    if (autoJoined || !code || !sessionStorage.getItem(`cardtable:seat:${code}`)) return;
    autoJoined = true;
    join();
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
      {saved.length > 0 && (
        <div className="saved">
          <div className="or">or resume one you hosted</div>
          {saved.map((g) => (
            <button key={g.code} className="saved-game" onClick={() => start((n) => new HostSession(n, g))}>
              <span className="code">{g.code}</span>
              <span className="muted">{Object.values(g.state.players).map((p) => p.name).join(', ')}</span>
              <span className="muted">{timeAgo(g.savedAt)}</span>
            </button>
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
      </form>
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
