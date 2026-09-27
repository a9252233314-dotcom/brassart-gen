/**
 * Brass Art — геометрия генератора: векторы, «зерно», выпуклые многоугольники.
 * Без зависимостей от Node — этот же код пойдёт в браузер (превью на сайте).
 */
type V3 = [number, number, number];
type V2 = [number, number];

// ─── векторы ─────────────────────────────────────────────────────────
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => mul(a, 1 / len(a));
export const angle = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// точка на дуге большого круга между единичными векторами a и b
export function slerp(a: V3, b: V3, t: number): V3 {
  const ang = angle(a, b);
  if (ang < 1e-9) return a;
  const s = Math.sin(ang);
  return add(mul(a, Math.sin((1 - t) * ang) / s), mul(b, Math.sin(t * ang) / s));
}

export function rng(seed: number) {     // mulberry32 — детерминированно от «зерна»
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function tangentBasis(n: V3): [V3, V3] {
  const a: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(a, n));
  return [e1, cross(n, e1)];
}

// ─── 2D: выпуклый многоугольник ──────────────────────────────────────
export const area2 = (p: V2[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

export function clip(poly: V2[], n: V2, c: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = n[0] * a[0] + n[1] * a[1] - c, db = n[0] * b[0] + n[1] * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function inset(poly: V2[], delta: number): V2[] {
  let q: V2[] = [[-1e6, -1e6], [1e6, -1e6], [1e6, 1e6], [-1e6, 1e6]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const n: V2 = [dy / l, -dx / l];
    q = clip(q, n, n[0] * a[0] + n[1] * a[1] - delta);
    if (q.length < 3) return [];
  }
  return q;
}

export function roundOut(poly: V2[], r: number, seg = 6): V2[] {
  const out: V2[] = [];
  const m = poly.length;
  const nrm = (a: V2, b: V2): V2 => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  for (let i = 0; i < m; i++) {
    const prev = poly[(i - 1 + m) % m], cur = poly[i], next = poly[(i + 1) % m];
    const n1 = nrm(prev, cur), n2 = nrm(cur, next);
    let a1 = Math.atan2(n1[1], n1[0]), a2 = Math.atan2(n2[1], n2[0]);
    while (a2 < a1) a2 += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(((a2 - a1) / (Math.PI / 2)) * seg));
    for (let k = 0; k <= steps; k++) {
      const a = a1 + ((a2 - a1) * k) / steps;
      out.push([cur[0] + r * Math.cos(a), cur[1] + r * Math.sin(a)]);
    }
  }
  return out;
}

// вписанный радиус выпуклого многоугольника: наибольший отступ, при котором он ещё не исчез
export function inradius(poly: V2[]) {
  let lo = 0, hi = 500;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2, q = inset(poly, mid);
    if (q.length >= 3 && area2(q) > 1e-6) lo = mid; else hi = mid;
  }
  return lo;
}

// выпуклая оболочка точек на плоскости (монотонная цепь)
export function hull2(pts: V2[]): V2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], up: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// как положить фигуру на стол bx × by: поворот, при котором запас наибольший.
// pad — поле вокруг фигуры, k — масштаб (усадка). ratio ≤ 1 — влезает.
export function fitRect(h: V2[], bx: number, by: number, pad: number, k: number, stepDeg = 1) {
  let best = { ratio: Infinity, deg: 0, w: 0, h: 0 };
  for (let deg = 0; deg < 180; deg += stepDeg) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of h) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
    }
    const w = (x1 - x0 + 2 * pad) * k, hh = (y1 - y0 + 2 * pad) * k;
    const ratio = Math.max(w / bx, hh / by);
    if (ratio < best.ratio) best = { ratio, deg, w, h: hh };
  }
  return best;
}
