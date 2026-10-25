/**
 * What every playmat shader starts with: the uniforms ShaderMat sets, and value noise.
 * uSize: canvas size in pixels. uPixels: canvas pixels per world unit. uTime: seconds, shared by
 * every board.
 */
export const COMMON = `#version 300 es
precision highp float;

uniform vec2 uSize;
uniform float uPixels;
uniform float uTime;
out vec4 color;

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
