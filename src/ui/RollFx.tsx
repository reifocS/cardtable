import { useCallback, useEffect, useRef, useState } from 'react';
import { throwDie } from './dice3d';
import { useStore } from './store';
import type { GameState } from '../core/types';

/** How long a roll stays on the table once it has come to rest, in ms. */
const SHOWN_MS = 2600;

type Roll = { id: number; who: string; color: string; sides: number; value: number; mine: boolean };

/** A roll or a flip, read back from its log line ("rolled a d20: 14", "flipped a coin: heads"). */
function parse(text: string): { sides: number; value: number } | null {
  const coin = /^flipped a coin: (heads|tails)$/.exec(text);
  if (coin) return { sides: 2, value: coin[1] === 'heads' ? 1 : 2 };
  const die = /^rolled a d(\d+): (\d+)$/.exec(text);
  return die ? { sides: Number(die[1]), value: Number(die[2]) } : null;
}

/** The die (or coin) itself, thrown when it mounts; tells when it has come to rest. */
function Thrown({ roll, onRest }: { roll: Roll; onRest: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const thrown = throwDie(roll.sides, roll.value, roll.sides === 2 ? 84 : 78, still, !roll.mine);
    ref.current!.append(thrown.element);
    const rest = setTimeout(onRest, thrown.seconds * 1000);
    return () => {
      thrown.stop();
      clearTimeout(rest);
      thrown.element.remove();
    };
  }, [roll, onRest]);
  return <div className="roll-throw" ref={ref} />;
}

/**
 * Dice and coins, played out over the table for everyone: a bone die thrown and bouncing to rest on its
 * number, or a bronze coin tossed spinning into the air and landing heads or tails (ui/dice3d.ts), with
 * who threw it and, once it rests, what came up. Rolls already in the log when the table opens aren't
 * replayed. Click to dismiss.
 */
export function RollFx({ state }: { state: GameState }) {
  const me = useStore((s) => s.me);
  const lastId = state.log[state.log.length - 1]?.id ?? 0;
  const seen = useRef(lastId);
  const [roll, setRoll] = useState<Roll | null>(null);
  const [rested, setRested] = useState(false);
  const onRest = useCallback(() => setRested(true), []);

  useEffect(() => {
    let latest: Roll | null = null;
    for (const e of state.log) {
      if (e.id <= seen.current || e.kind) continue;
      const r = parse(e.text);
      const p = e.by ? state.players[e.by] : undefined;
      if (r) latest = { id: e.id, who: p?.name ?? '', color: p?.color ?? '#ddd', mine: e.by === me, ...r };
    }
    seen.current = lastId;
    if (latest) {
      setRoll(latest);
      setRested(false);
    }
  }, [lastId, state.log, state.players, me]);

  useEffect(() => {
    if (!rested) return;
    const t = setTimeout(() => setRoll(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [rested]);

  if (!roll) return null;
  const result = roll.sides === 2 ? (roll.value === 1 ? 'Heads' : 'Tails') : String(roll.value);
  return (
    <div className="roll-fx" key={roll.id} onClick={() => setRoll(null)}>
      <Thrown roll={roll} onRest={onRest} />
      <div className="roll-caption">
        <b style={{ color: roll.color }}>{roll.who}</b> {roll.sides === 2 ? 'flips a coin' : `rolls a d${roll.sides}`}
        {rested && <span className="roll-result">{result}</span>}
      </div>
    </div>
  );
}
