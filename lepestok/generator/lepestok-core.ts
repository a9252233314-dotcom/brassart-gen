/**
 * Brass Art — ядро генератора ЛЕПЕСТОК (v0.3, вариант Б: рожок = ножка + лист). Без Node — работает и в цеху
 * (lepestok.ts пишет файлы), и в браузере (web.ts → страница). Конструкция — docs/product-rules.md, ЛЕПЕСТОК.
 * Порядок как в ЗАКОНЕ 3: штанга → узел → корни рожков → рожки → лампы; потом проверки.
 */
import { rng } from '../../generator/geom.ts';

type V2 = [number, number];
type V3 = [number, number, number];
const D2R = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * t * (t * (6 * t - 15) + 10); };

// ─── масса и центр тяжести по сетке (сумма тетраэдров) ───────────────────────
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

// ─── путь рожка в радиальной плоскости (ρ, z) ────────────────────────────────
// корень вниз по грани → гиб R1 → прямой участок → пологая дуга R2 → загиб вверх R3 (конец под лампу).
// θ — угол касательной (−90° = вниз). Поворот всё время в одну сторону → жёлоб вынимается из двусторонней формы.
// Угол после гиба θ1 подбирается возле заданного так, чтобы конец пришёл точно в (ρE, zE).
function makePath(pp: any, A: V2, th0: number, th1n: number, thM: number, thT: number, rhoE: number, zE: number, warn: string[]) {
  const T = (t: number): V2 => [Math.cos(t), Math.sin(t)];
  const Nn = (t: number): V2 => [-Math.sin(t), Math.cos(t)];
  const Lr = pp.root_len, R1 = pp.bend_r, R3 = pp.curl_r;
  const P1: V2 = [A[0] + Lr * Math.cos(th0), A[1] + Lr * Math.sin(th0)];
  const curl: V2 = [R3 * (Math.sin(thT) - Math.sin(thM)), R3 * (Math.cos(thM) - Math.cos(thT))];
  const solve = (th1: number) => {
    const B: V2 = [P1[0] + R1 * (Math.sin(th1) - Math.sin(th0)), P1[1] + R1 * (Math.cos(th0) - Math.cos(th1))];
    const e1 = T(th1), a: V2 = [Math.sin(thM) - Math.sin(th1), Math.cos(th1) - Math.cos(thM)];
    const dx = rhoE - B[0] - curl[0], dz = zE - B[1] - curl[1], det = e1[0] * a[1] - a[0] * e1[1];
    const L1 = (dx * a[1] - a[0] * dz) / det, R2 = (e1[0] * dz - e1[1] * dx) / det;
    return { th1, B, e1, L1, R2, ok: th1 > th0 + 10 * D2R && th1 < thM - 2 * D2R && L1 >= 0 && R2 >= pp.arc_r_min && isFinite(R2) };
  };
  let S = solve(th1n);
  for (let k = 1; !S.ok && k <= 150; k++) for (const sg of [1, -1]) { const t = solve(th1n + sg * k * D2R); if (t.ok && !S.ok) S = t; }
  if (!S.ok) {   // недостижимо — берём ближайший к допустимому вариант (а не мусор) и предупреждаем
    const pen = (q: ReturnType<typeof solve>) => (isFinite(q.R2) ? Math.max(0, -q.L1) + Math.max(0, pp.arc_r_min - q.R2) : Infinity);
    for (let k = -150; k <= 150; k++) { const t = solve(th1n + k * D2R); if (t.th1 > th0 + 10 * D2R && t.th1 < thM - 2 * D2R && pen(t) < pen(S)) S = t; }
    warn.push(`рожок: конец (${rhoE.toFixed(0)}, ${zE.toFixed(0)}) не достижим плавно`);
    S.L1 = Math.max(0, S.L1); S.R2 = clamp(S.R2, pp.arc_r_min, 3000);
  }
  const { th1, B, e1, L1, R2 } = S;
  const P2: V2 = [B[0] + L1 * e1[0], B[1] + L1 * e1[1]];
  const C1: V2 = [P1[0] + R1 * Nn(th0)[0], P1[1] + R1 * Nn(th0)[1]];
  const C2: V2 = [P2[0] + R2 * Nn(th1)[0], P2[1] + R2 * Nn(th1)[1]];
  const P4: V2 = [C2[0] + R2 * Math.sin(thM), C2[1] - R2 * Math.cos(thM)];
  const C3: V2 = [P4[0] + R3 * Nn(thM)[0], P4[1] + R3 * Nn(thM)[1]];
  const E: V2 = [C3[0] + R3 * Math.sin(thT), C3[1] - R3 * Math.cos(thT)];
  const s1 = Lr, s2 = s1 + R1 * (th1 - th0), s3 = s2 + L1, s4 = s3 + R2 * (thM - th1), sE = s4 + R3 * (thT - thM), L = sE + pp.tip_ext;
  const at = (s: number): { p: V2; th: number } => {
    if (s <= s1) return { p: [A[0] + s * Math.cos(th0), A[1] + s * Math.sin(th0)], th: th0 };
    if (s <= s2) { const f = th0 + (s - s1) / R1; return { p: [C1[0] + R1 * Math.sin(f), C1[1] - R1 * Math.cos(f)], th: f }; }
    if (s <= s3) return { p: [B[0] + (s - s2) * e1[0], B[1] + (s - s2) * e1[1]], th: th1 };
    if (s <= s4) { const f = th1 + (s - s3) / R2; return { p: [C2[0] + R2 * Math.sin(f), C2[1] - R2 * Math.cos(f)], th: f }; }
    if (s <= sE) { const f = thM + (s - s4) / R3; return { p: [C3[0] + R3 * Math.sin(f), C3[1] - R3 * Math.cos(f)], th: f }; }
    return { p: [E[0] + (s - sE) * Math.cos(thT), E[1] + (s - sE) * Math.sin(thT)], th: thT };
  };
  let low = 0;
  for (let s = 0; s <= sE; s += 1) low = Math.min(low, at(s).p[1]);
  return { at, L, sE, s1, s2, s4, th1, L1, R2, E, low };
}

// ─── сечение жёлоба: средняя линия y = h·|u|^p, стенка ±T/2, кромки полукруглые ───
// порядок точек: спина (u −1→1) · кромка + · внутренняя (u 1→−1) · кромка −   → против часовой в (x, y)
function section(w: number, h: number, p: number, T: number, M: number, m: number) {
  const a = w / 2, hT = T / 2;
  const mid: V2[] = [], nu: V2[] = [], tg: V2[] = [];
  for (let k = 0; k <= M; k++) {
    const u = -Math.cos(Math.PI * k / M);
    const au = Math.abs(u), sg = Math.sign(u);
    const y = h * Math.pow(au, p), dy = au > 0 ? h * p * Math.pow(au, p - 1) * sg / a : 0;
    const n = Math.hypot(1, dy);
    mid.push([a * u, y]); tg.push([1 / n, dy / n]); nu.push([-dy / n, 1 / n]);
  }
  const pts: V2[] = [], tag: number[] = [];   // 0 спина, 1 внутренняя, 2 кромка
  for (let k = 0; k <= M; k++) { pts.push([mid[k][0] - hT * nu[k][0], mid[k][1] - hT * nu[k][1]]); tag.push(0); }
  for (let j = 1; j < m; j++) {
    const f = Math.PI * j / m, c = mid[M];
    pts.push([c[0] + hT * (-Math.cos(f) * nu[M][0] + Math.sin(f) * tg[M][0]), c[1] + hT * (-Math.cos(f) * nu[M][1] + Math.sin(f) * tg[M][1])]); tag.push(2);
  }
  for (let k = M; k >= 0; k--) { pts.push([mid[k][0] + hT * nu[k][0], mid[k][1] + hT * nu[k][1]]); tag.push(1); }
  for (let j = 1; j < m; j++) {
    const f = Math.PI * j / m, c = mid[0];
    pts.push([c[0] + hT * (Math.cos(f) * nu[0][0] - Math.sin(f) * tg[0][0]), c[1] + hT * (Math.cos(f) * nu[0][1] - Math.sin(f) * tg[0][1])]); tag.push(2);
  }
  return { pts, tag };
}

// P — params.json; wasm — модуль manifold-3d после setup(). opt.checks = false — без проверки съёма (быстрее)
export function build(P: any, wasm: any, opt: { checks?: boolean } = {}) {
  const { Manifold, Mesh } = wasm;
  const warn: string[] = [];
  const H = P.hub, pp = P.petal, LP = P.lamp, VR = P.vary;
  // ширина: лопасти и высоты концов масштабируются от расчётной ширины, узел — стандартная деталь (не меняется)
  const kD = P.diameter / (P.design_diameter ?? 650);
  const TI = P.tiers.map((tr: any) => {
    const zRootEnd = tr.root_top_z - pp.root_len;
    return { ...tr, blade_w: tr.blade_w * kD, blade_depth: tr.blade_depth * kD, tip_z: zRootEnd + (tr.tip_z - zRootEnd) * kD };
  });
  const kg = (vol: number) => vol * P.brass_density_g_cm3 / 1e6;
  const dr = Math.tan(H.draft_deg * D2R);
  const fromMesh = (verts: number[], tri: number[]) =>
    new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tri) }));

  // ═════ 1. Узел — гранёная ваза, сверху открыта (штанга входит до пластины), ножка — два яруса граней ═════
  // Шестигранник с апофемой a на высоте z; нижний ярус повёрнут на 30°. Размер к низу только уменьшается —
  // отливается без стержня (разъём по верхней кромке).
  const aw = H.lower_apothem / Math.cos(Math.PI / 6) + 0.4 + (H.waist_z - H.tier_z) * dr;   // апофема на талии
  const aUp = (z: number) => {                                        // воронка к талии, ниже — верхний ярус с уклоном
    if (z <= H.waist_z) return aw - (H.waist_z - z) * dr;
    const u = (z - H.waist_z) / -H.waist_z;
    return aw + (z - H.waist_z) * dr + (H.top_apothem - aw + H.waist_z * dr) * u * u;
  };
  const aLow = (z: number) => H.lower_apothem - (H.tier_z - z) * dr;
  const loft = (levels: { z: number; a: number }[], rot: number) => {   // шестигранная «труба» с крышками, уровни сверху вниз
    const verts: number[] = [], tri: number[] = [];
    for (const { z, a } of levels) for (let k = 0; k < 6; k++) {
      const t = rot + Math.PI / 6 + k * Math.PI / 3, r = a / Math.cos(Math.PI / 6);
      verts.push(r * Math.cos(t), r * Math.sin(t), z);
    }
    const n = levels.length;
    for (let j = 0; j + 1 < n; j++) for (let k = 0; k < 6; k++) {
      const a = j * 6 + k, b = j * 6 + (k + 1) % 6, c = (j + 1) * 6 + (k + 1) % 6, d = (j + 1) * 6 + k;
      tri.push(a, c, b, a, d, c);
    }
    for (let k = 1; k < 5; k++) { tri.push(0, k, k + 1); tri.push((n - 1) * 6, (n - 1) * 6 + k + 1, (n - 1) * 6 + k); }
    const m = fromMesh(verts, tri);
    if (m.volume() < 0) throw new Error('узел: сетка вывернута');
    return m;
  };
  const lev = (f: (z: number) => number, z0: number, z1: number, d = 0, step = 3) => {
    const L: { z: number; a: number }[] = [];
    const n = Math.max(1, Math.ceil((z0 - z1) / step));
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; L.push({ z, a: f(z) - d }); }
    return L;
  };
  const T_h = H.wall, dWall = T_h / Math.cos(H.draft_deg * D2R);
  const aBot = aLow(H.bottom_z);
  const up = loft(lev(aUp, 0, H.tier_z), 0);
  const lowTier = loft([...lev(aLow, H.tier_z + 0.5, H.bottom_z),
    ...lev((z) => (aBot - 1.5) * (z - H.finial_z) / (H.bottom_z - H.finial_z) + 1.5, H.bottom_z - 3, H.finial_z)], 30 * D2R);
  const hubOuter = Manifold.union(up, lowTier);
  const inUp = loft(lev(aUp, 5, H.tier_z + T_h, dWall).map((q) => ({ z: q.z, a: q.z > 0 ? aUp(0) - dWall : q.a })), 0);
  const inLow = loft(lev(aLow, H.tier_z + T_h + 1, H.bottom_z + T_h, dWall), 30 * D2R);
  const hubCast = hubOuter.subtract(Manifold.union(inUp, inLow));    // мастер-модель узла (без сверловки)
  const zp = -H.plate_depth;
  const hubPlate = inUp.trimByPlane([0, 0, -1], -(zp + H.plate_t / 2)).trimByPlane([0, 0, 1], zp - H.plate_t / 2)
    .subtract(Manifold.cylinder(40, H.rod_d / 2, H.rod_d / 2, 48, true).translate([0, 0, zp]));

  // ═════ 2. Рожки: два яруса, у каждого рожка своя форма; разброс в ярусе без первой гармоники ═════
  const R = rng(P.seed);
  const rnd = () => 2 * R() - 1;
  type Pet = { tier: number; phi: number; dev: Record<string, number> };
  const pets: Pet[] = [];
  TI.forEach((tr: any, ti: number) => {
    const devs: Record<string, number[]> = { reach: [], tz: [], dT: [], w: [], h: [] };
    for (let i = 0; i < tr.count; i++) {
      devs.reach.push(rnd() * VR.reach); devs.tz.push(rnd() * VR.tip_z); devs.dT.push(rnd() * VR.tip_deg);
      devs.w.push(rnd() * VR.width); devs.h.push(rnd() * VR.depth);
    }
    const ph = (i: number) => tr.rot_deg * D2R + 2 * Math.PI * i / tr.count;
    const noH1 = (x: number[]) => {
      let c = 0, s = 0;
      x.forEach((v, i) => { c += v * Math.cos(ph(i)); s += v * Math.sin(ph(i)); });
      return x.map((v, i) => v - (2 / tr.count) * (c * Math.cos(ph(i)) + s * Math.sin(ph(i))));
    };
    for (const k of ['reach', 'w', 'h', 'dT']) devs[k] = noH1(devs[k]);
    for (let i = 0; i < tr.count; i++) pets.push({ tier: ti, phi: ph(i), dev: Object.fromEntries(Object.entries(devs).map(([k, v]) => [k, v[i]])) });
  });
  pets.sort((a, b) => a.phi - b.phi);
  const N = pets.length;
  const apoT = (ti: number, z: number) => (ti === 0 ? aUp(z) : aLow(z));
  const th0 = -Math.PI / 2 - H.draft_deg * D2R;                     // корень идёт вниз по грани (ножка к низу уже)

  function buildPetal(pi: number, rhoE: number, checks = true) {
    const pt = pets[pi], tr = TI[pt.tier], d = pt.dev;
    const cph = Math.cos(pt.phi), sph = Math.sin(pt.phi);
    const A: V2 = [apoT(pt.tier, tr.root_top_z) + pp.wall / 2, tr.root_top_z];
    const thT = (tr.tip_deg + d.dT) * D2R, zE = tr.tip_z + d.tz;
    const path = makePath(pp, A, th0, tr.rise_deg * D2R, tr.mid_deg * D2R, thT, rhoE * tr.reach * (1 + d.reach), zE, warn);
    // конец должен подниматься над листом, иначе горизонтальный срез под пластину заденет лист
    const Wm = tr.blade_w * (1 + d.w), Hm = tr.blade_depth * (1 + d.h);
    const wideAt = tr.wide_at ?? pp.wide_at, alpha = Math.log(0.5) / Math.log(wideAt), roll = (tr.roll_deg ?? 0) * D2R;
    const prof = (s: number) => {
      // корень и гиб узкие (жёлоб там смотрит почти против съёма); лист раскрывается после гиба
      // и плавно (sin²) сходится к ширине конца до начала загиба; загиб — узкий
      if (s <= path.s2) return { w: pp.root_w, h: pp.root_depth, p: pp.root_p, psi: 0 };
      const tau = clamp((s - path.s2) / (path.s4 - path.s2), 0, 1);
      const bump = Math.sin(Math.PI * Math.pow(tau, alpha)) ** 2;
      const lin = (a: number, b: number) => a + (b - a) * tau, linM = (a: number, b: number) => a + (b - a) * wideAt;
      return {
        w: lin(pp.root_w, pp.tip_w) + (Wm - linM(pp.root_w, pp.tip_w)) * bump,
        h: lin(pp.root_depth, pp.tip_depth) + (Hm - linM(pp.root_depth, pp.tip_depth)) * bump,
        p: pp.root_p + (pp.blade_p - pp.root_p) * smooth(tau / 0.25),
        psi: roll * smooth(tau / pp.roll_ramp),                           // лист встаёт «на ребро» (вихрь)
      };
    };
    const ns = Math.ceil(path.L / pp.step_s) + 1;
    const verts: number[] = [], loops: number[][] = [];
    let tags: number[] = [];
    for (let j = 0; j < ns; j++) {
      const s = path.L * j / (ns - 1), { p: pc, th } = path.at(s), pr = prof(s);
      const sec = section(pr.w, pr.h, pr.p, pp.wall, pp.profile_pts, pp.rim_pts);
      tags = sec.tag;
      // сечение в плоскости поперёк пути: ширина — вдоль w', раскрытие жёлоба — вдоль n' (повёрнуты на ψ вокруг пути)
      const n3: V3 = [-Math.sin(th) * cph, -Math.sin(th) * sph, Math.cos(th)], t3: V3 = [-sph, cph, 0];
      const c = Math.cos(pr.psi), sn = Math.sin(pr.psi);
      const w3 = [0, 1, 2].map((k) => c * t3[k] - sn * n3[k]), o3 = [0, 1, 2].map((k) => c * n3[k] + sn * t3[k]);
      const P3 = [pc[0] * cph, pc[0] * sph, pc[1]];
      const idx: number[] = [];
      for (const [x, y] of sec.pts) {
        idx.push(verts.length / 3);
        verts.push(P3[0] + x * w3[0] + y * o3[0], P3[1] + x * w3[1] + y * o3[1], P3[2] + x * w3[2] + y * o3[2]);
      }
      loops.push(idx);
    }
    const K = loops[0].length, tri: number[] = [], triTag: number[] = [];
    for (let j = 0; j + 1 < ns; j++) for (let k = 0; k < K; k++) {
      const a = loops[j][k], b = loops[j][(k + 1) % K], c = loops[j + 1][(k + 1) % K], e = loops[j + 1][k];
      const tg = tags[k] === tags[(k + 1) % K] ? tags[k] : 2;
      tri.push(a, b, c, a, c, e); triTag.push(tg, tg);
    }
    const M = pp.profile_pts, m = pp.rim_pts;
    const cap = (lp: number[], flip: boolean) => {
      const add = (x: number, y: number, z: number) => { flip ? tri.push(x, z, y) : tri.push(x, y, z); triTag.push(3); };
      const back = (k: number) => lp[k], inner = (k: number) => lp[M + m + (M - k)];
      for (let k = 0; k < M; k++) { add(back(k), back(k + 1), inner(k + 1)); add(back(k), inner(k + 1), inner(k)); }
      const rimP = [lp[M], ...Array.from({ length: m - 1 }, (_, j) => lp[M + 1 + j]), lp[M + m]];
      for (let j = 1; j + 1 < rimP.length; j++) add(rimP[0], rimP[j], rimP[j + 1]);
      const rimM = [lp[2 * M + m], ...Array.from({ length: m - 1 }, (_, j) => lp[2 * M + m + 1 + j]), lp[0]];
      for (let j = 1; j + 1 < rimM.length; j++) add(rimM[0], rimM[j], rimM[j + 1]);
    };
    cap(loops[0], true); cap(loops[ns - 1], false);
    let man = fromMesh(verts, tri);
    if (man.volume() < 0) throw new Error('рожок вывернут');
    // конец — срез поперёк оси лампы; ось лампы — между вертикалью и направлением носика (lamp_follow: 0 — вертикально,
    // 1 — по носику). Режется только у конца (в полосе ±70 мм от конца вдоль плоскости среза)
    const E = path.E, phL = (90 - (90 - thT / D2R) * pp.lamp_follow) * D2R;
    const nL: V2 = [Math.cos(phL), Math.sin(phL)], uL: V2 = [-Math.sin(phL), Math.cos(phL)];
    const loc = (x: number, y: number, z: number) => ({ r: x * cph + y * sph, t: -x * sph + y * cph, z });
    const inCut = (x: number, y: number, z: number) => {
      const q = loc(x, y, z), dr = q.r - E[0], dz = q.z - E[1];
      return dr * nL[0] + dz * nL[1] > 0 && Math.abs(dr * uL[0] + dz * uL[1]) < 70;
    };
    const place = (m: any) => m.rotate([0, 90 - phL / D2R, 0]);
    man = man.subtract(place(Manifold.cube([140, 400, 200]).translate([-70, -200, 0])).translate([E[0], 0, E[1]]).rotate([0, 0, pt.phi / D2R]));

    // съём из двусторонней формы: направление d в радиальной плоскости, подбирается на наибольший наименьший уклон
    const fn: { n: V3; tg: number; s: number }[] = [];
    for (let t = 0; checks && t < triTag.length; t++) {
      if (triTag[t] > 1) continue;
      const ia = tri[3 * t] * 3, ib = tri[3 * t + 1] * 3, ic = tri[3 * t + 2] * 3;
      if (inCut((verts[ia] + verts[ib] + verts[ic]) / 3, (verts[ia + 1] + verts[ib + 1] + verts[ic + 1]) / 3, (verts[ia + 2] + verts[ib + 2] + verts[ic + 2]) / 3)) continue;
      const u: V3 = [verts[ib] - verts[ia], verts[ib + 1] - verts[ia + 1], verts[ib + 2] - verts[ia + 2]];
      const v: V3 = [verts[ic] - verts[ia], verts[ic + 1] - verts[ia + 1], verts[ic + 2] - verts[ia + 2]];
      const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const ln = Math.hypot(n[0], n[1], n[2]);
      if (ln < 1e-9) continue;
      const sg = triTag[t] === 1 ? 1 : -1;
      fn.push({ n: [sg * n[0] / ln, sg * n[1] / ln, sg * n[2] / ln], tg: triTag[t], s: Math.floor(t / (2 * K)) * path.L / (ns - 1) });
    }
    // два куска (ножка до sSplit + лист после) — у каждого своё направление съёма
    const sSplit = path.s2 + pp.split_after_bend;
    const bestOf = (sub: typeof fn) => {
      const wst = (b: number, g: number, step = 1) => {
        const dd = dOf(b, g); let a = 90;
        for (let i = 0; i < sub.length; i += step) { const f = sub[i]; a = Math.min(a, Math.asin(clamp(f.n[0] * dd[0] + f.n[1] * dd[1] + f.n[2] * dd[2], -1, 1)) / D2R); }
        return a;
      };
      let bb = 0, bg = 0, ba = -90;
      for (let b = -30; b <= 180; b += 4) for (let g = -85; g <= 85; g += 4) { const a = wst(b * D2R, g * D2R, 4); if (a > ba) { ba = a; bb = b; bg = g; } }
      const b1 = bb, g1 = bg;
      for (let b = b1 - 4; b <= b1 + 4; b++) for (let g = g1 - 4; g <= g1 + 4; g++) { const a = wst(b * D2R, g * D2R); if (a > ba) { ba = a; bb = b; bg = g; } }
      return { draft: +ba.toFixed(1), pull: [bb, bg] };
    };
    const dOf = (b: number, g = 0): V3 => {
      const c = Math.cos(g);
      return [c * Math.cos(b) * cph - Math.sin(g) * sph, c * Math.cos(b) * sph + Math.sin(g) * cph, c * Math.sin(b)];
    };
    const worst = (b: number, g: number, step = 1) => {
      const dd = dOf(b, g); let w = { a: 90, s: 0, tg: 0 };
      for (let i = 0; i < fn.length; i += step) { const f = fn[i]; const a = Math.asin(clamp(f.n[0] * dd[0] + f.n[1] * dd[1] + f.n[2] * dd[2], -1, 1)) / D2R; if (a < w.a) w = { a, s: f.s, tg: f.tg }; }
      return w;
    };
    const b0 = (th0 + thT) / 2 + Math.PI / 2;
    let beta = b0, gam = 0, bw = worst(b0, 0, 4);
    const one = checks && pp.pieces !== 2;                           // одним куском — ищем общее направление
    for (let db = -60; one && db <= 60; db += 4) for (let dg = -80; dg <= 80; dg += 4) {
      const w2 = worst(b0 + db * D2R, dg * D2R, 4); if (w2.a > bw.a) { beta = b0 + db * D2R; gam = dg * D2R; bw = w2; }
    }
    const bc = beta, gc = gam; bw = worst(bc, gc);
    for (let db = -4; one && db <= 4; db += 1) for (let dg = -4; dg <= 4; dg += 1) {
      const w2 = worst(bc + db * D2R, gc + dg * D2R); if (w2.a > bw.a) { beta = bc + db * D2R; gam = gc + dg * D2R; bw = w2; }
    }
    // срез: центр и размер под пластину (в плоскости среза: u — вдоль, t — поперёк)
    const cutPts = vertsOf(man.getMesh()).map((q) => loc(q[0], q[1], q[2]))
      .filter((q) => Math.abs((q.r - E[0]) * nL[0] + (q.z - E[1]) * nL[1]) < 1e-3 && Math.abs((q.r - E[0]) * uL[0] + (q.z - E[1]) * uL[1]) < 70)
      .map((q) => ({ u: (q.r - E[0]) * uL[0] + (q.z - E[1]) * uL[1], t: q.t }));
    const uc = (Math.min(...cutPts.map((q) => q.u)) + Math.max(...cutPts.map((q) => q.u))) / 2;
    const tc = (Math.min(...cutPts.map((q) => q.t)) + Math.max(...cutPts.map((q) => q.t))) / 2;
    const rCut = Math.max(...cutPts.map((q) => Math.hypot(q.u - uc, q.t - tc)));
    const tipL = { r: E[0] + uc * uL[0], t: tc, z: E[1] + uc * uL[1] };
    const tipC: V2 = [tipL.r * cph - tipL.t * sph, tipL.r * sph + tipL.t * cph];
    const zTip = tipL.z;
    const noSplit = { draft: 0, pull: [0, 0] };
    const split = { at_mm: +sSplit.toFixed(0), stem: checks ? bestOf(fn.filter((f) => f.s < sSplit)) : noSplit,
      blade: checks ? bestOf(fn.filter((f) => f.s >= sSplit)) : noSplit };
    const sp = path.at(sSplit);
    const seamN: V3 = [Math.cos(sp.th) * cph, Math.cos(sp.th) * sph, Math.sin(sp.th)];
    const seamO = seamN[0] * sp.p[0] * cph + seamN[1] * sp.p[0] * sph + seamN[2] * sp.p[1];
    return { man, path, zE: zTip, d: dOf(beta, gam), beta, gam, draft: bw.a, split, seamN, seamO, dStem: dOf(split.stem.pull[0] * D2R, split.stem.pull[1] * D2R),
      dBlade: dOf(split.blade.pull[0] * D2R, split.blade.pull[1] * D2R), worstAt: { s: +bw.s.toFixed(0), of: +path.L.toFixed(0), side: bw.tg === 1 ? 'внутр.' : 'спина' },
      tipC, tipL, phL, place, rCut, Wm, Hm, thT, tier: pt.tier, phi: pt.phi, cph, sph };
  }

  const lampParts = (pt: ReturnType<typeof buildPetal>) => {
    const rP = Math.max(LP.plate_d_min / 2, pt.rCut + 1.5);
    const put = (m: any) => pt.place(m).translate([pt.tipL.r, pt.tipL.t, pt.tipL.z]).rotate([0, 0, pt.phi / D2R]);
    const plate = put(Manifold.cylinder(LP.plate_t, rP, rP, 64).subtract(Manifold.cylinder(LP.plate_t * 3, LP.thread_d / 2, LP.thread_d / 2, 32, true)));
    const socket = put(Manifold.cylinder(LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 48).translate([0, 0, LP.plate_t]));
    const rb = LP.bulb_d / 2;
    const bulb = put(Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 48), Manifold.sphere(rb, 48).translate([0, 0, LP.bulb_h - rb]))
      .translate([0, 0, LP.plate_t + LP.socket_h]));
    return { plate, socket, bulb, rP };
  };
  const extentOf = (ms: any[]) => {
    let e = 0;
    for (const m of ms) for (const q of vertsOf(m.getMesh())) e = Math.max(e, Math.hypot(q[0], q[1]));
    return e;
  };
  // проходы: подогнать вылет так, чтобы габарит по кругу был ровно Ø
  let rhoE = P.diameter / 2 - 12;
  let petals: ReturnType<typeof buildPetal>[] = [];
  for (let pass = 0; pass < 4; pass++) {
    warn.length = 0;
    petals = pets.map((_, i) => buildPetal(i, rhoE, false));
    const ext = extentOf(petals.flatMap((pt) => { const l = lampParts(pt); return [pt.man, l.plate, l.bulb]; }));
    if (Math.abs(ext - P.diameter / 2) < 0.3) break;
    rhoE += P.diameter / 2 - ext;
  }
  if (opt.checks !== false) { warn.length = 0; petals = pets.map((_, i) => buildPetal(i, rhoE, true)); }   // съём — один раз, в конце
  const lamps = petals.map(lampParts);

  // ═════ 3. Сверловка (после литья): M6 и провод — в узле и в корне каждого рожка ═════
  const radialHole = (pt: ReturnType<typeof buildPetal>, z: number, dia: number) =>
    Manifold.cylinder(14, dia / 2, dia / 2, 32, true).rotate([0, 90, 0]).translate([apoT(pt.tier, z), 0, z]).rotate([0, 0, pt.phi / D2R]);
  const hubHoles: any[] = [];
  const petalsView = petals.map((pt) => {
    const tr = TI[pt.tier];
    const hs = [...tr.screw_z.map((z: number) => radialHole(pt, z, pp.screw_clear_d)), radialHole(pt, tr.wire_z, pp.wire_hole_d)];
    for (const z of tr.screw_z) hubHoles.push(radialHole(pt, z, pp.screw_tap_d));
    hubHoles.push(radialHole(pt, tr.wire_z, pp.wire_hole_d));
    return pt.man.subtract(Manifold.union(hs));
  });
  const hubView = hubCast.subtract(Manifold.union(hubHoles));
  const screws = Manifold.compose(petals.flatMap((pt) => TI[pt.tier].screw_z.map((z: number) => {
    const a = apoT(pt.tier, z);
    const head = Manifold.cylinder(4, 5, 4.5, 32).rotate([0, 90, 0]).translate([a + pp.wall, 0, z]);
    const shank = Manifold.cylinder(10, 3, 3, 24).rotate([0, 90, 0]).translate([a - 8, 0, z]);
    return Manifold.union(head, shank).rotate([0, 0, pt.phi / D2R]);
  })));

  // штанга и чаша (чаша — условный диск, стандарт чаши не заполнен)
  const zLow = Math.min(...petals.map((pt) => pt.path.low - pp.wall / 2), H.finial_z);
  const zCeil = zLow + P.height_total;
  const rodBottom = zp - H.plate_t / 2, rodTop = zCeil - H.cup_h + 10;
  const rod = Manifold.cylinder(rodTop - rodBottom, H.rod_d / 2, H.rod_d / 2, 48).translate([0, 0, rodBottom])
    .subtract(Manifold.cylinder(rodTop - rodBottom + 2, H.rod_d / 2 - 2, H.rod_d / 2 - 2, 48).translate([0, 0, rodBottom - 1]));
  const cup = Manifold.cylinder(H.cup_h, H.cup_d / 2 * 0.8, H.cup_d / 2, 96).translate([0, 0, zCeil - H.cup_h]);

  // ═════ 4. Проверки ═════
  const hubPet = petals.map((pt) => pt.man.intersect(hubCast).volume());
  const clash: number[] = [];
  const clashPairs: string[] = [];
  for (let i = 0; i < N; i++) for (const j of [i + 1, i + 2]) {
    const v = petals[i].man.intersect(petals[j % N].man).volume();
    clash.push(v); if (v > 0.5) clashPairs.push(`Р${i + 1}×Р${(j % N) + 1}: ${v.toFixed(0)} мм³`);
  }
  if (Math.max(...hubPet) > 1) warn.push(`рожок врезается в узел: до ${Math.max(...hubPet).toFixed(1)} мм³`);
  if (clashPairs.length) warn.push(`рожки задевают друг друга: ${clashPairs.join(', ')}`);
  const two = pp.pieces === 2;
  const draftMin = two ? Math.min(...petals.map((pt) => Math.min(pt.split.stem.draft, pt.split.blade.draft))) : Math.min(...petals.map((pt) => pt.draft));
  if (opt.checks !== false && draftMin < pp.draft_min_deg) warn.push(`уклон под съём ${draftMin.toFixed(1)}° < ${pp.draft_min_deg}°`);
  let hubDraft = 90;
  {
    const m = hubCast.getMesh(), vp = m.vertProperties, tv = m.triVerts, np = m.numProp;
    for (let t = 0; t < tv.length; t += 3) {
      const a = tv[t] * np, b = tv[t + 1] * np, c = tv[t + 2] * np;
      const u = [vp[b] - vp[a], vp[b + 1] - vp[a + 1], vp[b + 2] - vp[a + 2]], v = [vp[c] - vp[a], vp[c + 1] - vp[a + 1], vp[c + 2] - vp[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const ln = Math.hypot(n[0], n[1], n[2]); if (ln < 1e-9) continue;
      const nz = Math.abs(n[2] / ln); if (nz > 0.999) continue;
      hubDraft = Math.min(hubDraft, Math.asin(nz) / D2R);
    }
  }
  if (hubDraft < 1) warn.push(`узел: есть грани без уклона (${hubDraft.toFixed(1)}°)`);

  const mp = (m: any) => massProps(m.getMesh());
  const petalMP = petalsView.map(mp), hubMP = mp(hubView), plateMP = mp(hubPlate), tipMP = lamps.map((l) => mp(l.plate)), rodMP = mp(rod);
  const parts: { kg: number; c: V3 }[] = [
    ...petalMP.map((q) => ({ kg: kg(q.vol), c: q.c })), { kg: kg(hubMP.vol), c: hubMP.c }, { kg: kg(plateMP.vol), c: plateMP.c },
    ...tipMP.map((q) => ({ kg: kg(q.vol), c: q.c })), { kg: kg(rodMP.vol), c: rodMP.c },
    ...petals.map((pt) => ({ kg: LP.socket_bulb_kg, c: [pt.tipC[0], pt.tipC[1], pt.zE + 50] as V3 })),
  ];
  const total = parts.reduce((s, q) => s + q.kg, 0);
  const com = [0, 1, 2].map((k) => parts.reduce((s, q) => s + q.kg * q.c[k], 0) / total);
  const comOff = Math.hypot(com[0], com[1]);
  const petalKg = petalMP.map((q) => kg(q.vol));


  // куски под печать: мастер-модели и направление съёма (рамка e, t, d — d станет «вверх» на столе)
  const printJobs = petals.flatMap((pt, i) => {
    const frame = (d: V3) => {
      const t0: V3 = [-pt.sph, pt.cph, 0];
      let e: V3 = [t0[1] * d[2] - t0[2] * d[1], t0[2] * d[0] - t0[0] * d[2], t0[0] * d[1] - t0[1] * d[0]];
      const le = Math.hypot(...e); e = [e[0] / le, e[1] / le, e[2] / le];
      return [e, [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]], d];
    };
    const n = String(i + 1).padStart(2, '0');
    return two
      ? [{ name: `R${n}a`, what: 'ножка', m: pt.man.trimByPlane([-pt.seamN[0], -pt.seamN[1], -pt.seamN[2]], -pt.seamO), base: frame(pt.dStem) },
         { name: `R${n}b`, what: 'лист', m: pt.man.trimByPlane(pt.seamN, pt.seamO), base: frame(pt.dBlade) }]
      : [{ name: `R${n}`, what: 'рожок', m: pt.man, base: frame(pt.d) }];
  });
  const seams = two ? Manifold.compose(petals.map((pt) =>
    pt.man.trimByPlane(pt.seamN, pt.seamO - 0.8).trimByPlane([-pt.seamN[0], -pt.seamN[1], -pt.seamN[2]], -(pt.seamO + 0.8)))) : null;

  const tag = `lepestok-${P.diameter}-${N}-seed${P.seed}`;
  const passport = {
    tag, seed: P.seed,
    size: { diameter_mm: P.diameter, height_total_mm: P.height_total, body_h_mm: +(-zLow).toFixed(0), rod_visible_mm: +(zCeil - H.cup_h).toFixed(0),
      hub_h_mm: -H.finial_z, hub_top_across_flats_mm: +(2 * H.top_apothem).toFixed(0), low_z: +zLow.toFixed(0) },
    mass_kg: {
      petals_each: petalKg.map((v) => +v.toFixed(3)), petals: +petalKg.reduce((a, b) => a + b, 0).toFixed(2),
      hub: +kg(hubMP.vol).toFixed(3), hub_plate: +kg(plateMP.vol).toFixed(3), tip_plates: +tipMP.reduce((s, q) => s + kg(q.vol), 0).toFixed(3),
      rod: +kg(rodMP.vol).toFixed(3), sockets_lamps: +(N * LP.socket_bulb_kg).toFixed(2), total_without_cup: +total.toFixed(2),
      mount: total > P.heavy_mount_kg ? 'усиленное (> 15 кг)' : 'обычное',
    },
    com_offset_mm: +comOff.toFixed(2),
    pieces: two ? 2 : 1,
    draft_deg: { petals_min: +draftMin.toFixed(1), hub_min: +hubDraft.toFixed(1),
      stem_min: +Math.min(...petals.map((pt) => pt.split.stem.draft)).toFixed(1), blade_min: +Math.min(...petals.map((pt) => pt.split.blade.draft)).toFixed(1) },
    petals: petals.map((pt, i) => ({
      n: i + 1, tier: TI[pt.tier].name, phi_deg: +(pt.phi / D2R).toFixed(0), reach_mm: +Math.hypot(...pt.tipC).toFixed(0), tip_z: +pt.zE.toFixed(0), low_z: +pt.path.low.toFixed(0),
      rise_deg: +(pt.path.th1 / D2R).toFixed(0), tip_deg: +(pt.thT / D2R).toFixed(0), arc_R: +pt.path.R2.toFixed(0), width_mm: +pt.Wm.toFixed(0), depth_mm: +pt.Hm.toFixed(0),
      split: pt.split, pull_deg: +(pt.beta / D2R).toFixed(0), pull_side_deg: +(pt.gam / D2R).toFixed(0), roll_deg: TI[pt.tier].roll_deg ?? 0,
      draft: +pt.draft.toFixed(1), worst_at: pt.worstAt, tip_plate_d: +(lamps[i].rP * 2).toFixed(0), kg: +petalKg[i].toFixed(3),
    })),
    clash: { petal_hub_mm3: +Math.max(...hubPet).toFixed(2), petal_petal_mm3: +Math.max(...clash).toFixed(2) },
  };
  return { passport, warn, hubCast, hubView, hubPlate, petals, petalsView, lamps, screws, rod, cup, seams, printJobs, kg, vertsOf, tag, N };
}
