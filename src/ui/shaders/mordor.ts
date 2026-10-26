import { COMMON } from './common';

/**
 * Mordor from above: a crust of dark rock (rendered in Blender from Poly Haven's Dark Rock 02, CC0)
 * with lava glowing up through its crevices, hotter in some places than others, lighting the
 * rock around it; ash drifting over, and the sky's red glow from the north.
 * uRock is the lit rock; uHeat how deep in a crevice each point is (blurred by mipmap for the glow).
 */
export const MORDOR = `${COMMON}
uniform sampler2D uRock;
uniform sampler2D uHeat;

// World units the rock texture spans before it repeats (three of the source texture, warped and blended).
const float TILE = 21.0;

// Lava by temperature: dull red, orange, then near white.
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  return vec3(1.0, 0.22, 0.03) * smoothstep(0.0, 0.45, t) * 1.1 + vec3(1.0, 0.65, 0.25) * smoothstep(0.45, 1.0, t);
}

void main() {
  vec2 p = boardFrag() / uPixels;
  vec2 uv = boardFrag() / uSize;
  vec2 st = p / TILE;
  float t = uTime;

  // The rock, shaded and greyed by broad patches so the repeats don't show, under a red sky.
  vec3 rock = texture(uRock, st).rgb;
  rock *= 0.55 + 0.45 * fbm(p * 0.12);
  rock = mix(rock, vec3(dot(rock, vec3(0.36))), smoothstep(0.55, 0.75, fbm(p * 0.2 + 20.0)) * 0.5);
  vec3 c = rock * vec3(0.85, 0.7, 0.66);

  // Crevices, and their glow spread over the rock nearby.
  float crack = texture(uHeat, st).r;
  float glow = textureLod(uHeat, st, 4.0).r * 0.7 + textureLod(uHeat, st, 6.0).r * 0.8;
  // Some ground is hotter than the rest. The lava underneath swells and ebbs every few seconds,
  // each stretch in its own time, so slow waves of brightness pass along the crevices.
  float hot = mix(0.55, 1.0, smoothstep(0.35, 0.65, fbm(p * 0.18 + 50.0)));
  float pulse = 0.5 + 0.5 * sin(t * 1.2 + fbm(p * 0.15 + 70.0) * 12.0);
  pulse = mix(pulse, noise(p * 0.5 - vec2(0.0, t * 0.12)), 0.3);
  float churn = fbm(p * 1.2 + vec2(t * 0.05, t * 0.02));
  float temp = hot * (0.5 + 0.55 * pulse) * (0.85 + 0.25 * churn);

  // Light from below: the rock around a crevice warmed, its lips lit, and down inside it the lava,
  // brightest where it's deepest.
  c += vec3(0.8, 0.17, 0.03) * glow * hot * (0.5 + 0.5 * pulse) * 0.8;
  float depth = smoothstep(0.05, 0.9, crack);
  c *= 1.0 - 0.3 * depth;
  c += heat(temp * (0.55 + 0.45 * depth)) * depth * (1.05 + 0.5 * pulse);
  // Bloom: the glow spilling past the lips, the colour of the lava it comes from.
  float bloom = textureLod(uHeat, st, 2.0).r * 0.6 + textureLod(uHeat, st, 3.5).r * 0.5;
  c += heat(temp * 0.7) * bloom * (0.3 + 0.6 * pulse);

  // Ash blowing over: dark where it's thick, lit from below over the lava.
  vec2 wind = vec2(t * 0.06, -t * 0.025);
  float ash = smoothstep(0.5, 0.78, fbm(p * 0.18 - wind));
  c *= 1.0 - 0.4 * ash;
  c += vec3(0.4, 0.08, 0.02) * ash * glow * hot * 0.4;

  // The red glow of the sky, strongest to the north.
  c += vec3(0.2, 0.035, 0.01) * smoothstep(0.35, 1.15, uv.y) * (0.85 + 0.15 * sin(t * 0.4));
  c *= 0.62 + 0.38 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
