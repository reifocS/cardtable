import { useEffect, useRef, useState } from 'react';
import type { Card, GameState } from '../core/types';
import { FaceView } from './CardView';
import { formatCounter } from './counters';
import { cheat } from './eggs';
import { act, useStore } from './store';

function Preview({ state }: { state: GameState }) {
  const previewId = useStore((s) => s.previewId);
  const card = previewId ? state.cards[previewId] : undefined;
  if (!card?.faces.length) {
    return (
      <div className="preview empty">
        <p>Hover a card to see it here.</p>
        <p className="muted">Hold Z to zoom.</p>
      </div>
    );
  }
  // A new card starts on the face it shows on the table.
  return <PreviewCard key={card.id} card={card} />;
}

function PreviewCard({ card }: { card: Card }) {
  const [face, setFace] = useState<number | null>(null);
  const shown = face ?? card.face;
  const counters = Object.entries(card.counters);
  return (
    <div className="preview">
      <div className="preview-card">
        <FaceView face={card.faces[shown] ?? card.faces[0]} large />
      </div>
      <div className="preview-meta">
        {card.faceDown && <span className="tag">Face down — only you see it</span>}
        {card.revealedTo.includes('*') && <span className="tag">Revealed</span>}
        {card.token && <span className="tag">Token</span>}
        {card.note && <span className="tag note-tag">“{card.note}”</span>}
        {!!card.tax && <span className="tag">Commander tax: +{card.tax}</span>}
        {counters.map(([k, n]) => (
          <span key={k} className="tag counter-tag">
            {formatCounter(k, n)}
          </span>
        ))}
      </div>
      {card.faces.length > 1 && (
        <div className="preview-faces">
          {card.faces.map((f, i) => (
            <button key={f.name} className={i === shown ? 'on' : ''} onClick={() => setFace(i)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Log({ state }: { state: GameState }) {
  const list = useRef<HTMLDivElement>(null);
  const spectating = useStore((s) => !!s.session?.spectating);
  const [text, setText] = useState('');
  const last = state.log[state.log.length - 1];
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.text]);

  return (
    <div className="log">
      <div className="log-entries" ref={list}>
        {state.log.map((l) => {
          const p = l.by ? state.players[l.by] : undefined;
          if (l.kind === 'turn') return <div key={l.id} className="log-turn">{l.text}</div>;
          return (
            <div key={l.id} className={`log-entry${l.kind === 'chat' ? ' chat' : ''}`}>
              <b style={{ color: p?.color }}>{p?.name ?? '?'}</b>
              {l.kind === 'chat' ? ': ' : ' '}
              {l.text}
            </div>
          );
        })}
      </div>
      {/* Spectators read the log; only players speak. */}
      {!spectating && (
      <form
        className="chat"
        onSubmit={(e) => {
          e.preventDefault();
          // A Warcraft cheat code plays out for me alone instead of going to the chat.
          if (!cheat(text)) act({ type: 'chat', text });
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something…" maxLength={500} />
      </form>
      )}
    </div>
  );
}

export function SidePanel({ state }: { state: GameState }) {
  return (
    <aside className="side">
      <Preview state={state} />
      <Log state={state} />
    </aside>
  );
}

/** Full-screen card while Z is held. */
export function ZoomOverlay({ state }: { state: GameState }) {
  const zoom = useStore((s) => s.zoom);
  const id = useStore((s) => s.hovered ?? s.previewId);
  const card = id ? state.cards[id] : undefined;
  if (!zoom || !card?.faces.length) return null;
  return (
    <div className="zoom">
      {card.faces.map((f) => (
        <div key={f.name} className="zoom-card">
          <FaceView face={f} large />
        </div>
      ))}
    </div>
  );
}
