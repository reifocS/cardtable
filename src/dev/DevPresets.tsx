import { useEffect, useState } from 'react';
import { HostSession } from '../net/host';
import { makeCode } from '../net/session';
import { useStore } from '../ui/store';
import { PRESETS, buildPreset, type DevPreset } from './presets';

/** ?preset=<id> opens once per page load, so a reload reopens the same preset. */
const urlPreset = PRESETS.find((x) => x.id === new URLSearchParams(location.search).get('preset'));
let urlPresetOpened = false;

function takeUrlPreset(): DevPreset | undefined {
  if (urlPresetOpened) return undefined;
  urlPresetOpened = true;
  return urlPreset;
}

async function openPreset(p: DevPreset) {
  try {
    const { state, me } = await buildPreset(p);
    const saved = { code: makeCode(), me, state, savedAt: Date.now(), controlled: p.controlsAll ? state.seats : undefined };
    const session = new HostSession(state.players[me].name, saved, { persist: false, keepPresence: true });
    // &mat=<id> tries a playmat on my board, whatever the preset gives it.
    const mat = new URLSearchParams(location.search).get('mat');
    if (mat) session.dispatch({ type: 'setPlaymat', mat });
    useStore.getState().connect(session);
    history.replaceState(null, '', `?preset=${p.id}${mat ? `&mat=${encodeURIComponent(mat)}` : ''}`);
    requestAnimationFrame(() =>
      p.after?.({ me, state: session.getState(), dispatch: (op) => session.dispatch(op), set: (s) => useStore.setState(s) }),
    );
  } catch (e) {
    console.error('Preset failed', e);
    alert(`Preset "${p.id}" failed: ${(e as Error).message}`);
  }
}

/** Dev builds only: one click to a ready-made table, to eyeball the UI for regressions. */
export default function DevPresets() {
  const [busy, setBusy] = useState<string | null>(() => (urlPresetOpened ? null : (urlPreset?.id ?? null)));
  const load = (p: DevPreset) => {
    setBusy(p.id);
    openPreset(p).finally(() => setBusy(null));
  };

  useEffect(() => {
    const p = takeUrlPreset();
    if (p) openPreset(p).finally(() => setBusy(null));
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
