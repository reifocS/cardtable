import { COMMON } from './common';

/**
 * A wizard's desk: rustic planks (Poly Haven's Wood Table Large, CC0) with something in each corner,
 * modelled and rendered in Blender as if seen from a seat at the table, shadows included. Top left:
 * an open grimoire, a candle, an inkwell with its quill. Top right: a stack of leather books, a
 * brass goblet, a pocket watch. Bottom left: a lit candleholder, a sealed letter under a magnifying
 * glass, a compass. Bottom right: a scroll, potions, a crystal on its rock, a few coins. The candles
 * flicker and warm the wood around them; the crystal and the violet potion glow softly.
 * uWood is the lit wood; uPropsA..D the corners, on transparency.
 */
export const ARCANE = `${COMMON}
uniform sampler2D uWood;
uniform sampler2D uPropsA;
uniform sampler2D uPropsB;
uniform sampler2D uPropsC;
uniform sampler2D uPropsD;

// World units per metre of the rendered scene; the wood image spans two metres.
const float M = 9.0;
const float TILE = 2.0 * M;
// Each corner's size in metres (top left, bottom right, top right, bottom left).
const vec2 SIZE_A = vec2(0.8, 0.6);
const vec2 SIZE_B = vec2(0.7, 0.55);
const vec2 SIZE_C = vec2(0.7, 0.55);
const vec2 SIZE_D = vec2(0.75, 0.55);
// How far each corner runs off the board's edges, in metres.
const float BLEED = 0.03;
// Where the flames and glows are in their corner's image (from Blender's cameras).
const vec2 CANDLE_A = vec2(0.825, 0.877);
const vec2 CANDLE_D = vec2(0.173, 0.949);
const vec2 CRYSTAL = vec2(0.286, 0.739);
const vec2 POTION = vec2(0.8, 0.696);

// A corner over the colour so far; images are stored top row first.
vec3 over(vec3 c, sampler2D props, vec2 a) {
  if (a.x < 0.0 || a.x > 1.0 || a.y < 0.0 || a.y > 1.0) return c;
  vec4 s = texture(props, vec2(a.x, 1.0 - a.y));
  // Faded out at the very edges: textures repeat, so filtering there blends in the opposite side.
  vec2 edge = smoothstep(0.0, 0.02, a) * smoothstep(1.0, 0.98, a);
  // And the faintest shadow left near the edges would outline the image's square.
  return mix(c, s.rgb, clamp((s.a - 0.012) / 0.988, 0.0, 1.0) * edge.x * edge.y);
}

float pool(vec2 p, vec2 at, float radius) {
  vec2 d = (p - at) / radius;
  return exp(-dot(d, d));
}

float flicker(float t, float seed) {
  return 0.9 + 0.05 * sin(t * 11.0 + seed) + 0.03 * sin(t * 23.0 + 1.3 * seed) + 0.12 * (noise(vec2(t * 3.0, seed)) - 0.5);
}

void main() {
  vec2 p = boardFrag() / uPixels;
  vec2 uv = boardFrag() / uSize;
  vec2 board = uSize / uPixels;
  float t = uTime;

  // Smaller boards get smaller props, so they still fit.
  float k = clamp(board.y / 9.0, 0.45, 1.0) * M;
  float bleed = BLEED * k;
  vec2 sizeA = SIZE_A * k, sizeB = SIZE_B * k, sizeC = SIZE_C * k, sizeD = SIZE_D * k;
  vec2 originA = vec2(-bleed, board.y - sizeA.y + bleed);
  vec2 originB = vec2(board.x - sizeB.x + bleed, -bleed);
  vec2 originC = board - sizeC + bleed;
  vec2 originD = vec2(-bleed);

  vec3 c = texture(uWood, vec2(p.x, -p.y) / TILE).rgb;
  c = over(c, uPropsA, (p - originA) / sizeA);
  c = over(c, uPropsB, (p - originB) / sizeB);
  c = over(c, uPropsC, (p - originC) / sizeC);
  c = over(c, uPropsD, (p - originD) / sizeD);

  // Candles: unsteady flames lighting warm pools, the rest of the room dimmer.
  vec2 candleA = originA + CANDLE_A * sizeA;
  vec2 candleD = originD + CANDLE_D * sizeD;
  float fa = flicker(t, 0.0), fd = flicker(t, 5.0);
  float warmA = pool(p, candleA, 0.45 * k), warmD = pool(p, candleD, 0.4 * k);
  float warm = max(warmA, warmD);
  c *= (0.72 + 0.4 * (warmA * fa + warmD * fd)) * mix(vec3(1.0), vec3(1.1, 0.95, 0.78), warm);
  c += vec3(1.0, 0.6, 0.25) * (exp(-length(p - candleA) / (0.025 * k)) * fa + exp(-length(p - candleD) / (0.025 * k)) * fd) * 0.5;

  // Magic: the crystal and the violet potion glow, each breathing at its own pace.
  vec3 violet = vec3(0.45, 0.2, 0.9);
  c += violet * pool(p, originB + CRYSTAL * sizeB, 0.12 * k) * (0.22 + 0.12 * sin(t * 1.1));
  c += violet * pool(p, originB + POTION * sizeB, 0.1 * k) * (0.15 + 0.1 * sin(t * 0.8 + 2.0));

  c *= 0.7 + 0.3 * smoothstep(0.95, 0.25, length(uv - 0.5));
  color = vec4(c, 1.0);
}
`;
