import { COMMON } from './common';

/**
 * A stormy sea seen from above: swells crossing from several directions, wind chop, foam tearing
 * off the crests, the overcast sky glinting on the slopes, and now and then a flash of lightning.
 * Units are world units (see ShaderMat), so waves keep their size whatever the board's.
 */
export const STORM = `${COMMON}
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Distance to the nearest edge between drifting cells: near 0 along a lacy network of lines.
float cellEdge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.5 * sin(uTime * 0.5 + 6.283 * hash2(i + g));
      float d = length(g + o - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return d2 - d1;
}

// Nine trains of waves around the wind's direction, each shorter and fainter than the last. Like
// real deep-water waves, longer ones travel faster; together they make a sea with no pattern.
float sea(vec2 p) {
  vec2 q = p + 0.6 * vec2(fbm(p * 0.3 + uTime * 0.03), fbm(p * 0.3 + vec2(5.2, 1.3) - uTime * 0.02));
  float h = 0.0;
  float amp = 0.22;
  float freq = 1.3;
  for (int i = 0; i < 9; i++) {
    float angle = 0.35 + (hash(vec2(float(i), 1.7)) - 0.5) * 2.0;
    float phase = hash(vec2(float(i), 9.1)) * 6.283;
    float x = dot(q, vec2(cos(angle), sin(angle))) * freq - uTime * 1.1 * sqrt(freq) + phase;
    // Sharp crests, wide troughs.
    h += amp * pow(0.5 + 0.5 * sin(x), 2.5);
    freq *= 1.33;
    amp *= 0.8;
  }
  return h + 0.18 * fbm(q * 2.5 + vec2(uTime * 0.2, -uTime * 0.15));
}

// Brightness of the lightning: one strike at a random moment 2 to 9 s into each 11 s, flickering
// twice. (The first second of a period is always dark: ShaderMat's still frame relies on it.)
float lightning(float t) {
  float window = floor(t / 11.0);
  float strike = window * 11.0 + 2.0 + hash(vec2(window, 7.0)) * 7.0;
  float d = t - strike;
  if (d < 0.0) return 0.0;
  return exp(-d * 10.0) + 0.7 * step(0.16, d) * exp(-(d - 0.16) * 14.0);
}

void main() {
  vec2 p = boardFrag() / uPixels;
  float e = 0.04;
  float h = sea(p);
  vec3 n = normalize(vec3(h - sea(p + vec2(e, 0.0)), h - sea(p + vec2(0.0, e)), e * 2.2));

  vec3 sun = normalize(vec3(-0.5, 0.6, 0.65));
  float diffuse = max(dot(n, sun), 0.0);
  float glint = pow(max(dot(n, normalize(sun + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
  // Slopes facing away from straight down mirror the sky.
  float sky = clamp(pow(1.0 - n.z, 1.5) * 1.4, 0.0, 0.45);

  // Dark troughs; crests thin enough for light to pass through, greener.
  float crest = smoothstep(0.15, 0.75, h);
  vec3 c = mix(vec3(0.008, 0.04, 0.06), vec3(0.07, 0.27, 0.28), crest);
  c *= 0.55 + 0.75 * diffuse;
  c = mix(c, vec3(0.40, 0.47, 0.50), sky);
  c += glint * 0.12 * vec3(0.8, 0.88, 0.9);

  // Foam, as seen from the air: a lace that stretches with the wind, thick on the crests and in
  // drifting patches, thin elsewhere; plus long streaks the gusts draw across the water.
  vec2 w = mat2(0.94, 0.34, -0.34, 0.94) * p;
  // Twisted hard by noise, so no cell keeps a clean outline.
  vec2 twist = vec2(fbm(p * 1.6 + uTime * 0.06), fbm(p * 1.6 + vec2(3.7, 8.1) - uTime * 0.05));
  vec2 lacePos = vec2(w.x * 0.8, w.y * 1.6) * 2.2 + 1.9 * twist - vec2(uTime * 0.25, 0.0);
  float patches = smoothstep(0.35, 0.75, fbm(p * 0.45 + vec2(uTime * 0.04, 0.0)));
  float density = clamp(patches * 0.8 + smoothstep(0.45, 0.8, h) * 0.9, 0.0, 1.0);
  float breakup = smoothstep(0.3, 0.65, noise(lacePos * 1.7 + 4.0));
  float lace = smoothstep(0.02 + 0.1 * density * breakup, 0.0, cellEdge(lacePos)) * density * (0.35 + 0.65 * breakup);
  lace += 0.5 * smoothstep(0.05 * density, 0.0, cellEdge(lacePos * 2.3 + 7.0)) * density * breakup;
  float caps = smoothstep(0.7, 0.85, h + 0.3 * (fbm(p * 5.0 + uTime * 0.6) - 0.5));
  float streaks = smoothstep(0.62, 0.78, fbm(vec2(w.x * 0.35, w.y * 9.0) + vec2(uTime * 0.3, 0.0))) * (0.3 + 0.7 * patches);
  float foam = clamp(lace * 0.75 + caps * 0.9 + streaks * 0.25, 0.0, 1.0);
  c = mix(c, vec3(0.80, 0.86, 0.87), foam);

  c += lightning(uTime) * vec3(0.55, 0.62, 0.75) * (0.35 + 0.65 * diffuse);

  vec2 uv = boardFrag() / uSize;
  c *= 0.75 + 0.25 * smoothstep(0.9, 0.2, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
