/**
 * What every playmat shader starts with: the uniforms ShaderMat sets, and value noise.
 * Shaders work in the board's frame, through boardFrag(): on the table the canvas is the board; in
 * the zoomed view it's a window onto a board that scrolls and zooms under it.
 * uSize: the board's size in canvas pixels. uOrigin: where the canvas sits on the board. uPixels:
 * canvas pixels per world unit. uTime: seconds, shared by every board.
 */
export const COMMON = `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform float uPixels;
uniform float uTime;
uniform vec2 uOrigin;
out vec4 color;

vec2 boardFrag() {
  return gl_FragCoord.xy + uOrigin;
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

const mat2 TURN = mat2(1.6, 1.2, -1.2, 1.6);

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = TURN * p;
    amp *= 0.5;
  }
  return sum;
}
`;
