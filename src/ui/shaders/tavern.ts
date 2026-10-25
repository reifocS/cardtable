import { COMMON } from './common';

/**
 * Tavern: a table of wide oak planks, their ends staggered row to row, with grain and knots, lit
 * by the hearth below: warm, flickering softly, its light swaying.
 */
export const TAVERN = `${COMMON}
const float PLANK_H = 0.9;
const float PLANK_L = 6.5;

vec3 wood(vec2 p) {
  float row = floor(p.y / PLANK_H);
  float fy = fract(p.y / PLANK_H);
  // Each row starts its planks somewhere else, as real boards do.
  float x = p.x + hash(vec2(row, 1.0)) * PLANK_L;
  float plank = floor(x / PLANK_L);
  float fx = fract(x / PLANK_L);
  float seed = hash(vec2(row, plank));

  // Grain: lines along the plank, bent by stretched noise.
  float bend = fbm(vec2(x * 0.35, fy * 2.0 + seed * 7.0)) * 9.0;
  float lines = 0.5 + 0.5 * sin(fy * 14.0 + bend);
  float fine = fbm(vec2(x * 1.4, p.y * 26.0));
  vec3 tone = mix(vec3(0.30, 0.18, 0.09), vec3(0.42, 0.26, 0.13), seed);
  vec3 c = tone * (0.66 + 0.34 * smoothstep(0.15, 1.0, lines)) * (0.82 + 0.36 * fine);

  // A knot on some planks, the grain darkening around it.
  if (seed > 0.45) {
    vec2 at = vec2((plank + 0.2 + 0.6 * hash(vec2(seed, 2.0))) * PLANK_L - hash(vec2(row, 1.0)) * PLANK_L, (row + 0.3 + 0.4 * hash(vec2(seed, 5.0))) * PLANK_H);
    float d = length((p - at) * vec2(0.7, 2.2));
    c *= 1.0 - 0.6 * smoothstep(0.14, 0.0, d) - 0.15 * smoothstep(0.4, 0.1, d);
  }

  // Seams between rows and between plank ends.
  float seam = smoothstep(0.0, 0.035, fy) * smoothstep(1.0, 0.965, fy) * smoothstep(0.0, 0.004, fx) * smoothstep(1.0, 0.996, fx);
  return c * (0.25 + 0.75 * seam);
}

void main() {
  vec2 p = gl_FragCoord.xy / uPixels;
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = wood(p);

  // The hearth, below the table's edge: it breathes, and its light drifts from side to side.
  float flicker = 0.82 + 0.12 * noise(vec2(uTime * 2.3, 0.0)) + 0.06 * noise(vec2(uTime * 7.1, 3.0));
  vec2 fire = vec2(0.5 + 0.06 * (noise(vec2(uTime * 0.9, 8.0)) - 0.5), -0.35);
  float aspect = uSize.x / uSize.y;
  float d = length((uv - fire) * vec2(aspect * 0.55, 1.0));
  float light = exp(-d * 1.5) * flicker;
  c *= 0.4 + 1.15 * light;
  // Firelight is orange: it warms what it reaches.
  c = mix(c, c * vec3(1.45, 0.95, 0.55), clamp(light * 1.2, 0.0, 1.0));
  c += vec3(1.0, 0.42, 0.1) * light * light * 0.16;

  // Smoke-darkened corners, the middle worn lighter by hands and cards.
  c *= 0.62 + 0.38 * smoothstep(0.95, 0.2, length((uv - 0.5) * vec2(1.0, 1.3)));
  color = vec4(c, 1.0);
}
`;
