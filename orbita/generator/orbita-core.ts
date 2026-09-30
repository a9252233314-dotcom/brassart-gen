/**
 * Brass Art — ядро генератора ОРБИТА (v0.1). Без Node — работает и в цеху (orbita.ts), и в браузере (web.ts).
 * Конструкция со слов мастера (docs/product-rules.md, ОРБИТА): лента одна и непрерывная, витки со сдвигом (как орбита),
 * литая оболочка 2 мм, волнистая; в пересечениях, у штанги, у лодочки — потайной M6; клетка держится на лодочке под узлом;
 * центр — узел CELL (кольцо Ø60, гнутые рожки Ø10 M10 со свечами).
 * Порядок как в ЗАКОНЕ 3: штанга → узел → лодочка → лента; потом проверки.
 */
import { rng } from '../../generator/geom.ts';

type V2 = [number, number];
type V3 = [number, number, number];
const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));

function massProps(mesh: any) {
  const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
  let V = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t] * np, b = tv[t + 1] * np, c = tv[t + 2] * np;
    const ax = vp[a], ay = vp[a + 1], az = vp[a + 2], bx = vp[b], by = vp[b + 1], bz = vp[b + 2];
    const qx = vp[c], qy = vp[c + 1], qz = vp[c + 2];
    const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
    V += v; cx += v * (ax + bx + qx) / 4; cy += v * (ay + by + qy) / 4; cz += v * (az + bz + qz) / 4;
  }
  return { vol: V, c: [cx / V, cy / V, cz / V] as V3 };
}
function vertsOf(mesh: any): V3[] {
  const np = mesh.numProp, vp = mesh.vertProperties, out: V3[] = [];
  for (let i = 0; i < vp.length; i += np) out.push([vp[i], vp[i + 1], vp[i + 2]]);
  return out;
}

// сечение ленты: прямая средняя линия шириной w, стенка T, кромки полукруглые.
// Точки: внутренняя сторона (к центру, −y) · кромка + · наружная (+y) · кромка −   → против часовой в (x, y)
function stripSection(w: number, T: number, M: number, m: number) {
  const a = w / 2, hT = T / 2, pts: V2[] = [], tag: number[] = [];   // 0 внутренняя, 1 наружная, 2 кромка
  for (let k = 0; k <= M; k++) { pts.push([-a + 2 * a * k / M, -hT]); tag.push(0); }
  for (let j = 1; j < m; j++) { const f = -Math.PI / 2 + Math.PI * j / m; pts.push([a + hT * Math.cos(f), hT * Math.sin(f)]); tag.push(2); }
  for (let k = M; k >= 0; k--) { pts.push([-a + 2 * a * k / M, hT]); tag.push(1); }
  for (let j = 1; j < m; j++) { const f = Math.PI / 2 + Math.PI * j / m; pts.push([-a + hT * Math.cos(f), hT * Math.sin(f)]); tag.push(2); }
  return { pts, tag, M, m };
}

export function build(P: any, wasm: any, opt: { checks?: boolean } = {}) {
  const { Manifold, Mesh } = wasm;
  const B = P.band, NO = P.node, LO = P.lodochka, LP = P.lamp, VR = P.vary;
  const warn: string[] = [];
  const kg = (vol: number) => vol * P.brass_density_g_cm3 / 1e6;
  const fromMesh = (verts: number[], tri: number[]) =>
    new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tri) }));
  const R0 = rng(P.seed), rnd = () => 2 * R0() - 1;

  // ═════ 1. Путь орбиты на шаре: наклон витков плавно меняется, узел орбиты смещается по кругу ═════
  // точка(τ) = Rz(Ω(τ))·Rx(i(τ))·(cos τ, sin τ, 0); τ ∈ [0, 2πN) — замкнуто.
  // i(τ) = mean + amp·cos((τ − τs)/N), amp = 90° − mean → полярный виток проходит ровно через низ (τs = 3π/2) — в лодочку.
  const Nt = B.turns, tauS = 1.5 * Math.PI, TT = 2 * Math.PI * Nt, NS = 6000;
  const hW = (B.wall + B.weave_gap) / 2;
  const R = P.diameter / 2 - B.wall / 2 - B.wave_amp - hW - 2;      // радиус средней линии ленты (габарит ≈ Ø)
  const iMean0 = (B.incl_mean_deg + rnd() * VR.incl_mean_deg) * D2R;
  const Om00 = rnd() * Math.PI, prec0 = R0() < 0.5 ? 1 : -1, wavePh = R0() * 2 * Math.PI;   // направление смещения — тоже подбирается
  // перекрытие двух лент под углом θ — ромб, его концы на (w/2)(1/sin θ + 1/tan θ) от центра пересечения;
  // «над/под» и гладкая площадка накрывают весь ромб с запасом
  const padOf = (ang: number) => clamp((B.width / 2) * (1 / Math.max(Math.sin(ang), 0.2) + 1 / Math.max(Math.tan(ang), 0.2)) + B.wall + 4, B.flat_half_mm, 160);
  const RAMP = 40, touchD = B.width + B.wall + 3;
  type Cross = { ta: number; tb: number; ang: number; pt: V3 };

  // орбита: точка(τ) = Rz(Ω(τ))·Rx(i(τ))·(cos τ, sin τ, 0); τ ∈ [0, 2πN) — замкнуто.
  // i(τ) = mean + amp·cos((τ − τs)/N), amp = 90° − mean → полярный виток проходит ровно через низ (τs = 3π/2) — в лодочку.
  function orbit(iMean: number, Om0: number, prec: number) {
    const iAmp = Math.PI / 2 - iMean;
    const unit = (tau: number): V3 => {
      const i = iMean + iAmp * Math.cos((tau - tauS) / Nt), Om = Om0 + prec * tau / Nt;
      const x = Math.cos(tau), y = Math.sin(tau) * Math.cos(i), z = Math.sin(tau) * Math.sin(i);
      return [x * Math.cos(Om) - y * Math.sin(Om), x * Math.sin(Om) + y * Math.cos(Om), z];
    };
    const sAt: number[] = [0];
    let prev = unit(0);
    for (let k = 1; k <= NS; k++) { const q = unit(TT * k / NS); sAt.push(sAt[k - 1] + R * len(sub(q, prev))); prev = q; }
    const Ltot = sAt[NS];
    const sOf = (tau: number) => { const f = ((tau % TT) + TT) % TT / TT * NS, k = Math.floor(f); return sAt[k] + (sAt[Math.min(NS, k + 1)] - sAt[k]) * (f - k); };
    const tauOf = (s: number) => {
      const ss = ((s % Ltot) + Ltot) % Ltot;
      let lo = 0, hi = NS;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sAt[mid] <= ss) lo = mid; else hi = mid; }
      return TT * (lo + (ss - sAt[lo]) / ((sAt[hi] - sAt[lo]) || 1)) / NS;
    };
    const ds = (a: number, b: number) => { let d = ((b - a) % Ltot + Ltot) % Ltot; if (d > Ltot / 2) d -= Ltot; return d; };
    // пересечения ленты с собой (на шаре)
    const MC = 2400, cp: V3[] = [];
    for (let k = 0; k < MC; k++) cp.push(unit(TT * k / MC));
    const crosses: Cross[] = [];
    for (let i = 0; i < MC; i++) {
      const a0 = cp[i], a1 = cp[(i + 1) % MC], nA = cross(a0, a1);
      for (let j = i + 3; j < MC; j++) {
        if (i === 0 && j >= MC - 2) continue;
        const b0 = cp[j], b1 = cp[(j + 1) % MC];
        if (dot(a0, b0) < 0.9) continue;
        const s0 = dot(nA, b0), s1 = dot(nA, b1);
        if (s0 * s1 > 0) continue;
        const nB = cross(b0, b1), r0 = dot(nB, a0), r1 = dot(nB, a1);
        if (r0 * r1 > 0) continue;
        const fa = r0 / (r0 - r1), fb = s0 / (s0 - s1);
        const da = norm(sub(a1, a0)), db = norm(sub(b1, b0));
        crosses.push({ ta: TT * (i + fa) / MC, tb: TT * (j + fb) / MC, ang: Math.acos(clamp(Math.abs(dot(da, db)), 0, 1)), pt: norm(add(mul(a0, 1 - fa), mul(a1, fa))) });
      }
    }
    // касания без пересечения: витки ближе ширины ленты (почти параллельно) — лента легла бы на ленту краем
    const STEP = 3, NP = Math.ceil(Ltot / STEP), cell = 50;
    const cl = Array.from({ length: NP }, (_, k) => mul(unit(tauOf(k * STEP)), R));
    const grid = new Map<string, number[]>();
    cl.forEach((q, k) => {
      const key = Math.floor(q[0] / cell) + ',' + Math.floor(q[1] / cell) + ',' + Math.floor(q[2] / cell);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(k);
    });
    const cs = crosses.map((c) => ({ x: sOf(c.ta), y: sOf(c.tb), pad: padOf(c.ang) + RAMP }));
    const nearCross = (sa: number, sb: number) => cs.some((c) =>
      (Math.abs(ds(c.x, sa)) < c.pad && Math.abs(ds(c.y, sb)) < c.pad) || (Math.abs(ds(c.y, sa)) < c.pad && Math.abs(ds(c.x, sb)) < c.pad));
    const touchZones: { s: number; s2: number; d: number }[] = [];
    cl.forEach((q, k) => {
      const gx = Math.floor(q[0] / cell), gy = Math.floor(q[1] / cell), gz = Math.floor(q[2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get((gx + dx) + ',' + (gy + dy) + ',' + (gz + dz)) ?? []) {
          if (j <= k || Math.abs(ds(k * STEP, j * STEP)) < 3 * B.width) continue;
          const d = len(sub(q, cl[j]));
          if (d >= touchD || nearCross(k * STEP, j * STEP)) continue;
          const z = touchZones.find((z) => Math.abs(ds(z.s, k * STEP)) < 60 && Math.abs(ds(z.s2, j * STEP)) < 60);
          if (z) { if (d < z.d) Object.assign(z, { s: k * STEP, s2: j * STEP, d }); } else touchZones.push({ s: k * STEP, s2: j * STEP, d });
        }
      }
    });
    const minAng = crosses.length ? Math.min(...crosses.map((c) => c.ang)) : Math.PI / 2;
    // тесные пересечения вдоль ленты: площадки соседних пересечений наезжают — «над/под» не успевает смениться
    const vs = crosses.flatMap((c) => [{ s: sOf(c.ta), pad: padOf(c.ang) }, { s: sOf(c.tb), pad: padOf(c.ang) }]).sort((a, b) => a.s - b.s);
    let tight = 0;
    vs.forEach((v, k) => { const o = vs[(k + 1) % vs.length]; if (vs.length > 1 && Math.abs(ds(v.s, o.s)) - v.pad - o.pad < 16) tight++; });
    return { iMean, iAmp, Om0, prec, unit, Ltot, sOf, tauOf, ds, crosses, touchZones, minAng, tight };
  }
  // подбор: витки цепляют друг друга краями или пересекаются слишком остро — чуть меняем наклон и сдвиг орбиты
  // (перебор детерминированный — одно зерно всегда даёт одну люстру)
  const score = (o: ReturnType<typeof orbit>) => o.touchZones.length * 10 + o.tight * 3 + (o.minAng < 30 * D2R ? 5 : 0);
  let O = orbit(iMean0, Om00, prec0);
  const tries: [number, number, number][] = [];
  for (const pr of [prec0, -prec0]) for (const di of [0, 2, -2, 4, -4, 6, -6, 8, -8]) for (const dO of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) if (di || dO || pr !== prec0) tries.push([pr, di, dO]);
  for (const [pr, di, dO] of tries) {
    if (score(O) === 0) break;
    const O2 = orbit(clamp(iMean0 + di * D2R, 35 * D2R, 75 * D2R), Om00 + dO, pr);
    if (score(O2) < score(O)) O = O2;
  }
  const { iMean, iAmp, unit, Ltot, sOf, tauOf, ds, crosses, touchZones } = O;
  if (touchZones.length) warn.push('лента касается сама себя без пересечения: ' + touchZones.length + ' мест(а), ближе всего ' + Math.min(...touchZones.map((z) => z.d)).toFixed(0) + ' мм между осями (надо ≥ ' + touchD.toFixed(0) + ')');

  // плетение «над / под» по очереди; у каждого пересечения — своя длина перехода, чтобы не залезать на соседнее
  type Visit = { s: number; sign: number; pad: number; ramp: number; kind: string; ci: number };
  const visits: Visit[] = [];
  crosses.forEach((c, ci) => {
    const pad = padOf(c.ang);
    visits.push({ s: sOf(c.ta), sign: 0, pad, ramp: RAMP, kind: 'пересечение', ci }, { s: sOf(c.tb), sign: 0, pad, ramp: RAMP, kind: 'пересечение', ci });
  });
  visits.sort((a, b) => a.s - b.s);
  visits.forEach((v, k) => { v.sign = k % 2 === 0 ? 1 : -1; });
  crosses.forEach((_, ci) => {
    const vv = visits.filter((v) => v.ci === ci);
    if (vv.length === 2 && vv[0].sign === vv[1].sign) warn.push('плетение: пересечение без «над/под» — проверить');
  });
  visits.forEach((v, k) => {
    const nb = [visits[(k + visits.length - 1) % visits.length], visits[(k + 1) % visits.length]];
    const room = Math.min(...nb.map((o) => Math.abs(ds(o.s, v.s)) - o.pad - v.pad));
    v.ramp = clamp(room / 2, 8, RAMP);
    if (room < 16) warn.push('пересечения слишком близко вдоль ленты (' + room.toFixed(0) + ' мм) — переход «над/под» крутой');
  });
  // крепления, где лента тоже гладкая: низ (лодочка) и ближайший к штанге проход сверху
  const sBottom = sOf(tauS);
  const topCand = [tauS - Math.PI, tauS + Math.PI].map((t) => ({ t, q: unit(t) })).sort((a, b) => Math.hypot(a.q[0], a.q[1]) - Math.hypot(b.q[0], b.q[1]));
  const tTop = topCand[0].t, sTop = sOf(tTop);
  const flats: Visit[] = [
    { s: sBottom, sign: 0, pad: LO.cradle_len / 2 + B.flat_half_mm, ramp: 0, kind: 'лодочка', ci: -1 },
    { s: sTop, sign: 0, pad: B.flat_half_mm + 10, ramp: 0, kind: 'штанга', ci: -1 },
  ];
  // тройные сближения: три витка в одной точке «над/под» не разнести
  for (let a = 0; a < crosses.length; a++) for (let b = a + 1; b < crosses.length; b++) {
    const d = R * len(sub(crosses[a].pt, crosses[b].pt));
    if (d < B.width * 0.9) warn.push(`два пересечения ближе ${d.toFixed(0)} мм — почти тройное, проверить`);
  }
  const winR = (d: number, pad: number, ramp: number) => 1 - smooth((Math.abs(d) - pad) / Math.max(ramp, 1));   // 1 на площадке, плавно к 0
  const eps = (s: number) => {                                        // смещение по радиусу: «над» / «под»
    let e = 0;
    for (const v of visits) { const d = ds(v.s, s); if (Math.abs(d) < v.pad + v.ramp) e += v.sign * hW * winR(d, v.pad, v.ramp); }
    return clamp(e, -hW, hW);
  };
  const flatK = (s: number) => {                                      // 0 — гладко (площадка), 1 — волна
    let f = 0;
    for (const v of [...visits, ...flats]) { const d = ds(v.s, s); if (Math.abs(d) < v.pad + 30) f = Math.max(f, winR(d, v.pad + 5, 25)); }   // волна возвращается сразу за ромбом
    return 1 - f;
  };
  const wave = (s: number) => B.wave_amp * Math.sin(2 * Math.PI * s / B.wave_len + wavePh) * flatK(s);

  // рамка ленты в точке s: центр, касательная, ширина (n), наружу (u)
  const frameAt = (s: number) => {
    const t = tauOf(s), q = unit(t), e = eps(s);
    const qa = unit(tauOf(s - 1)), qb = unit(tauOf(s + 1));
    const Tn = norm(sub(mul(qb, R + eps(s + 1)), mul(qa, R + eps(s - 1))));
    const u = norm(sub(q, mul(Tn, dot(q, Tn))));
    const n = norm(cross(u, Tn));
    return { c: mul(q, R + e), T: Tn, n, u, w: wave(s) };
  };

  // ═════ 3. Лента как тело: протяжка сечения по пути (замкнуто — вся лента; открыто — кусок под печать) ═════
  const sec = stripSection(B.width, B.wall, B.width_pts, B.edge_pts);
  const K = sec.pts.length;
  function sweep(sa: number, sb: number, closed: boolean) {
    const n = Math.max(2, Math.ceil((sb - sa) / B.step_mm)) + (closed ? 0 : 1);
    const verts: number[] = [], loops: number[][] = [];
    for (let j = 0; j < n; j++) {
      const s = sa + (sb - sa) * j / (closed ? n : n - 1), F = frameAt(s);
      const idx: number[] = [];
      for (const [x, y] of sec.pts) {
        const p = add(add(F.c, mul(F.n, x)), mul(F.u, y + F.w - x * x / (2 * R)));   // поперёк — по шару (пояс глобуса)
        idx.push(verts.length / 3); verts.push(p[0], p[1], p[2]);
      }
      loops.push(idx);
    }
    const tri: number[] = [], tag: number[] = [], triS: number[] = [];
    const nl = closed ? n : n - 1;
    for (let j = 0; j < nl; j++) for (let k = 0; k < K; k++) {
      const a = loops[j][k], b = loops[j][(k + 1) % K], c = loops[(j + 1) % n][(k + 1) % K], d = loops[(j + 1) % n][k];
      const tg = sec.tag[k] === sec.tag[(k + 1) % K] ? sec.tag[k] : 2;
      tri.push(a, b, c, a, c, d); tag.push(tg, tg); triS.push(sa + (sb - sa) * (j + 0.5) / (closed ? n : n - 1), 0);
    }
    if (!closed) {                                                    // торцы: полоса внутр.↔наруж. + веера по кромкам
      const M = sec.M, m = sec.m;
      const cap = (lp: number[], flip: boolean) => {
        const put = (x: number, y: number, z: number) => { flip ? tri.push(x, z, y) : tri.push(x, y, z); tag.push(3); triS.push(0); };
        const inn = (k: number) => lp[k], out = (k: number) => lp[M + m + (M - k)];
        for (let k = 0; k < M; k++) { put(inn(k), inn(k + 1), out(k + 1)); put(inn(k), out(k + 1), out(k)); }
        const rimP = [lp[M], ...Array.from({ length: m - 1 }, (_, j) => lp[M + 1 + j]), lp[M + m]];
        for (let j = 1; j + 1 < rimP.length; j++) put(rimP[0], rimP[j], rimP[j + 1]);
        const rimM = [lp[2 * M + m], ...Array.from({ length: m - 1 }, (_, j) => lp[2 * M + m + 1 + j]), lp[0]];
        for (let j = 1; j + 1 < rimM.length; j++) put(rimM[0], rimM[j], rimM[j + 1]);
      };
      cap(loops[0], true); cap(loops[n - 1], false);
    }
    let man = fromMesh(verts, tri);
    if (man.volume() < 0) { for (let t = 0; t < tri.length; t += 3) { const x = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = x; } man.delete(); man = fromMesh(verts, tri); }
    return { man, verts, tri, tag, triS };
  }
  const band = sweep(0, Ltot, true);

  // ═════ 4. Узел CELL, рожки со свечами, лодочка, штанга ═════
  const zH = NO.z_rel * R;                                             // центр кольца узла
  const ringR = NO.ring_d / 2, ar = NO.arm_d / 2;
  // протяжка круга/прямоугольника по ломаной (рожки, лодочка) — простая рамка переноса, выпуклые торцы
  function tube(path: V3[], shape: V2[], n0: V3 = [0, 0, 1]) {
    const verts: number[] = [], tri: number[] = [], S = shape.length, n = path.length;
    let N0: V3 = n0;
    for (let i = 0; i < n; i++) {
      const T = norm(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]));
      let Nn = sub(N0, mul(T, dot(N0, T)));
      if (len(Nn) < 1e-6) Nn = Math.abs(T[0]) < 0.9 ? cross(T, [1, 0, 0]) : cross(T, [0, 1, 0]);
      Nn = norm(Nn); N0 = Nn;
      const Bn = cross(T, Nn);
      for (const [x, y] of shape) { const p = add(path[i], add(mul(Nn, x), mul(Bn, y))); verts.push(p[0], p[1], p[2]); }
    }
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k < S; k++) {
      const a = i * S + k, b = i * S + (k + 1) % S, c = (i + 1) * S + (k + 1) % S, d = (i + 1) * S + k;
      tri.push(a, b, c, a, c, d);
    }
    for (let k = 1; k + 1 < S; k++) { tri.push(0, k + 1, k); tri.push((n - 1) * S, (n - 1) * S + k, (n - 1) * S + k + 1); }
    let man = fromMesh(verts, tri);
    if (man.volume() < 0) { for (let t = 0; t < tri.length; t += 3) { const x = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = x; } man.delete(); man = fromMesh(verts, tri); }
    return man;
  }
  const circle = (r: number, k = 20): V2[] => Array.from({ length: k }, (_, i) => [r * Math.cos(2 * Math.PI * i / k), r * Math.sin(2 * Math.PI * i / k)] as V2);
  // рожки: вылет и высота свечи — от зерна, разброс без первой гармоники (ЦТ на оси)
  const nA = NO.arms, phA = R0() * 2 * Math.PI / nA;
  const reachDev = Array.from({ length: nA }, () => rnd()), zDev = Array.from({ length: nA }, () => R0());
  {
    let c = 0, s = 0;
    reachDev.forEach((v, i) => { c += v * Math.cos(phA + 2 * Math.PI * i / nA); s += v * Math.sin(phA + 2 * Math.PI * i / nA); });
    for (let i = 0; i < nA; i++) { const ph = phA + 2 * Math.PI * i / nA; reachDev[i] -= (2 / nA) * (c * Math.cos(ph) + s * Math.sin(ph)); }
  }
  const [rMin, rMax] = NO.reach_mm, [zr0, zr1] = NO.lamp_z_rel;
  const arms: any[] = [], lampsA: { base: V3; top: V3; socket: any; bulb: any }[] = [], armPaths: V3[][] = [];
  for (let i = 0; i < nA; i++) {
    const ph = phA + 2 * Math.PI * i / nA, c = Math.cos(ph), s = Math.sin(ph);
    const reach = clamp((rMin + rMax) / 2 + (rMax - rMin) / 2 * reachDev[i] * (1 + VR.reach), rMin, rMax);
    const zLamp = R * (zr0 + (zr1 - zr0) * clamp(zDev[i] * (1 + VR.lamp_z), 0, 1));
    const br = NO.bend_r, r1 = Math.max(ringR + 8, reach - br);
    const pts2: V2[] = [[ringR - 6, zH]];                             // (ρ, z): в кольцо (резьба M10), вбок, гиб R, вверх
    for (let k = 0; k <= 8; k++) pts2.push([ringR - 6 + (r1 - ringR + 6) * k / 8, zH]);
    for (let k = 1; k <= 12; k++) { const a = -Math.PI / 2 + (Math.PI / 2) * k / 12; pts2.push([r1 + br * Math.cos(a), zH + br + br * Math.sin(a)]); }
    const zTop = Math.max(zH + br + 15, zLamp);
    for (let k = 1; k <= 6; k++) pts2.push([r1 + br, zH + br + (zTop - zH - br) * k / 6]);
    const path = pts2.map(([rho, z]) => [rho * c, rho * s, z] as V3);
    armPaths.push(path);
    arms.push(tube(path, circle(ar, 16)));
    const base: V3 = [(r1 + br) * c, (r1 + br) * s, zTop];
    const socket = Manifold.cylinder(LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 32).translate(base);
    const rb = LP.bulb_d / 2;
    const bulb = Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 32), Manifold.sphere(rb, 32).translate([0, 0, LP.bulb_h - rb]))
      .translate([base[0], base[1], base[2] + LP.socket_h]);
    lampsA.push({ base, top: [base[0], base[1], base[2] + LP.socket_h + LP.bulb_h], socket, bulb });
  }
  const ring = Manifold.cylinder(NO.ring_h, ringR, ringR, 48, true).subtract(Manifold.cylinder(NO.ring_h + 2, ringR - 10, ringR - 10, 48, true)).translate([0, 0, zH]);
  // лодочка: петля вниз от кольца, лента проходит сквозь неё поперёк и лежит на дне (потайной M6 вертикально)
  const Fb = frameAt(sBottom);
  const nb = norm([Fb.n[0], Fb.n[1], 0]);                              // поперёк ленты, горизонтально
  const zCr = Fb.c[2] - B.wall / 2 - LO.strip_t / 2;                    // средняя линия дна лодочки
  const half = LO.cradle_len / 2, rf = 8, zTopL = zH - NO.ring_h / 2 - 2;
  const lod2: V2[] = [[-half, zTopL]];
  for (let k = 1; k <= 6; k++) lod2.push([-half, zTopL + (zCr + rf - zTopL) * k / 6]);
  for (let k = 1; k <= 6; k++) { const a = Math.PI + (Math.PI / 2) * k / 6; lod2.push([-half + rf + rf * Math.cos(a), zCr + rf + rf * Math.sin(a)]); }
  for (let k = 1; k <= 6; k++) lod2.push([-half + rf + (2 * half - 2 * rf) * k / 6, zCr]);
  for (let k = 1; k <= 6; k++) { const a = -Math.PI / 2 + (Math.PI / 2) * k / 6; lod2.push([half - rf + rf * Math.cos(a), zCr + rf + rf * Math.sin(a)]); }
  for (let k = 1; k <= 6; k++) lod2.push([half, zCr + rf + (zTopL - zCr - rf) * k / 6]);
  const bx = Fb.c[0], by = Fb.c[1];
  const lodPath = lod2.map(([x, z]) => [bx + nb[0] * x, by + nb[1] * x, z] as V3);
  // сечение полосы: толщина — в плоскости петли, ширина — вдоль ленты (поперёк петли)
  const lodochka = tube(lodPath, [[-LO.strip_t / 2, -LO.strip_w / 2], [LO.strip_t / 2, -LO.strip_w / 2], [LO.strip_t / 2, LO.strip_w / 2], [-LO.strip_t / 2, LO.strip_w / 2]], nb);
  // штанга и чаша
  const zLow = zCr - LO.strip_t / 2;
  const zCeil = zLow + P.height_total, rodTop = zCeil - P.rod.cup_h + 10;
  const rod = Manifold.cylinder(rodTop - zH, P.rod.d / 2, P.rod.d / 2, 32).translate([0, 0, zH])
    .subtract(Manifold.cylinder(rodTop - zH + 2, P.rod.d / 2 - 2, P.rod.d / 2 - 2, 32).translate([0, 0, zH - 1]));
  const cup = Manifold.cylinder(P.rod.cup_h, P.rod.cup_d / 2 * 0.8, P.rod.cup_d / 2, 64).translate([0, 0, zCeil - P.rod.cup_h]);

  // ═════ 5. Проверки ═════
  const bv = vertsOf(band.man.getMesh());
  const segDist = (p: V3, a: V3, b: V3) => { const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1); return len(sub(p, add(a, mul(ab, t)))); };
  const minToBand = (a: V3, b: V3) => { let m = Infinity; for (const p of bv) m = Math.min(m, segDist(p, a, b)); return m; };
  const lampGap = Math.min(...lampsA.map((l) => minToBand([l.base[0], l.base[1], l.base[2] + LP.socket_h], l.top) - LP.bulb_d / 2));
  if (lampGap < LP.min_gap) warn.push(`лампа ближе ${LP.min_gap} мм к ленте: ${lampGap.toFixed(0)} мм`);
  let armGap = Infinity;
  for (const path of armPaths) for (let k = 0; k + 1 < path.length; k += 1) armGap = Math.min(armGap, minToBand(path[k], path[k + 1]) - ar);
  if (armGap < 3) warn.push(`рожок задевает ленту: зазор ${armGap.toFixed(1)} мм`);
  const rodGap = minToBand([0, 0, zH + NO.ring_h / 2], [0, 0, rodTop]) - P.rod.d / 2;
  if (rodGap < 2) warn.push(`лента задевает штангу: зазор ${rodGap.toFixed(1)} мм`);
  const topQ = unit(tTop), Ft = frameAt(sTop);
  const toAxis = norm([-Ft.c[0], -Ft.c[1], 0]);
  const rodPass = { axis_mm: +(R * Math.hypot(topQ[0], topQ[1])).toFixed(0), z_mm: +(R * topQ[2]).toFixed(0), gap_mm: +rodGap.toFixed(1),
    face_up: +Ft.u[2].toFixed(2), width_to_axis: +dot(Ft.n, toAxis).toFixed(2), face_to_axis: +dot(Ft.u, toAxis).toFixed(2) };
  // хомут на штанге с лапкой под ленту: наверху лента лежит плашмя, штанга у её кромки — лапка заходит под ленту,
  // потайной M6 сверху через ленту в лапку (мастер; «по возможности может и сварку сделаю»). Размеры хомута — УСЛОВНО
  const CL = P.clamp;
  const colR = P.rod.d / 2 + CL.wall;
  // рамка у ленты: u — лицо ленты (наружу), a — поперёк ленты к штанге, t — вдоль ленты
  const aAx = norm(sub(toAxis, mul(Ft.u, dot(toAxis, Ft.u)))), tAx = cross(Ft.u, aAx);
  const dRod = Math.hypot(Ft.c[0], Ft.c[1]) / Math.max(dot(aAx, toAxis), 0.3);   // от середины ленты до оси штанги вдоль a
  const sag = (x: number) => (x * x) / (2 * R);                         // лента по шару уходит ниже касательной плоскости
  function clampSide(side: number) {                                    // +1 — над лентой (снизу не видно), −1 — под лентой
    const x0 = -CL.tab_beyond, x1 = dRod;
    const lift = side > 0 ? 0 : -Math.max(sag(x0), sag(x1));            // под лентой — опускаем на прогиб по шару
    const z0 = side > 0 ? B.wall / 2 + CL.gap : -(B.wall / 2 + CL.gap + CL.tab_t) + lift;
    const box = Manifold.cube([x1 - x0, CL.tab_w, CL.tab_t]).translate([x0, -CL.tab_w / 2, z0]);
    const M = [aAx[0], aAx[1], aAx[2], 0, tAx[0], tAx[1], tAx[2], 0, Ft.u[0], Ft.u[1], Ft.u[2], 0, Ft.c[0], Ft.c[1], Ft.c[2], 1];
    const tab = box.transform(M as any);
    const zc = Ft.c[2] + (z0 + CL.tab_t / 2) * Ft.u[2] + dRod * aAx[2];   // высота лапки у штанги
    const collar = Manifold.cylinder(CL.collar_h, colR, colR, 40, true).translate([0, 0, zc]);
    const m = Manifold.union(collar, tab).subtract(Manifold.cylinder(CL.collar_h * 3, P.rod.d / 2 + 0.2, P.rod.d / 2 + 0.2, 32, true).translate([0, 0, zc]));
    return { m, collar, tab, zc };
  }
  const sides = [clampSide(1), clampSide(-1)];
  const hitOf = (m: any) => { let v = 0; for (const j of bandPiecesForClamp()) { const x = j.intersect(m); v += x.volume(); x.delete(); } return v; };
  let bandPiecesCache: any[] | null = null;
  function bandPiecesForClamp() { return bandPiecesCache ?? []; }
  const clampChoice = { sides, pick: 0 };
  const bottomOff = Math.hypot(Fb.c[0], Fb.c[1]);

  // куски ленты под печать: режем не на площадках (пересечения, крепления), не длиннее piece_max
  const pads = [...visits, ...flats];
  const forbidden = (s: number) => pads.some((v) => Math.abs(ds(v.s, s)) < v.pad + 6);   // режем вне площадок (на переходе можно)
  let s0 = 0, bestGap = -1;
  for (let k = 0; k < 720; k++) { const s = Ltot * k / 720; const g = Math.min(...pads.map((v) => Math.abs(ds(v.s, s)) - v.pad)); if (g > bestGap) { bestGap = g; s0 = s; } }
  const cuts = [s0];                                                  // s без заворота: от s0 до s0 + L
  while (s0 + Ltot - cuts[cuts.length - 1] > B.piece_max_mm) {
    const last = cuts[cuts.length - 1];
    let s = last + B.piece_max_mm;
    while (forbidden(s) && s > last + 40) s -= 2;
    if (s <= last + 40) { warn.push('кусок ленты не удалось отрезать вне площадок'); s = last + B.piece_max_mm; }
    cuts.push(s);
  }
  const pieces = cuts.map((sa, k) => ({ sa, sb: k + 1 < cuts.length ? cuts[k + 1] : s0 + Ltot }));

  // съём каждого куска: разъём по кромкам, тянется по радиусу (наружу / к центру)
  let draftMin = 90;
  const pieceInfo: any[] = [];
  const printJobs: any[] = [];
  pieces.forEach((pc, k) => {
    const sw = sweep(pc.sa, pc.sb, false);
    const Fm = frameAt((pc.sa + pc.sb) / 2), d = Fm.u;
    let dm = 90;
    if (opt.checks !== false) for (let t = 0; t < sw.tag.length; t++) {
      if (sw.tag[t] > 1) continue;
      const ia = sw.tri[3 * t] * 3, ib = sw.tri[3 * t + 1] * 3, ic = sw.tri[3 * t + 2] * 3, v = sw.verts;
      const nn = cross([v[ib] - v[ia], v[ib + 1] - v[ia + 1], v[ib + 2] - v[ia + 2]], [v[ic] - v[ia], v[ic + 1] - v[ia + 1], v[ic + 2] - v[ia + 2]]);
      const ln = len(nn); if (ln < 1e-9) continue;
      const nd = dot(nn, d) / ln;                                      // наружная сторона (1) — к d, внутренняя (0) — от d
      dm = Math.min(dm, Math.asin(clamp(sw.tag[t] === 1 ? nd : -nd, -1, 1)) / D2R);
    }
    draftMin = Math.min(draftMin, dm);
    const name = `B${String(k + 1).padStart(2, '0')}`;
    const t0 = norm(cross(d, Fm.T)), e = norm(cross(t0, d));
    printJobs.push({ name, what: 'лента', m: sw.man, base: [e, cross(d, e), d] });
    pieceInfo.push({ name, len_mm: +(pc.sb - pc.sa).toFixed(0), draft: +dm.toFixed(1), kg: +kg(sw.man.volume()).toFixed(3) });
  });
  if (opt.checks !== false && draftMin < B.draft_min_deg) warn.push(`уклон под съём ${draftMin.toFixed(1)}° < ${B.draft_min_deg}°`);
  // ленты не проходят друг сквозь друга: куски попарно (соседние по ленте касаются торцами — их не считаем)
  let clashMax = 0, clashN = 0;
  if (opt.checks !== false) {
    const bands = printJobs.filter((j) => j.what === 'лента').map((j) => ({ m: j.m, bb: j.m.boundingBox() }));
    const nb = bands.length;
    for (let i = 0; i < nb; i++) for (let j = i + 2; j < nb; j++) {
      if (i === 0 && j === nb - 1) continue;
      const A = bands[i].bb, Bb = bands[j].bb;
      if (A.max[0] < Bb.min[0] || Bb.max[0] < A.min[0] || A.max[1] < Bb.min[1] || Bb.max[1] < A.min[1] || A.max[2] < Bb.min[2] || Bb.max[2] < A.min[2]) continue;
      const x = bands[i].m.intersect(bands[j].m), v = x.volume(); x.delete();
      if (v > 0.5) { clashN++; clashMax = Math.max(clashMax, v); }
    }
    if (clashN) warn.push(`ленты проходят друг сквозь друга: ${clashN} мест(а), до ${clashMax.toFixed(0)} мм³`);
  }
  bandPiecesCache = printJobs.filter((j) => j.what === 'лента').map((j) => j.m);
  const hits = clampChoice.sides.map((c) => hitOf(c.m));
  const pick = hits[0] <= 0.5 ? 0 : hits[1] <= 0.5 ? 1 : (hits[0] <= hits[1] ? 0 : 1);   // над лентой — если свободно
  const clampSel = clampChoice.sides[pick], clampClash = hits[pick];
  const clampWho = [pick === 0 ? 'лапка над лентой' : 'лапка под лентой', `задевает: над ${hits[0].toFixed(0)}, под ${hits[1].toFixed(0)} мм³`];
  if (clampClash > 0.5) warn.push(`хомут у штанги задевает ленту: ${clampClash.toFixed(0)} мм³`);
  printJobs.push({ name: 'LOD', what: 'лодочка', m: lodochka, base: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });

  // масса и центр тяжести
  const mp = (m: any) => massProps(m.getMesh());
  const bandMP = mp(band.man), ringMP = mp(ring), lodMP = mp(lodochka), rodMP = mp(rod), clampMP = mp(clampSel.m);
  const tubeK = 1 - ((NO.arm_d - 3) / NO.arm_d) ** 2;                 // рожок — труба Ø10, стенка 1.5 (условно)
  const armMP = arms.map(mp);
  const parts: { kg: number; c: V3 }[] = [
    { kg: kg(bandMP.vol), c: bandMP.c }, { kg: kg(ringMP.vol), c: ringMP.c }, { kg: kg(lodMP.vol), c: lodMP.c }, { kg: kg(rodMP.vol), c: rodMP.c },
    { kg: kg(clampMP.vol), c: clampMP.c },
    ...armMP.map((q) => ({ kg: kg(q.vol) * tubeK, c: q.c })), ...lampsA.map((l) => ({ kg: LP.socket_bulb_kg, c: l.base })),
  ];
  const total = parts.reduce((s, q) => s + q.kg, 0);
  const com = [0, 1, 2].map((k) => parts.reduce((s, q) => s + q.kg * q.c[k], 0) / total);
  const bandCom = Math.hypot(bandMP.c[0], bandMP.c[1]);
  let ext = 0; for (const p of bv) ext = Math.max(ext, Math.hypot(p[0], p[1]));

  const passport = {
    tag: `orbita-${P.diameter}-${Nt}v-seed${P.seed}`, seed: P.seed,
    size: { diameter_mm: +(2 * ext).toFixed(0), sphere_R_mm: +R.toFixed(0), body_h_mm: +(R + B.width / 2 - zLow).toFixed(0), low_z: +zLow.toFixed(0),
      rod_visible_mm: +(zCeil - P.rod.cup_h - R).toFixed(0), hub_z: +zH.toFixed(0) },
    band: { turns: Nt, length_mm: +Ltot.toFixed(0), incl_deg: [+((iMean - iAmp) / D2R).toFixed(0), 90], crossings: crosses.length,
      min_cross_angle_deg: crosses.length ? +(Math.min(...crosses.map((c) => c.ang)) / D2R).toFixed(0) : null, pieces: pieces.length, pieces_info: pieceInfo },
    joints_m6: { crossings: crosses.length, lodochka: 1, rod: 1, total: crosses.length + 2 },
    mass_kg: { band: +kg(bandMP.vol).toFixed(2), node_ring: +kg(ringMP.vol).toFixed(2), arms: +armMP.reduce((s, q) => s + kg(q.vol) * tubeK, 0).toFixed(2),
      lodochka: +kg(lodMP.vol).toFixed(2), rod: +kg(rodMP.vol).toFixed(2), clamp: +kg(clampMP.vol).toFixed(2), sockets_lamps: +(nA * LP.socket_bulb_kg).toFixed(2), total_without_cup: +total.toFixed(2),
      mount: total > P.heavy_mount_kg ? 'усиленное (> 15 кг)' : 'обычное' },
    com_offset_mm: +Math.hypot(com[0], com[1]).toFixed(1), band_com_offset_mm: +bandCom.toFixed(1),
    gaps_mm: { lamp_to_band: +lampGap.toFixed(0), arm_to_band: +armGap.toFixed(0), rod: rodPass, lodochka_offset_from_axis: +bottomOff.toFixed(1) },
    draft_min_deg: +draftMin.toFixed(1),
    band_clash: { places: clashN, max_mm3: +clashMax.toFixed(1) },
    clamp: { z_mm: +clampSel.zc.toFixed(0), tab_len_mm: +(dRod + CL.tab_beyond).toFixed(0), clash_mm3: +clampClash.toFixed(1), side: clampWho[0], note: clampWho[1] },
    touch_zones: touchZones.map((z) => ({ s: +z.s.toFixed(0), s2: +z.s2.toFixed(0), d_mm: +z.d.toFixed(0), p: mul(unit(tauOf(z.s)), R).map((v) => +v.toFixed(0)) })),
    crossings_at: crosses.map((c) => ({ p: mul(c.pt, R).map((v) => +v.toFixed(0)), ang: +(c.ang / D2R).toFixed(0) })),
  };
  return { passport, warn, band: band.man, ring, arms, lamps: lampsA, lodochka, rod, cup, clamp: clampSel.m, printJobs, kg, vertsOf, tag: passport.tag };
}
