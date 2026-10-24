import { useEffect, useState } from 'react';
import { HostSession } from '../net/host';
import { makeCode } from '../net/session';
import { useStore } from '../ui/store';
import { PRESETS, buildPreset, type DevPreset } from './presets';

/** Loads ?preset=<id> once per page load, so a reload reopens the same preset. */
let autoLoaded = false;

/** Dev builds only: one click to a ready-made table, to eyeball the UI for regressions. */
export default function DevPresets() {
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (p: DevPreset) => {
    setBusy(p.id);
    try {
      const { state, me } = await buildPreset(p);
      const session = new HostSession(state.players[me].name, { code: makeCode(), me, state, savedAt: Date.now() }, { persist: false, keepPresence: true });
      useStore.getState().connect(session);
      history.replaceState(null, '', `?preset=${p.id}`);
      requestAnimationFrame(() =>
        p.after?.({ me, state: session.getState(), dispatch: (op) => session.dispatch(op), set: (s) => useStore.setState(s) }),
      );
    } catch (e) {
      console.error('Preset failed', e);
      alert(`Preset "${p.id}" failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('preset');
    const p = PRESETS.find((x) => x.id === id);
    if (p && !autoLoaded) {
      autoLoaded = true;
      load(p);
    }
  }, []);

  return (
    <section className="dev-presets">
      <div className="or">dev presets (local only)</div>
      {PRESETS.map((p) => (
        <button key={p.id} className="dev-preset" disabled={!!busy} onClick={() => load(p)} title={p.covers}>
          <b>{p.name}</b>
          <span className="muted">{busy === p.id ? 'Loading cards…' : p.covers}</span>
        </button>
      ))}
    </section>
  );
}
