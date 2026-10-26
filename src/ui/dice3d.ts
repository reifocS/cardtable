/**
 * Dice and coins in 3D with CSS alone: each solid is the convex hull of its corners, every face a
 * clipped element placed in space with matrix3d, the whole thrown onto the table with a little physics
 * (it bounces, losing height, its spin dying away) and coming to rest on the right face, the right way
 * up. Faces are lit from above by their slant every frame, and a shadow on the table grows and fades
 * with the height. Screen axes, as in CSS: x right, y down, z toward the viewer.
 */

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec): Vec => scale(a, 1 / (Math.hypot(...a) || 1));
const apply = (m: Mat, v: Vec): Vec => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const mul = (a: Mat, b: Mat): Mat =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j])) as Mat;

/** Rotation by `angle` about the unit `axis` (Rodrigues). */
function rotation(axis: Vec, angle: number): Mat {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const signs = (n: number) => Array.from({ length: 1 << n }, (_, k) => Array.from({ length: n }, (_, i) => ((k >> i) & 1 ? -1 : 1)));

/** Corners of each solid, roughly unit-sized. */
function corners(sides: number): Vec[] {
  switch (sides) {
    case 4:
      return [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ];
    case 6:
      return signs(3).map(([a, b, c]) => [a * 0.8, b * 0.8, c * 0.8]);
    case 8:
      return [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
    case 10: {
      // A pentagonal trapezohedron: two apexes and two staggered rings, the apex height chosen so
      // every kite-shaped face is flat.
      const z0 = 0.11;
      const c = Math.cos(Math.PI / 5);
      const h = z0 * (1 + (2 * c) / (1 - c));
      const ring = (k: number, z: number, off: number): Vec => [Math.cos(off + (k * 2 * Math.PI) / 5), Math.sin(off + (k * 2 * Math.PI) / 5), z];
      return [[0, 0, h], [0, 0, -h], ...[0, 1, 2, 3, 4].map((k) => ring(k, z0, 0)), ...[0, 1, 2, 3, 4].map((k) => ring(k, -z0, Math.PI / 5))];
    }
    case 12:
      return [
        ...signs(3).map(([a, b, c]) => [a * 0.62, b * 0.62, c * 0.62] as Vec),
        ...signs(2).flatMap(([a, b]) => [
          [0, (a * 0.62) / PHI, b * 0.62 * PHI] as Vec,
          [(a * 0.62) / PHI, b * 0.62 * PHI, 0] as Vec,
          [a * 0.62 * PHI, 0, (b * 0.62) / PHI] as Vec,
        ]),
      ];
    default:
      // A d20 (and the shape for any other die).
      return signs(2).flatMap(([a, b]) => [
        [0, a * 0.55, b * 0.55 * PHI] as Vec,
        [a * 0.55, b * 0.55 * PHI, 0] as Vec,
        [a * 0.55 * PHI, 0, b * 0.55] as Vec,
      ]);
  }
}

/** A coin: two round faces and an edge, as a 24-sided prism. */
function coinCorners(): Vec[] {
  return Array.from({ length: 48 }, (_, k) => {
    const a = ((k % 24) * 2 * Math.PI) / 24;
    return [Math.cos(a), Math.sin(a), k < 24 ? 0.08 : -0.08] as Vec;
  });
}

export type Face = {
  /** Corners in the face's own plane, from its centre: x along `u`, y along `w`. */
  outline: [number, number][];
  radius: number;
  centre: Vec;
  u: Vec;
  w: Vec;
  n: Vec;
};

/** The faces of the convex hull of `pts`: every plane through three corners with all others behind it. */
function hull(pts: Vec[]): Face[] {
  const faces: Face[] = [];
  const eps = 1e-6;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      for (let k = j + 1; k < pts.length; k++) {
        let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
        if (Math.hypot(...n) < eps) continue;
        n = norm(n);
        const d = dot(n, pts[i]);
        const side = pts.map((p) => dot(n, p) - d);
        if (side.some((v) => v > eps)) {
          if (side.some((v) => v < -eps)) continue;
          n = scale(n, -1);
        }
        if (faces.some((f) => dot(f.n, n) > 1 - 1e-6)) continue;
        const on = pts.filter((p) => Math.abs(dot(n, p) - dot(n, pts[i])) < 1e-5);
        const centre = scale(on.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]] as Vec, [0, 0, 0] as Vec), 1 / on.length);
        // Corners in order round the face; then axes turned so `u` points at the middle of an edge, which
        // squares a die's faces up and stands its number upright on an edge.
        let u = norm(sub(on[0], centre));
        let w = cross(n, u);
        const ring = on.sort((a, b) => Math.atan2(dot(sub(a, centre), w), dot(sub(a, centre), u)) - Math.atan2(dot(sub(b, centre), w), dot(sub(b, centre), u)));
        const mid = sub(scale([ring[0][0] + ring[1][0], ring[0][1] + ring[1][1], ring[0][2] + ring[1][2]], 0.5), centre);
        u = norm(cross(norm(mid), n));
        w = cross(n, u);
        const outline = ring.map((p) => [dot(sub(p, centre), u), dot(sub(p, centre), w)] as [number, number]);
        faces.push({ outline, radius: Math.max(...outline.map(([x, y]) => Math.hypot(x, y))), centre, u, w, n });
      }
  return faces;
}

/** How many faces a die's solid has (for a coin, its two caps and the strips of its edge). */
export const faceCount = (sides: number) => hull(sides === 2 ? coinCorners() : corners(sides)).length;

/** Where a die is thrown from, how high, and its spin: the toss, played out by `throwDie`. */
type Toss = { from: [number, number]; spinAxis: Vec; spinTurns: number; up: number };

/** Height over time: a toss up, then bounces losing most of their height, until it settles. */
function bounces(up: number) {
  const g = 2600;
  const dt = 1 / 120;
  const hs: number[] = [];
  let h = 70;
  let v = up;
  let rest = 0;
  for (let i = 0; i < 600 && rest < 6; i++) {
    v -= g * dt;
    h += v * dt;
    if (h <= 0) {
      h = 0;
      v = -v * 0.5;
      if (v < 90) {
        v = 0;
        rest++;
      }
    }
    hs.push(h);
  }
  return { heights: hs, seconds: hs.length * dt };
}

const LIGHT = norm([-0.45, -0.6, 0.85]);
/** At rest the die leans back a little, as seen from a seat at the table: its top and two sides show. */
const LEAN: Mat = mul(rotation([1, 0, 0], 0.42), rotation([0, 1, 0], -0.32));

export type Thrown = { element: HTMLElement; seconds: number; stop: () => void };

/**
 * Builds a die (or a coin, for two sides) showing `value` once it rests, and throws it onto the table
 * from the thrower's seat: from below the screen for me, from above for someone across the table. The
 * element returned holds the shadow and the solid; `seconds` is how long until it rests.
 */
export function throwDie(sides: number, value: number, size: number, still: boolean, fromAbove = false): Thrown {
  const coin = sides === 2;
  const faces = hull(coin ? coinCorners() : corners(sides));
  // The face it lands on: the coin's front for heads, its back for tails; a die's face numbered `value`.
  const caps = faces.filter((f) => Math.abs(f.n[2]) > 0.99);
  // A d6's faces are numbered as on a real die, opposite faces adding up to 7; others in order.
  const labels = faces.map((f, k) => (sides === 6 ? D6[f.n.findIndex((v) => Math.abs(v) > 0.5) * 2 + (f.n.find((v) => Math.abs(v) > 0.5)! > 0 ? 0 : 1)] : k + 1));
  const landing = coin
    ? caps.find((f) => (value === 1 ? f.n[2] > 0 : f.n[2] < 0))!
    : (faces[labels.indexOf(value)] ?? faces[(value - 1) % faces.length]);
  const px = size / 2;

  const stage = document.createElement('div');
  stage.className = 'die-stage';
  const shadow = document.createElement('div');
  shadow.className = 'die-shadow';
  const solid = document.createElement('div');
  solid.className = `die-solid${coin ? ' coin' : ''}`;
  stage.append(shadow, solid);

  const els = faces.map((f) => {
    const el = document.createElement('div');
    const r = f.radius * px;
    const cap = coin && caps.includes(f);
    el.className = `die-face${cap ? ' cap' : coin ? ' rim' : ''}`;
    el.style.width = el.style.height = `${2 * r}px`;
    el.style.left = el.style.top = `${-r}px`;
    el.style.clipPath = `polygon(${f.outline.map(([x, y]) => `${50 + (x / f.radius) * 50}% ${50 + (y / f.radius) * 50}%`).join(', ')})`;
    const c = scale(f.centre, px);
    el.style.transform = `matrix3d(${[...f.u, 0, ...f.w, 0, ...f.n, 0, ...c, 1].join(',')})`;
    if (coin && cap) {
      el.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="${f.n[2] > 0 ? HEADS : TAILS}"/></svg>`;
    } else if (sides === 6) {
      // Pips drilled into the bone, as on old dice.
      for (const [x, y] of PIPS[labels[faces.indexOf(f)]]) {
        const pip = document.createElement('i');
        pip.style.left = `${x}%`;
        pip.style.top = `${y}%`;
        el.append(pip);
      }
    } else if (!coin) {
      // The landing face shows the result even when the die has fewer faces than that (a d100).
      const label = f === landing ? value : labels[faces.indexOf(f)];
      const span = document.createElement('span');
      span.textContent = String(label);
      if (label === 6 || label === 9) span.classList.add('underline');
      span.style.fontSize = `${r * (sides >= 12 ? 0.66 : 0.76)}px`;
      el.append(span);
    }
    solid.append(el);
    return el;
  });

  // At rest: the landing face toward the viewer, its number upright.
  const rest: Mat = [landing.u, landing.w, landing.n];
  const side = fromAbove ? -1 : 1;
  const from: [number, number] = coin ? [0, side * 170] : [(Math.random() - 0.5) * 220, side * 330];
  // It rolls forward along its way: on a table facing the viewer, spinning about (way × out of the table).
  // (The spin unwinds toward rest, hence the way × z rather than z × way.)
  const way = norm([-from[0], -from[1], 0]);
  const wobble = coin ? 0.05 : 0.25;
  const toss: Toss = {
    from,
    spinAxis: norm([...cross(way, [0, 0, 1]).slice(0, 2), 0].map((v) => v + (Math.random() - 0.5) * wobble) as Vec),
    spinTurns: coin ? 6 : 2 + Math.random() * 1.2,
    up: coin ? 1050 : 950,
  };
  const { heights, seconds } = still ? { heights: [0], seconds: 0 } : bounces(toss.up);

  const frame = (t: number) => {
    const i = Math.min(heights.length - 1, Math.floor(t * 120));
    const p = Math.min(1, t / Math.max(seconds, 1e-3));
    const ease = 1 - (1 - p) ** 3;
    const h = heights[i];
    const x = toss.from[0] * (1 - ease);
    const y = toss.from[1] * (1 - ease);
    const spin = rotation(toss.spinAxis, toss.spinTurns * 2 * Math.PI * (1 - ease));
    const m = mul(LEAN, mul(spin, rest));
    solid.style.transform = `translate3d(${x}px, ${y}px, ${h}px) matrix3d(${[m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, 0, 0, 0, 1].join(',')})`;
    shadow.style.transform = `translate(${x + h * 0.25}px, ${y + h * 0.35}px) scale(${1 + h / 300})`;
    shadow.style.opacity = String(Math.max(0.15, 0.55 - h / 600));
    faces.forEach((f, k) => {
      const lit = dot(apply(m, f.n), LIGHT);
      els[k].style.filter = `brightness(${(0.42 + 0.68 * Math.max(0, lit)).toFixed(3)})`;
    });
  };

  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = (now - start) / 1000;
    frame(t);
    if (t < seconds) raf = requestAnimationFrame(tick);
  };
  frame(still ? seconds : 0);
  if (!still) raf = requestAnimationFrame(tick);
  return { element: stage, seconds, stop: () => cancelAnimationFrame(raf) };
}

/** A d6's face numbers by outward axis: +x, -x, +y, -y, +z, -z. Opposite faces add up to 7. */
const D6 = [1, 6, 2, 5, 3, 4];

/** Where the pips sit on each face of a d6, in percent of the face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

/** A crown for heads, a shield for tails. */
const HEADS = 'M8 34 L4 12 L16 22 L24 6 L32 22 L44 12 L40 34 Z M8 38 H40 V43 H8 Z';
const TAILS = 'M24 4 L42 10 V24 C42 34 34 41 24 45 C14 41 6 34 6 24 V10 Z';
