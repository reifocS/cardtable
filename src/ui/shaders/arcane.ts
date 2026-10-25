import { COMMON } from './common';

/**
 * Arcane: a nebula through a window on the void. Violet, blue and rose dust churning slowly, darker
 * lanes across it, stars twinkling, and now and then a shooting star.
 */
export const ARCANE = `${COMMON}
// A star per cell at most, somewhere in it, twinkling at its own pace. Distances in canvas pixels.
float stars(vec2 frag, float cell, float chance, float seed) {
  vec2 id = floor(frag / cell);
  if (hash(id + seed) > chance) return 0.0;
  vec2 at = (id + 0.15 + 0.7 * vec2(hash(id + seed + 1.3), hash(id + seed + 7.7))) * cell;
  float size = (0.6 + 1.2 * hash(id + seed + 3.1)) * uPixels / 60.0;
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + 2.0 * hash(id + seed + 5.9)) + 6.283 * hash(id + seed));
  float d = length(frag - at);
  return exp(-d * d / (size * size)) * twinkle;
}

// A shooting star: one at a random moment 2 to 15 s into each 17 s, crossing in under a second.
// (The first second of a period is always dark: ShaderMat's still frame relies on it.)
float shootingStar(vec2 uv) {
  float window = floor(uTime / 17.0);
  float start = window * 17.0 + 2.0 + hash(vec2(window, 3.0)) * 13.0;
  float t = (uTime - start) / 0.9;
  if (t < 0.0 || t > 1.0) return 0.0;
  // In units of the canvas height, so the streak keeps its shape on wide boards.
  float aspect = uSize.x / uSize.y;
  vec2 from = vec2((0.2 + 0.6 * hash(vec2(window, 1.0))) * aspect, 0.75 + 0.2 * hash(vec2(window, 2.0)));
  vec2 dir = normalize(vec2(hash(vec2(window, 4.0)) > 0.5 ? 1.0 : -1.0, -0.45));
  vec2 rel = uv * vec2(aspect, 1.0) - (from + dir * t * 0.8);
  vec2 back = -dir;
  float along = dot(rel, back);
  float across = length(rel - back * along);
  float tail = smoothstep(0.25, 0.0, along) * step(0.0, along);
  float fade = sin(t * 3.1416);
  return tail * smoothstep(0.004, 0.0, across) * fade;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uSize;
  vec2 p = frag / uPixels * 0.3;
  float t = uTime * 0.02;

  // Noise folded into noise, twice: the swirls of a nebula.
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 3.0 * r);

  vec3 c = vec3(0.02, 0.008, 0.05);
  c = mix(c, vec3(0.40, 0.14, 0.60), clamp(f * f * 2.4, 0.0, 1.0));
  c = mix(c, vec3(0.10, 0.27, 0.62), clamp(length(q) * 0.9 - 0.25, 0.0, 1.0) * 0.75);
  c = mix(c, vec3(0.78, 0.30, 0.58), clamp(r.x * r.x * 1.4 - 0.25, 0.0, 1.0) * 0.55);
  c += vec3(0.95, 0.82, 1.0) * pow(f, 5.0) * 1.6;
  // Lanes of dark dust.
  c *= 0.45 + 0.55 * smoothstep(0.25, 0.6, fbm(p * 2.2 + r * 1.5));

  c += vec3(0.9, 0.9, 1.0) * stars(frag, uPixels * 0.55, 0.22, 0.0);
  c += vec3(0.75, 0.8, 1.0) * stars(frag, uPixels * 0.23, 0.12, 9.0) * 0.6;
  c += vec3(0.95, 0.92, 1.0) * shootingStar(uv);

  c *= 0.7 + 0.3 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
