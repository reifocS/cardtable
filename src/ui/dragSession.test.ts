import { describe, expect, it } from 'vitest';
import { trackPress, type DragHandlers } from './dragSession';

const pointer = (type: string, x: number, y: number, extra: object = {}) => Object.assign(new Event(type), { clientX: x, clientY: y, ...extra });
const key = (k: string) => Object.assign(new Event('keydown', { cancelable: true }), { key: k });

function record(target: EventTarget) {
  const calls: string[] = [];
  const handlers: DragHandlers = {
    start: (at) => calls.push(`start ${at.x}`),
    move: (at) => calls.push(`move ${at.x}`),
    drop: (at) => calls.push(`drop ${at.x}${at.shiftKey ? ' shift' : ''}`),
    click: (at) => calls.push(`click ${at.x}`),
    cancel: () => calls.push('cancel'),
  };
  const stop = trackPress({ x: 0, y: 0 }, handlers, { target });
  return { calls, stop };
}

describe('a press of the pointer', () => {
  it('is a click while it stays within the threshold', () => {
    const t = new EventTarget();
    const { calls } = record(t);
    t.dispatchEvent(pointer('pointermove', 3, 0));
    t.dispatchEvent(pointer('pointerup', 3, 0));
    expect(calls).toEqual(['click 3']);
  });

  it('becomes a drag past it, and drops where released, with its keys', () => {
    const t = new EventTarget();
    const { calls } = record(t);
    t.dispatchEvent(pointer('pointermove', 10, 0));
    t.dispatchEvent(pointer('pointermove', 20, 0));
    t.dispatchEvent(pointer('pointerup', 25, 0, { shiftKey: true }));
    expect(calls).toEqual(['start 10', 'move 10', 'move 20', 'drop 25 shift']);
  });

  it('is over once released: later events are not its own', () => {
    const t = new EventTarget();
    const { calls } = record(t);
    t.dispatchEvent(pointer('pointerup', 0, 0));
    t.dispatchEvent(pointer('pointermove', 50, 0));
    t.dispatchEvent(pointer('pointerup', 50, 0));
    expect(calls).toEqual(['click 0']);
  });

  it('Esc cancels a drag, and goes no further', () => {
    const t = new EventTarget();
    const { calls } = record(t);
    let heard = false;
    t.addEventListener('keydown', () => (heard = true));
    t.dispatchEvent(pointer('pointermove', 10, 0));
    t.dispatchEvent(key('Escape'));
    t.dispatchEvent(pointer('pointerup', 10, 0));
    expect(calls).toEqual(['start 10', 'move 10', 'cancel']);
    expect(heard).toBe(false);
  });

  it("Esc before a drag isn't its business", () => {
    const t = new EventTarget();
    const { calls } = record(t);
    let heard = false;
    t.addEventListener('keydown', () => (heard = true));
    t.dispatchEvent(key('Escape'));
    t.dispatchEvent(pointer('pointerup', 0, 0));
    expect(heard).toBe(true);
    expect(calls).toEqual(['click 0']);
  });

  it('a cancelled pointer ends a drag without a drop', () => {
    const t = new EventTarget();
    const { calls, stop } = record(t);
    t.dispatchEvent(pointer('pointermove', 10, 0));
    t.dispatchEvent(new Event('pointercancel'));
    stop();
    expect(calls).toEqual(['start 10', 'move 10', 'cancel']);
  });
});
