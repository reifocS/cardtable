import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../core/types';

/** How long a roll stays on the table once it has landed, in ms. */
const SHOWN_MS = 2600;
/** How long the die tumbles before it lands. */
const TUMBLE_MS = 900;

type Roll = { id: number; who: string; color: string; sides: number; value: number };

/** A roll or a flip, read back from its log line ("rolled a d20: 14", "flipped a coin: heads"). */
function parse(text: string): { sides: number; value: number } | null {
  const coin = /^flipped a coin: (heads|tails)$/.exec(text);
  if (coin) return { sides: 2, value: coin[1] === 'heads' ? 1 : 2 };
  const die = /^rolled a d(\d+): (\d+)$/.exec(text);
  return die ? { sides: Number(die[1]), value: Number(die[2]) } : null;
}

/** The die's outline for its number of sides; a d100 and anything unusual get the d20's. */
const SHAPES: Record<number, string> = {
  4: 'polygon(50% 4%, 96% 92%, 4% 92%)',
  6: 'inset(6% round 14%)',
  8: 'polygon(50% 2%, 98% 50%, 50% 98%, 2% 50%)',
  10: 'polygon(50% 2%, 96% 40%, 80% 94%, 20% 94%, 4% 40%)',
  12: 'polygon(50% 2%, 93% 27%, 93% 73%, 50% 98%, 7% 73%, 7% 27%)',
};

/** A crown for heads, a shield for tails. */
const HEADS = 'M8 34 L4 12 L16 22 L24 6 L32 22 L44 12 L40 34 Z M8 38 H40 V43 H8 Z';
const TAILS = 'M24 4 L42 10 V24 C42 34 34 41 24 45 C14 41 6 34 6 24 V10 Z';

function Die({ roll }: { roll: Roll }) {
  // Faces flash past while it tumbles, then it lands on the result.
  const [face, setFace] = useState(() => 1 + Math.floor(Math.random() * roll.sides));
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const spin = setInterval(() => setFace(1 + Math.floor(Math.random() * roll.sides)), 70);
    const land = setTimeout(() => {
      clearInterval(spin);
      setFace(roll.value);
      setLanded(true);
    }, TUMBLE_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(land);
    };
  }, [roll]);
  return (
    <div className={`roll-die${landed ? ' landed' : ''}`}>
      <div className="roll-die-body" style={{ clipPath: SHAPES[roll.sides] ?? 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)' }}>
        <span>{landed ? roll.value : face}</span>
      </div>
    </div>
  );
}

function Coin({ roll }: { roll: Roll }) {
  return (
    <div className="roll-coin" style={{ '--land': roll.value === 1 ? '1800deg' : '1980deg' } as React.CSSProperties}>
      <div className="roll-coin-face heads">
        <svg viewBox="0 0 48 48" aria-hidden>
          <path d={HEADS} />
        </svg>
      </div>
      <div className="roll-coin-face tails">
        <svg viewBox="0 0 48 48" aria-hidden>
          <path d={TAILS} />
        </svg>
      </div>
    </div>
  );
}

/**
 * Dice and coins, played out over the table for everyone: a bone die tumbling onto its number, or a
 * bronze coin spun into the air and landing heads or tails, with who threw it and what came up. Rolls
 * already in the log when the table opens aren't replayed. Click to dismiss.
 */
export function RollFx({ state }: { state: GameState }) {
  const lastId = state.log[state.log.length - 1]?.id ?? 0;
  const seen = useRef(lastId);
  const [roll, setRoll] = useState<Roll | null>(null);

  useEffect(() => {
    let latest: Roll | null = null;
    for (const e of state.log) {
      if (e.id <= seen.current || e.kind) continue;
      const r = parse(e.text);
      const p = e.by ? state.players[e.by] : undefined;
      if (r) latest = { id: e.id, who: p?.name ?? '', color: p?.color ?? '#ddd', ...r };
    }
    seen.current = lastId;
    if (latest) setRoll(latest);
  }, [lastId, state.log, state.players]);

  useEffect(() => {
    if (!roll) return;
    const t = setTimeout(() => setRoll(null), (roll.sides === 2 ? 1300 : TUMBLE_MS) + SHOWN_MS);
    return () => clearTimeout(t);
  }, [roll]);

  if (!roll) return null;
  const result = roll.sides === 2 ? (roll.value === 1 ? 'Heads' : 'Tails') : String(roll.value);
  return (
    <div className="roll-fx" key={roll.id} onClick={() => setRoll(null)}>
      {roll.sides === 2 ? <Coin roll={roll} /> : <Die roll={roll} />}
      <div className="roll-caption">
        <b style={{ color: roll.color }}>{roll.who}</b> {roll.sides === 2 ? 'flips a coin' : `rolls a d${roll.sides}`}
        <span className="roll-result">{result}</span>
      </div>
    </div>
  );
}
