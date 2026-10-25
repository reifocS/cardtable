import { COMMON } from './common';

/**
 * Highlands from the air: rolling hills lit by a low sun, grass in the hollows, heather on the
 * slopes, bare rock on the steep and high ground, small lochs in the lowest dips, and mist lying
 * in the valleys and drifting over the hills.
 */
export const HIGHLANDS = `${COMMON}
float height(vec2 p) {
  return fbm(p * 0.16) + 0.2 * fbm(p * 0.6 + 4.0);
}

void main() {
  vec2 p = gl_FragCoord.xy / uPixels;
  vec2 uv = gl_FragCoord.xy / uSize;
  float e = 0.1;
  float h = height(p);
  vec3 n = normalize(vec3(h - height(p + vec2(e, 0.0)), h - height(p + vec2(0.0, e)), e * 0.4));
  float slope = 1.0 - n.z;

  // A low sun from the north-west: long soft shadows on the far sides of hills.
  vec3 sun = normalize(vec3(-0.65, 0.6, 0.35));
  float lit = clamp(dot(n, sun), 0.0, 1.0);

  // Vegetation by height, slope and patches.
  float patches = fbm(p * 0.9 + 7.0);
  vec3 grass = mix(vec3(0.20, 0.33, 0.14), vec3(0.30, 0.40, 0.17), patches);
  vec3 heather = vec3(0.32, 0.21, 0.28);
  vec3 dry = vec3(0.44, 0.40, 0.22);
  vec3 rock = vec3(0.38, 0.38, 0.36);
  vec3 c = grass;
  c = mix(c, dry, smoothstep(0.55, 0.75, patches) * 0.6);
  c = mix(c, heather, smoothstep(0.5, 0.72, h + 0.25 * (patches - 0.5)) * 0.85);
  c = mix(c, rock, clamp(smoothstep(0.78, 0.95, h) + smoothstep(0.12, 0.25, slope) * 0.8, 0.0, 1.0));
  // Close-cropped texture: tufts and stones.
  c *= 0.82 + 0.3 * noise(p * 18.0);
  c *= 0.25 + 1.1 * lit;

  // Lochs in the lowest dips: dark water holding a little of the grey sky.
  float water = smoothstep(0.3, 0.285, h);
  vec3 loch = mix(vec3(0.05, 0.09, 0.11), vec3(0.32, 0.38, 0.41), 0.25 + 0.2 * noise(p * 3.0 + uTime * 0.2));
  c = mix(c, loch, water);
  c *= 1.0 - 0.35 * smoothstep(0.315, 0.3, h) * (1.0 - water);

  // Mist: thick in the valleys, thin over the tops, drifting with the wind.
  vec2 wind = vec2(uTime * 0.05, uTime * 0.012);
  float valleys = smoothstep(0.55, 0.33, h);
  float banks = fbm(p * 0.22 - wind) ;
  float mist = valleys * smoothstep(0.35, 0.7, banks) * 0.75 + smoothstep(0.55, 0.8, fbm(p * 0.12 - wind * 1.6 + 3.0)) * 0.35;
  c = mix(c, vec3(0.76, 0.80, 0.79), clamp(mist, 0.0, 0.8));

  c *= 0.68 + 0.32 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
