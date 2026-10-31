import { useEffect, useState } from 'react';
import { useStore } from './store';

/** How often an open page asks whether a newer build is out. */
const CHECK_MS = 10 * 60 * 1000;
/** Coming back to the tab asks too, but not more often than this. */
const REFOCUS_MS = 60 * 1000;

/** The build being served now, or null if it can't be had (offline, or the dev server). */
async function served(): Promise<string | null> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const { build } = (await response.json()) as { build?: unknown };
    return typeof build === 'string' ? build : null;
  } catch {
    return null;
  }
}

/**
 * Says when a newer version has been deployed than the one on screen, and offers to reload. It never
 * reloads by itself: a host reloading leaves the table waiting until they resume it from the lobby.
 */
export function UpdateNotice() {
  const [newer, setNewer] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const session = useStore((s) => s.session);

  useEffect(() => {
    if (__BUILD__ === 'dev') return;
    let last = 0;
    const check = async () => {
      last = Date.now();
      const build = await served();
      if (build && build !== __BUILD__) setNewer(build);
    };
    const timer = setInterval(check, CHECK_MS);
    const onVisible = () => document.visibilityState === 'visible' && Date.now() - last > REFOCUS_MS && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!newer || newer === dismissed) return null;
  const note = !session
    ? null
    : session.role === 'host'
      ? "You're hosting: the others wait while you reload. Resume this table from the lobby and they'll reconnect on their own."
      : "You'll be taken straight back to the table.";
  return (
    <div className="update-notice" role="status">
      <div>
        <b>A new version of Cardtable is out.</b>
        {note && <p className="muted">{note}</p>}
      </div>
      <button className="primary" onClick={() => location.reload()}>
        Reload
      </button>
      <button onClick={() => setDismissed(newer)}>
        Later
      </button>
    </div>
  );
}
