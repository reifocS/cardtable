/**
 * A legendary card's entrance, drawn by a fragment shader on a canvas laid over the card and screened
 * onto the table (it only ever adds light): shafts of light breaking out from behind the card, a
 * shockwave of warm light running out over the table, a glint travelling round the card's edge, and
 * embers rising off it. The card's face is left clear. One canvas per entrance, given back when done.
 */

const DURATION_MS = 1700;
/** How far the light reaches beyond the card, as a multiple of the card's larger side. */
const REACH = 1.6;

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;   // canvas, px
uniform vec2 uHalf;   // card half-size, px (the card is centred)
uniform float uT;     // 0..1 through the entrance
uniform float uSeed;
uniform float uRound; // 1 for a round light (a die), 0 for a card's rounded rectangle
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
// Warm light: deep amber, gold, then white-hot.
vec3 warm(float x) {
  return mix(mix(vec3(0.55, 0.22, 0.03), vec3(1.0, 0.72, 0.28), smoothstep(0.0, 0.5, x)), vec3(1.0, 0.95, 0.82), smoothstep(0.5, 1.0, x));
}

void main() {
  vec2 p = gl_FragCoord.xy - uSize * 0.5;
  float t = uT;
  float r = length(p);
  float a = atan(p.y, p.x);
  float span = max(uHalf.x, uHalf.y);
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
    float h1 = hash(vec2(fi, 1.7)), h2 = hash(vec2(fi, 9.3)), h3 = hash(vec2(fi, 4.1));
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

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error(gl.getShaderInfoLog(shader));
  return null;
}

/** Plays the entrance over `card` (a screen rect), or round for a die. Says whether it could: it needs WebGL. */
export function herald(card: DOMRect, round = false): boolean {
  const span = Math.max(card.width, card.height);
  const half = span * (REACH + 0.5);
  const canvas = document.createElement('canvas');
  canvas.className = 'herald';
  const cx = card.left + card.width / 2;
  const cy = card.top + card.height / 2;
  canvas.style.cssText = `left:${cx - half}px;top:${cy - half}px;width:${2 * half}px;height:${2 * half}px`;
  const px = Math.min(devicePixelRatio, 2);
  canvas.width = canvas.height = Math.round(2 * half * px);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false });
  if (!gl) return false;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return false;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, 'uSize'), canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(program, 'uHalf'), (card.width / 2) * px, (card.height / 2) * px);
  gl.uniform1f(gl.getUniformLocation(program, 'uSeed'), Math.random() * 10);
  gl.uniform1f(gl.getUniformLocation(program, 'uRound'), round ? 1 : 0);
  const uT = gl.getUniformLocation(program, 'uT');
  document.body.appendChild(canvas);

  const start = performance.now();
  const frame = (now: number) => {
    const t = (now - start) / DURATION_MS;
    if (t >= 1) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      return;
    }
    gl.uniform1f(uT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return true;
}
