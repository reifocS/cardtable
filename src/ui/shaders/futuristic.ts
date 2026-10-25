import { COMMON } from './common';

/**
 * Futuristic: a neon grid over deep blue. Its crossings flicker, pulses of light run along the
 * lines, and now and then a scan sweeps down the board.
 */
export const FUTURISTIC = `${COMMON}
const float STEP = 0.5;

// Brightness of a line at distance d (world units), about one canvas pixel wide.
float line(float d, float width) {
  return smoothstep(width, 0.0, d * uPixels);
}

// A pulse running along some of the lines of one direction: along = position on the line,
// across = distance to it, lineId = which line.
float pulses(float along, float across, float lineId, float seed) {
  float h = hash(vec2(lineId, seed));
  if (h < 0.72) return 0.0;
  float speed = 1.2 + 2.0 * hash(vec2(lineId, seed + 1.0));
  float span = 30.0;
  float at = mod(uTime * speed + h * span, span) - 3.0;
  float d = along - at;
  float trail = d < 0.0 ? exp(d * 1.6) : exp(-d * 14.0);
  return trail * line(across, 2.4);
}

void main() {
  vec2 p = gl_FragCoord.xy / uPixels;
  vec2 uv = gl_FragCoord.xy / uSize;

  vec3 c = mix(vec3(0.016, 0.035, 0.07), vec3(0.04, 0.09, 0.17), smoothstep(1.0, 0.1, length(uv - vec2(0.5, 0.45))));
  c += vec3(0.0, 0.25, 0.35) * 0.35 * smoothstep(0.4, 0.0, uv.y);

  vec2 g = p / STEP;
  vec2 cell = floor(g + 0.5);
  vec2 off = abs(g - cell) * STEP;
  vec3 cyan = vec3(0.18, 0.88, 1.0);
  float grid = max(line(off.x, 1.0), line(off.y, 1.0)) * 0.16;
  // Every fourth line brighter.
  vec2 major = abs(p / (STEP * 4.0) - floor(p / (STEP * 4.0) + 0.5)) * STEP * 4.0;
  grid += max(line(major.x, 1.4), line(major.y, 1.4)) * 0.22;
  c += cyan * grid;

  // Crossings, flickering each at its own pace.
  float node = line(length(off), 2.2) * (0.25 + 0.75 * step(0.86, hash(cell + floor(uTime * 1.5 + hash(cell) * 9.0))));
  c += cyan * node * 0.6;

  float run = pulses(p.x, off.y, cell.y, 1.0) + pulses(p.y, off.x, cell.x, 7.0);
  c += vec3(0.5, 0.95, 1.0) * run * 0.9;

  // A scan sweeping down every 9 s.
  float sweep = fract(uTime / 9.0) * 2.2 - 0.6;
  float band = 1.0 - uv.y - sweep;
  c += cyan * (smoothstep(-0.08, 0.0, band) * 0.12 + smoothstep(0.004, 0.0, abs(band)) * 0.35) * step(band, 0.004);

  c *= 0.7 + 0.3 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
