import { COMMON } from './common';

/**
 * Felt: green baize under a hanging lamp. Fine crossing fibres, the marks left by a brush, a pool
 * of light in the middle and the edges in shadow. Drawn once (it doesn't move).
 */
export const FELT = `${COMMON}
void main() {
  vec2 p = boardFrag() / uPixels;
  vec2 uv = boardFrag() / uSize;

  // Fibres running both ways, and the fuzz between them.
  float warp = noise(vec2(p.x * 38.0, p.y * 7.0));
  float weft = noise(vec2(p.x * 8.0, p.y * 40.0));
  float fuzz = noise(p * 110.0);
  float fibres = 0.5 * (warp + weft);
  // The nap, brushed in long strokes.
  float nap = fbm(vec2(p.x * 0.35, p.y * 1.2) + 3.0);

  vec3 c = vec3(0.07, 0.31, 0.19);
  c *= 0.82 + 0.26 * fibres + 0.1 * fuzz;
  c *= 0.9 + 0.2 * nap;

  // The lamp above the table.
  float aspect = uSize.x / uSize.y;
  float d = length((uv - vec2(0.5, 0.52)) * vec2(aspect * 0.6, 1.0));
  c *= 1.18 - 0.7 * smoothstep(0.1, 0.95, d);
  c += vec3(0.04, 0.05, 0.02) * smoothstep(0.6, 0.0, d);
  color = vec4(c, 1.0);
}
`;
