import { useEffect, useRef } from 'react';

/** Covers the canvas with one triangle; no buffers needed. */
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Rendered below screen resolution and upscaled: soft noise doesn't need every pixel. */
const RENDER_SCALE = 0.5;
/** CSS pixels per world unit: waves keep their size on every board. */
const UNIT_PX = 70;
const FRAME_MS = 1000 / 30;
/** Time shown when animations are off. */
const STILL_TIME = 34;
/** One clock for every board, so the same weather plays across the table. */
const EPOCH = performance.now();

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error(gl.getShaderInfoLog(shader));
  return null;
}

/** Builds the program and makes it current. */
function link(gl: WebGL2RenderingContext, fragment: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  return program;
}

/**
 * A playmat painted by a fragment shader, under the cards. It animates at 30 fps while on screen,
 * shows a still frame when playmat animations are off (or the system asks for less motion), and
 * leaves the CSS look in place when WebGL isn't available.
 */
export function ShaderMat({ fragment }: { fragment: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A fresh canvas each time: a context given back in cleanup can't be had again from the same one.
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    const program = gl && link(gl, fragment);
    if (!gl || !program) return;
    const host = ref.current!;
    host.append(canvas);
    // Tells the CSS the shader is on, so a theme's own animated layers stand aside.
    host.dataset.live = '';
    gl.bindVertexArray(gl.createVertexArray());
    const uSize = gl.getUniformLocation(program, 'uSize');
    const uPixels = gl.getUniformLocation(program, 'uPixels');
    const uTime = gl.getUniformLocation(program, 'uTime');

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const animated = () => !reduced.matches && !document.documentElement.classList.contains('mats-still');
    let onScreen = true;
    let stale = true;
    const draw = (time: number) => {
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      stale = false;
    };

    const resize = () => {
      const scale = Math.min(devicePixelRatio, 2) * RENDER_SCALE;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uSize, canvas.width, canvas.height);
      gl.uniform1f(uPixels, UNIT_PX * scale);
      stale = true;
    };
    const sized = new ResizeObserver(resize);
    sized.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
    seen.observe(canvas);

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!onScreen) return;
      if (animated()) {
        if (now - last < FRAME_MS) return;
        last = now;
        draw((now - EPOCH) / 1000);
      } else if (stale) {
        // Still: one moment, early in a period, when the storm shader can't be mid-strike.
        draw(STILL_TIME);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      sized.disconnect();
      seen.disconnect();
      // Browsers cap live WebGL contexts: give this one back now rather than at garbage collection.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      delete host.dataset.live;
    };
  }, [fragment]);

  return <div ref={ref} className="shader-mat" aria-hidden />;
}
