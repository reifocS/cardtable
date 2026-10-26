/**
 * Easter eggs, for fun only: they never touch the game, and only the player who finds one sees it.
 * Warcraft III's cheat codes typed in the chat answer "Cheat Enabled!", each with a little something;
 * the turn medallion, clicked over and over, gets annoyed.
 */

/** Text shown low over the table for a few seconds, like Warcraft's in-game messages. */
export function announce(text: string, kind: 'cheat' | 'quip' = 'cheat') {
  document.querySelector(`.egg-message.${kind}`)?.remove();
  const el = document.createElement('div');
  el.className = `egg-message ${kind}`;
  el.textContent = text;
  document.body.appendChild(el);
  el.animate(
    [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'none', offset: 0.08 },
      { opacity: 1, offset: 0.8 },
      { opacity: 0 },
    ],
    { duration: 3200 },
  ).finished.finally(() => el.remove());
}

/** Gold pieces raining down over the table. */
function goldRain() {
  const layer = document.createElement('div');
  layer.className = 'egg-layer';
  document.body.appendChild(layer);
  const falls = Array.from({ length: 40 }, () => {
    const coin = document.createElement('i');
    coin.className = 'egg-coin';
    coin.style.left = `${Math.random() * 100}%`;
    layer.append(coin);
    const spin = 360 * (2 + Math.random() * 3);
    return coin.animate(
      [
        { transform: `translateY(-40px) rotateY(0deg)`, opacity: 1 },
        { transform: `translateY(${innerHeight + 40}px) rotateY(${spin}deg)`, opacity: 1 },
      ],
      { duration: 1400 + Math.random() * 900, delay: Math.random() * 900, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'both' },
    ).finished;
  });
  Promise.allSettled(falls).then(() => layer.remove());
}

/** A pale, ghostly wash over the table for a moment, the dead looking on. */
function ghosts() {
  const veil = document.createElement('div');
  veil.className = 'egg-layer egg-ghosts';
  document.body.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 2600 }).finished.finally(() =>
    veil.remove(),
  );
}

/** Night falls, then day returns. */
function night() {
  const veil = document.createElement('div');
  veil.className = 'egg-layer egg-night';
  document.body.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.65 }, { opacity: 0 }], { duration: 3600 }).finished.finally(() =>
    veil.remove(),
  );
}

/** A golden flash across the whole table. */
function flash() {
  const veil = document.createElement('div');
  veil.className = 'egg-layer egg-flash';
  document.body.appendChild(veil);
  veil.animate([{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0 }], { duration: 900 }).finished.finally(() => veil.remove());
}

const CHEATS: Record<string, () => void> = {
  whosyourdaddy: flash,
  greedisgood: goldRain,
  iseedeadpeople: ghosts,
  riseandshine: flash,
  lightsout: night,
  thereisnospoon: flash,
  allyourbasearebelongtous: flash,
  somebodysetusupthebomb: flash,
  pointbreak: flash,
  warpten: flash,
  keysersoze: goldRain,
  leafittome: goldRain,
};

/** Runs a cheat if `text` is one (case and spaces don't matter); says whether it was. */
export function cheat(text: string): boolean {
  const code = text.toLowerCase().replace(/\s+/g, '').replace(/\d+$/, '');
  const effect = CHEATS[code];
  if (!effect) return false;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) effect();
  announce('Cheat Enabled!');
  return true;
}

/** What the turn medallion says when it's clicked once too often. Our own lines, in that spirit. */
const QUIPS = [
  'Yes?',
  'Turn order. Very important. Clearly.',
  'I only count turns.',
  'Clicking me does not end your turn faster.',
  'Ready to… keep counting.',
  'I was forged for this, apparently.',
  'Stop poking the medallion.',
  'Fine. It is still the same turn.',
  'I have a family of coins, you know.',
  'One more click and I start counting backwards.',
];

let clicks = 0;
let last = 0;

/** A click on the turn medallion: after a few in quick succession, it starts talking back. */
export function pokeMedallion() {
  const now = performance.now();
  clicks = now - last < 900 ? clicks + 1 : 1;
  last = now;
  if (clicks >= 4) announce(QUIPS[Math.min(clicks - 4, QUIPS.length - 1)], 'quip');
}
