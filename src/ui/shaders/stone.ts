import { COMMON } from './common';

/**
 * Stone: a floor of irregular flagstones, each its own shade, pitted and worn smooth at the
 * edges, set in mortar with a little moss, the odd crack. Drawn once (it doesn't move).
 */
export const STONE = `${COMMON}
vec2 jitter(vec2 cell) {
  return 0.15 + 0.7 * vec2(hash(cell + 0.7), hash(cell + 3.1));
}

void main() {
  vec2 p = boardFrag() / uPixels;
  vec2 uv = boardFrag() / uSize;

  // Flagstones: cells around scattered points, the mortar where two are equally near.
  vec2 q = p * 0.55 + 0.25 * vec2(fbm(p * 0.8), fbm(p * 0.8 + 5.0));
  vec2 i = floor(q);
  vec2 f = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 stone = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + jitter(i + g) - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        stone = i + g;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float edge = d2 - d1;
  float seed = hash(stone);

  vec3 c = mix(vec3(0.27, 0.28, 0.30), vec3(0.38, 0.36, 0.33), seed);
  c = mix(c, vec3(0.30, 0.33, 0.36), smoothstep(0.7, 1.0, hash(stone + 9.0)) * 0.6);
  // Surface: broad mottling, then pits.
  c *= 0.85 + 0.25 * fbm(p * 2.5 + seed * 10.0);
  c *= 1.0 - 0.1 * smoothstep(0.5, 0.9, fbm(p * 9.0 + seed * 4.0));
  // Worn round at the edges.
  c *= 0.62 + 0.38 * smoothstep(0.0, 0.22, edge);
  // A crack across some stones.
  if (seed > 0.82) {
    float crack = abs(fbm(p * 1.2 + seed * 20.0) - 0.5);
    // Kept to the middle of the stone, fading before the edges.
    float reach = smoothstep(0.6, 0.3, length(q - stone - jitter(stone)));
    c *= 1.0 - 0.4 * smoothstep(0.006, 0.0, crack) * smoothstep(0.06, 0.16, edge) * reach;
  }

  // Mortar, darker, with moss in places.
  float mortar = smoothstep(0.07, 0.035, edge);
  vec3 joint = mix(vec3(0.12, 0.12, 0.12), vec3(0.16, 0.22, 0.11), smoothstep(0.5, 0.75, fbm(p * 1.3 + 2.0)));
  c = mix(c, joint * (0.8 + 0.3 * noise(p * 20.0)), mortar);

  c *= 0.64 + 0.36 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
