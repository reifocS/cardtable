import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MOD } from './platform';
import { useStore } from './store';

/**
 * A short guided tour of the table, the first time someone sits at one: each step lights up a part of
 * the table and says what it's for, in a few words. Skipped or finished, it's not shown again (the help
 * can start it over).
 */

interface Step {
  /** What it lights up; none for a word in the middle of the screen. */
  target?: string;
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Cardtable',
    body: (
      <>
        A table to play cards with friends, as you would at a real one: nothing is enforced, everything is at hand, and the log keeps
        everyone honest. Here's the tour, in a minute.
      </>
    ),
  },
  {
    target: '.area.mine .area-body',
    title: 'Your battlefield',
    body: (
      <>
        Drag cards anywhere on it. <b>Double-click</b> a card to tap it. Drag across empty space to pick several at once, then move them
        together.
      </>
    ),
  },
  {
    target: '.tray > .hand',
    title: 'Your hand',
    body: (
      <>
        Only you see it. Drag a card onto your battlefield to play it, or onto the <b>Stack</b> in the middle to cast it where everyone
        sees it. Drag along the hand to sort it.
      </>
    ),
  },
  {
    target: '.tray-piles',
    title: 'Library and the other piles',
    body: (
      <>
        Click your library to <b>draw</b>; click any other pile to look through it. Drop a card on a pile to put it there (with{' '}
        <kbd>Shift</kbd>, at the bottom).
      </>
    ),
  },
  {
    target: '.table',
    title: 'Right-click anything',
    body: (
      <>
        Every card, pile and battlefield has a menu with all you can do there, including what a card's text says: <i>Scry 2</i>,{' '}
        <i>Create a Treasure</i>, <i>Proliferate</i>…
      </>
    ),
  },
  {
    target: '.topbar > .find',
    title: 'Find anything',
    body: (
      <>
        <kbd>{MOD}K</kbd> finds any card in sight or any action by typing a few letters: <i>sol ring</i>, <i>scry 2</i>, <i>draw 3</i>.
      </>
    ),
  },
  {
    target: '.area.mine .actions',
    title: 'Your turn and your tools',
    body: <>Pass the turn, untap, roll dice, import a deck, change your playmat and sleeves: it's all down here.</>,
  },
  {
    target: '.side',
    title: 'Preview and log',
    body: (
      <>
        Hover a card to see it big here (hold <kbd>Z</kbd> to zoom). Below, everything that happens at the table, and a chat.
      </>
    ),
  },
  {
    target: '.topbar .help-btn',
    title: 'Shortcuts',
    body: (
      <>
        Every key shortcut is in here (<kbd>?</kbd>), and this tour if you want it again. Have a good game!
      </>
    ),
  },
];

const SEEN_KEY = 'cardtable:tour:v1';

/** Whether this browser has had the tour (skipped counts). Storage may be unavailable: then it's as if seen, never nagging. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
  } catch {
    // Not kept: it'll be offered again next time, no harm.
  }
}

/** Room left around what's lit up, and between it and the bubble. */
const PAD = 8;
const GAP = 14;

type Box = { left: number; top: number; width: number; height: number };

/** Where what a step lights up is, followed as the table moves (a card played, a window resized). */
function useTarget(selector: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    if (!selector) return;
    let raf = 0;
    let was = '';
    const tick = () => {
      const r = document.querySelector(selector)?.getBoundingClientRect();
      const next = r && r.width && r.height ? { left: r.left - PAD, top: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD } : null;
      const key = next ? `${Math.round(next.left)},${Math.round(next.top)},${Math.round(next.width)},${Math.round(next.height)}` : '';
      if (key !== was) {
        was = key;
        setBox(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selector]);
  return selector ? box : null;
}

/** The steps whose part of the table is there (a spectator has no hand, a narrow bar may hide one). */
const available = () => STEPS.filter((s) => !s.target || document.querySelector(s.target));

export function Tour() {
  const on = useStore((s) => s.tour);
  if (!on) return null;
  return <TourSteps steps={available()} />;
}

function TourSteps({ steps }: { steps: Step[] }) {
  const [i, setI] = useState(0);
  const step = steps[i];
  const box = useTarget(step?.target);
  const bubble = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const last = i === steps.length - 1;

  const end = () => {
    markSeen();
    useStore.setState({ tour: false });
  };
  const go = (by: number) => (i + by >= steps.length ? end() : setI(Math.max(0, i + by)));

  // The bubble beside what's lit up: below it if there's room, else above, else to its side; always on screen.
  useLayoutEffect(() => {
    const b = bubble.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(12, Math.min(vw - b.width - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(vh - b.height - 12, y));
    if (!box) return setPos({ left: (vw - b.width) / 2, top: (vh - b.height) / 2 });
    const cx = box.left + box.width / 2 - b.width / 2;
    const cy = box.top + box.height / 2 - b.height / 2;
    if (box.top + box.height + GAP + b.height < vh) return setPos({ left: clampX(cx), top: box.top + box.height + GAP });
    if (box.top - GAP - b.height > 0) return setPos({ left: clampX(cx), top: box.top - GAP - b.height });
    if (box.left - GAP - b.width > 0) return setPos({ left: box.left - GAP - b.width, top: clampY(cy) });
    if (box.left + box.width + GAP + b.width < vw) return setPos({ left: box.left + box.width + GAP, top: clampY(cy) });
    // Something as big as the screen: the bubble over its middle.
    setPos({ left: clampX(cx), top: clampY(cy) });
  }, [box, i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      // The tour has the keys while it's on: nothing behind it reacts.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!step) return null;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* The table dimmed but for what's lit up (a ring with the whole screen as its shadow). */}
      {box ? <div className="tour-light" style={box} /> : <div className="tour-dim" />}
      <div className="tour-bubble" ref={bubble} style={pos ?? { visibility: 'hidden' }}>
        <div className="tour-step muted">
          {i + 1} / {steps.length}
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={end}>
            {last ? 'Close' : 'Skip the tour'}
          </button>
          <div className="spacer" />
          {i > 0 && <button onClick={() => go(-1)}>Back</button>}
          <button className="primary" autoFocus onClick={() => go(1)}>
            {i === 0 ? 'Show me' : last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
