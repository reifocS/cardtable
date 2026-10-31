/**
 * Entrances for the cards that deserve one, each drawn by a fragment shader on a canvas laid over the
 * card and screened onto the table (it only ever adds light), the card's face left clear; one canvas
 * per entrance, given back when done. A legendary card: shafts of light breaking out from behind it, a
 * shockwave of warm light over the table, a glint round its edge, embers rising. A commander: a wheel of
 * fire turning round it, flames licking outward, sparks flung off by the spin.
 */

/** How far the light reaches beyond the card, as a multiple of the card's larger side. */
const REACH = 1.6;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uSize;   // canvas, px
uniform vec2 uHalf;   // card half-size, px (the card is centred)
uniform float uT;     // 0..1 through the entrance
uniform float uSeed;
uniform float uRound; // 1 for a round light (a die), 0 for a card's rounded rectangle
// Three random numbers per particle, drawn once per entrance: the same for every pixel, so not hashed
// in each. Embers from 0, sparks from 32.
uniform vec3 uRand[64];
out vec4 color;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}
// Signed distance to the card's rounded rectangle.
float card(vec2 p) {
  vec2 q = abs(p) - uHalf + 6.0;
  float box = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 6.0;
  return mix(box, length(p) - min(uHalf.x, uHalf.y), uRound);
}
`;

const LIGHT = `${COMMON}
// Warm light: deep amber, gold, then white-hot.
vec3 warm(float x) {
  return mix(mix(vec3(0.55, 0.22, 0.03), vec3(1.0, 0.72, 0.28), smoothstep(0.0, 0.5, x)), vec3(1.0, 0.95, 0.82), smoothstep(0.5, 1.0, x));
}

void main() {
  vec2 p = gl_FragCoord.xy - uSize * 0.5;
  float t = uT;
  float r = length(p);
  float span = max(uHalf.x, uHalf.y);
  // The canvas's corners, beyond the light's reach: nothing to work out.
  if (r > span * ${(REACH + 0.5).toFixed(2)}) { color = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float a = atan(p.y, p.x);
  float d = card(p);
  vec3 c = vec3(0.0);

  // Shafts of light: streaks of noise round the angle, thin and uneven, swelling then fading,
  // turning a touch; strongest just outside the card and dying away with distance.
  float swell = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.35, 1.0, t));
  float streaks = fbm(vec2(a * 6.0 + t * 0.6, uSeed)) * 0.6 + fbm(vec2(a * 17.0 - t * 0.9, uSeed + 3.0)) * 0.5;
  streaks = pow(clamp(streaks, 0.0, 1.0), 3.0);
  float fall = exp(-max(d, 0.0) / (span * (0.35 + 0.5 * t)));
  c += warm(0.35 + 0.5 * streaks) * streaks * fall * swell * 2.2;

  // A shockwave of light over the table: a thin bright crest with a soft wake, its edge broken a
  // little by noise, running out fast and slowing.
  float front = span * (0.15 + 1.5 * (1.0 - pow(1.0 - t, 2.5)));
  float wob = (fbm(vec2(a * 5.0, t * 3.0)) - 0.5) * span * 0.12;
  float w = d - front - wob;
  float crest = exp(-w * w / 90.0) * 0.7 + 0.25 * exp(-max(-w, 0.0) / (span * 0.3)) * step(w, 0.0);
  // Broken up along its length, so it reads as light on the table rather than a drawn outline.
  crest *= 0.45 + 0.75 * fbm(vec2(a * 9.0, t * 4.0 + 2.0));
  c += warm(0.7) * crest * (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.04, t) * 0.9;

  // A glint running round the card's edge: a hot spot sweeping once round the frame, a fainter
  // line of light all along it.
  float edge = exp(-d * d / 6.0);
  float sweep = fract(a / 6.2831853 - t * 1.1 + 0.25);
  float glint = exp(-pow(min(sweep, 1.0 - sweep) * 14.0, 2.0));
  c += warm(0.95) * edge * (0.25 * swell + 1.6 * glint * smoothstep(0.05, 0.2, t) * (1.0 - smoothstep(0.7, 1.0, t)));

  // Embers rising off the card, each flickering, streaked along their rise.
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    float h1 = uRand[i].x, h2 = uRand[i].y, h3 = uRand[i].z;
    float start = h3 * 0.35;
    float life = clamp((t - start) / 0.65, 0.0, 1.0);
    if (life <= 0.0 || life >= 1.0) continue;
    vec2 at = vec2((h1 - 0.5) * 2.0 * uHalf.x * 1.1, (h2 - 0.5) * 2.0 * uHalf.y);
    at.y += span * (0.2 + 0.9 * h2) * life;
    at.x += sin(life * 6.0 + fi) * span * 0.04;
    vec2 q = p - at;
    q.y *= 0.45;
    float flick = 0.6 + 0.4 * sin(t * 60.0 + fi * 3.0);
    c += warm(0.9) * exp(-dot(q, q) / 3.0) * (1.0 - life) * smoothstep(0.0, 0.1, life) * flick * 1.6;
  }

  // Leave the card's face readable: no light inside it but the glint along its edge.
  c *= mix(0.12, 1.0, smoothstep(-10.0, 2.0, d));
  // Fade out at the canvas edge.
  c *= smoothstep(span * ${REACH.toFixed(2)} + span * 0.5, span * ${REACH.toFixed(2)}, r);
  color = vec4(c, 1.0);
}`;

const FIRE = `${COMMON}
// Fire by heat: smouldering red, orange, yellow, then white at the core.
vec3 fire(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.6, 0.06, 0.0), smoothstep(0.0, 0.25, x));
  c = mix(c, vec3(1.0, 0.38, 0.03), smoothstep(0.2, 0.55, x));
  c = mix(c, vec3(1.0, 0.8, 0.25), smoothstep(0.5, 0.8, x));
  return mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.8, 1.0, x));
}

void main() {
  vec2 p = gl_FragCoord.xy - uSize * 0.5;
  float t = uT;
  float span = max(uHalf.x, uHalf.y);
  float r = length(p) / span;
  if (r > 2.4) { color = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float a = atan(p.y, p.x);
  float d = card(p);
  const float TAU = 6.2831853;

  // Three acts. Ignition: lit at one point, the fire races round the ring. Burning: it turns, fast then
  // slowing, widening a little. Burning out: it breaks into flickers, reddens, and leaves embers.
  float ignite = 1.0 - pow(1.0 - clamp(t / 0.22, 0.0, 1.0), 2.0);
  float out_ = smoothstep(0.55, 0.92, t);
  float spin = 6.0 * (1.0 - pow(1.0 - t, 2.0));
  float radius = 1.15 + 0.18 * t;

  // How far round the ring from where it caught, in the direction it runs; lit behind the running head.
  float start = uSeed * 1.7;
  // Both edges of the lit arc wander a little, so neither reads as a straight cut.
  float jitter = (noise(vec2(r * 7.0, t * 4.0 + uSeed)) - 0.5) * 0.03;
  float phi = fract((a - start) / TAU + jitter);
  float lit = smoothstep(ignite + 0.002, ignite - 0.03, phi);
  // Where it caught, the fire also spills back a little and fades, instead of stopping dead.
  lit = max(lit, smoothstep(0.93, 1.0, phi) * smoothstep(0.0, 0.05, ignite));
  // Once round, the ring closes: no gap where the running head met its start.
  lit = mix(lit, 1.0, smoothstep(0.9, 1.0, ignite));
  float head = exp(-pow((phi - ignite) * 22.0, 2.0)) * (1.0 - smoothstep(0.85, 1.0, ignite));

  // Flames: tongues rising off the ring, leaning back along the spin as they rise, each its own height,
  // turbulent inside; the turbulence also breaks the fire up as it dies.
  float u = a - spin;
  float away = (r - radius) / 0.15;
  float lean = max(away, 0.0) * 0.28;
  vec2 ring = vec2(cos(u + lean), sin(u + lean));
  float tongue = (0.7 + 4.2 * pow(fbm(ring * 4.5 + vec2(t * 2.0, 0.0)), 1.7)) * (1.0 - 0.7 * out_) * (0.6 + 0.4 * lit);
  float inner = smoothstep(-1.1, -0.35, away);
  float outer = 1.0 - smoothstep(0.0, tongue, away);
  float churn = fbm(ring * 7.0 + vec2(0.0, away * 1.4 - t * 9.0));
  float patchy = smoothstep(0.15 + 0.5 * out_, 0.75 + 0.2 * out_, churn);
  float heat = inner * outer * patchy * 1.25 * (1.0 - 0.4 * smoothstep(0.0, tongue, away));
  heat *= lit * (1.0 - 0.55 * out_) * smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.88, 1.0, t));
  vec3 c = fire(heat * (1.05 - 0.35 * out_)) * smoothstep(0.06, 0.25, heat) * 1.5;

  // The running head: a white-hot flare where the fire is catching.
  float near = exp(-pow((r - radius) / 0.12, 2.0));
  c += fire(1.0) * head * near * 1.8;

  // Firelight falling on the table: warm inside the ring, a soft halo outside, flickering.
  float flicker = 0.85 + 0.15 * noise(vec2(t * 20.0, 3.0));
  float light = lit * (1.0 - out_) * smoothstep(0.0, 0.06, t) * flicker;
  c += vec3(1.0, 0.42, 0.1) * light * (0.1 * smoothstep(radius + 0.05, radius - 0.5, r) + 0.2 * exp(-abs(r - radius) * 5.0));

  // Embers left on the ring once it has burnt out: specks glowing red, dimming one by one.
  for (int i = 0; i < 28; i++) {
    float fi = float(i);
    vec3 h = uRand[i];
    float ea = (fi + h.x) / 28.0 * TAU + spin;
    float er = (radius + (h.y - 0.5) * 0.12) * span;
    vec2 dp = p - vec2(cos(ea), sin(ea)) * er;
    float die = 0.86 + 0.13 * h.z;
    float glow = smoothstep(0.55, 0.7, t) * (1.0 - smoothstep(die - 0.12, die, t));
    glow *= 0.6 + 0.4 * sin(t * 40.0 + fi * 2.1);
    c += fire(0.55) * exp(-dot(dp, dp) / 9.0) * glow * 1.8 + vec3(0.5, 0.08, 0.0) * exp(-dot(dp, dp) / 60.0) * glow * 0.5;
  }

  // Sparks: a burst from the running head, then more flung off along the spin while it burns.
  for (int i = 0; i < 30; i++) {
    float fi = float(i);
    float h1 = uRand[32 + i].x, h2 = uRand[32 + i].y, h3 = uRand[32 + i].z;
    float born = i < 12 ? h2 * 0.2 : 0.2 + h2 * 0.4;
    float k = clamp((t - born) / (0.3 + 0.2 * h3), 0.0, 1.0);
    if (k <= 0.0 || k >= 1.0) continue;
    float from = i < 12 ? start + (born / 0.22) * TAU : h1 * TAU + spin;
    float ang = from + k * (0.5 + 0.6 * h3);
    float rr = (radius + k * (0.35 + 0.55 * h1)) * span;
    vec2 at = vec2(cos(ang), sin(ang)) * rr;
    vec2 tang = vec2(-sin(ang), cos(ang));
    vec2 dp = p - at;
    float along = dot(dp, tang), across = dot(dp, vec2(tang.y, -tang.x));
    float streak = exp(-(along * along / 28.0 + across * across / 1.6));
    c += fire(1.0 - k * 0.6) * streak * (1.0 - k) * 1.3;
  }

  // Leave the card's face readable.
  c *= mix(0.15, 1.0, smoothstep(-10.0, 2.0, d));
  c *= smoothstep(2.4, 1.9, r);
  color = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error(gl.getShaderInfoLog(shader));
  return null;
}

/** A canvas with its context and program, ready to play one kind of entrance. */
type Player = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  at: Record<'uSize' | 'uHalf' | 'uSeed' | 'uRound' | 'uT' | 'uRand', WebGLUniformLocation | null>;
};

/**
 * Players not in use, by fragment. Making a context and compiling its shader is slow (on Windows above
 * all, where it goes through Direct3D) and would stall the first frames of every entrance, so players
 * are kept between entrances, and one of each kind is made ahead, while the page is idle.
 */
const idle = new Map<string, Player[]>();
/** Kept per kind beyond that, the rest given back: browsers cap live WebGL contexts. */
const KEEP = 2;

function make(fragment: string): Player | null {
  const canvas = document.createElement('canvas');
  canvas.className = 'herald';
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  const at = (name: string) => gl.getUniformLocation(program, name);
  return { canvas, gl, at: { uSize: at('uSize'), uHalf: at('uHalf'), uSeed: at('uSeed'), uRound: at('uRound'), uT: at('uT'), uRand: at('uRand') } };
}

function take(fragment: string): Player | null {
  const kept = idle.get(fragment) ?? [];
  for (let player = kept.pop(); player; player = kept.pop()) if (!player.gl.isContextLost()) return player;
  return make(fragment);
}

function give(fragment: string, player: Player) {
  const kept = idle.get(fragment) ?? [];
  if (kept.length >= KEEP || player.gl.isContextLost()) {
    player.gl.getExtension('WEBGL_lose_context')?.loseContext();
    return;
  }
  kept.push(player);
  idle.set(fragment, kept);
}

/** Plays `fragment` over `card` (a screen rect) for `ms`. Says whether it could: it needs WebGL. */
function play(fragment: string, card: DOMRect, ms: number, round = false): boolean {
  const player = take(fragment);
  if (!player) return false;
  const { canvas, gl, at } = player;
  const span = Math.max(card.width, card.height);
  const half = span * (REACH + 0.5);
  const cx = card.left + card.width / 2;
  const cy = card.top + card.height / 2;
  canvas.style.cssText = `left:${cx - half}px;top:${cy - half}px;width:${2 * half}px;height:${2 * half}px`;
  const px = Math.min(devicePixelRatio, 2);
  canvas.width = canvas.height = Math.round(2 * half * px);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(at.uSize, canvas.width, canvas.height);
  gl.uniform2f(at.uHalf, (card.width / 2) * px, (card.height / 2) * px);
  gl.uniform1f(at.uSeed, Math.random() * 10);
  gl.uniform1f(at.uRound, round ? 1 : 0);
  gl.uniform3fv(at.uRand, Float32Array.from({ length: 64 * 3 }, Math.random));
  // The first frame drawn before it's shown, so a kept canvas never flashes its last entrance.
  gl.uniform1f(at.uT, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  document.body.appendChild(canvas);

  const start = performance.now();
  const frame = (now: number) => {
    const t = (now - start) / ms;
    if (t >= 1) {
      canvas.remove();
      give(fragment, player);
      return;
    }
    gl.uniform1f(at.uT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return true;
}

// One player of each kind made ahead, its shader compiled (and drawn once, as some drivers only finish
// compiling then) while nothing is happening.
const whenIdle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 2000));
whenIdle(() => {
  for (const fragment of [LIGHT, FIRE]) {
    const player = make(fragment);
    if (!player) return;
    player.gl.drawArrays(player.gl.TRIANGLES, 0, 3);
    give(fragment, player);
  }
});

/** A legendary card's entrance over `card`, or round for a die. Says whether it could (it needs WebGL). */
export const herald = (card: DOMRect, round = false) => play(LIGHT, card, 1700, round);

/** A commander's entrance: a wheel of fire round `card`. Says whether it could (it needs WebGL). */
export const fireWheel = (card: DOMRect) => play(FIRE, card, 2200);
