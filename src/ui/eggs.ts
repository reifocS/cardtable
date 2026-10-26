/**
 * An easter egg, for fun only: it never touches the game, and only the player who finds it sees it.
 * Warcraft III's gold cheat typed in the chat answers "Cheat Enabled!" and rains gold.
 */

/** Text shown low over the table for a few seconds, like Warcraft's in-game messages. */
function announce(text: string) {
  document.querySelector('.egg-message')?.remove();
  const el = document.createElement('div');
  el.className = 'egg-message';
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

const CHEATS: Record<string, () => void> = {
  greedisgood: goldRain,
};

/** Runs the cheat if `text` is it (case, spaces and an amount don't matter); says whether it was. */
export function cheat(text: string): boolean {
  const code = text.toLowerCase().replace(/\s+/g, '').replace(/\d+$/, '');
  const effect = CHEATS[code];
  if (!effect) return false;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) effect();
  announce('Cheat Enabled!');
  return true;
}
