import { useEffect, useRef } from 'react';
import type React from 'react';

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

interface Props {
  fragment: string;
  /** Animated; a still shader is drawn once per size, at full resolution, and costs nothing after. */
  moving: boolean;
  /** The board, when this canvas is a fixed window onto one that scrolls and zooms (the zoomed view). */
  track?: React.RefObject<HTMLElement | null>;
  /** How much bigger than on the table the board is shown, so the playmat grows with it. */
  zoom?: number;
  /** Covered (by the zoomed view): no need to draw. */
  paused?: boolean;
}

/**
 * A playmat painted by a fragment shader, under the cards. A moving one animates at 30 fps while on
 * screen and shows a still frame when playmat animations are off (or the system asks for less
 * motion). Without WebGL the CSS look stays.
 */
export function ShaderMat({ fragment, moving, track, zoom = 1, paused = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Read every frame, so zooming or covering doesn't rebuild the WebGL context.
  const live = useRef({ zoom, paused });
  useEffect(() => {
    live.current = { zoom, paused };
  }, [zoom, paused]);

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
    const uOrigin = gl.getUniformLocation(program, 'uOrigin');
    const uPixels = gl.getUniformLocation(program, 'uPixels');
    const uTime = gl.getUniformLocation(program, 'uTime');

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const animated = () => !reduced.matches && !document.documentElement.classList.contains('mats-still');
    let onScreen = true;
    let stale = true;
    let placed = '';
    const draw = (time: number) => {
      gl.uniform1f(uTime, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      stale = false;
    };

    // Where the board is under the canvas, and how big: the canvas itself, unless tracking one.
    const place = () => {
      const px = canvas.width / Math.max(1, canvas.clientWidth);
      let origin = [0, 0];
      let size = [canvas.width, canvas.height];
      const board = track?.current;
      if (board) {
        const b = board.getBoundingClientRect();
        const c = canvas.getBoundingClientRect();
        origin = [(c.left - b.left) * px, (b.bottom - c.bottom) * px];
        size = [b.width * px, b.height * px];
      }
      const pixels = UNIT_PX * px * live.current.zoom;
      const key = `${origin}|${size}|${pixels}`;
      if (key === placed) return;
      placed = key;
      gl.uniform2f(uOrigin, origin[0], origin[1]);
      gl.uniform2f(uSize, size[0], size[1]);
      gl.uniform1f(uPixels, pixels);
      stale = true;
    };

    const resize = () => {
      const scale = Math.min(devicePixelRatio, 2) * (moving ? RENDER_SCALE : 1);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      placed = '';
      place();
      if (!moving && !track) draw(STILL_TIME);
    };
    const sized = new ResizeObserver(resize);
    sized.observe(canvas);
    const seen = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
    seen.observe(canvas);

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!onScreen || live.current.paused) return;
      place();
      if (moving && animated()) {
        if (now - last < FRAME_MS) return;
        last = now;
        draw((now - EPOCH) / 1000);
      } else if (stale) {
        // Still: one moment, early in a period, when no shader is mid-strike or mid-flight.
        draw(STILL_TIME);
      }
    };
    // A still playmat on the table never needs a frame loop; one that scrolls and zooms does.
    if (moving || track) raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      sized.disconnect();
      seen.disconnect();
      // Browsers cap live WebGL contexts: give this one back now rather than at garbage collection.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
      delete host.dataset.live;
    };
  }, [fragment, moving, track]);

  return <div ref={ref} className="shader-mat" aria-hidden />;
}
