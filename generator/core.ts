/**
 * Brass Art — генератор семейства CELL (оболочка-решётка). v0.3
 *
 * Один и тот же код должен работать у мастера (файлы на печать) и на сайте (превью).
 * Вход: params.json (все генеративные параметры — ЗАКОН №7). Выход: STL + паспорт изделия,
 * панели под печать мастер-моделей (panels.ts).
 *
 * Ядро генератора — без файлов и Node: работает и в цеху (generate.ts), и в браузере (web.ts → сайт).
 * Запуск в цеху:  node generate.ts ../params.json ../out
 *
 * Два вида узора (ручка `style`, мастер 2026-09-27: «узоры изящнее, ровнее; квадратный — вариант в семействе»):
 *  - "smooth" («плавный», основной) — дыры овальные (hole_round_ratio), кромки рёбер полукруглые,
 *                                      в узлах перепонки, как на референсе; строится через level set;
 *  - "facet"  («гранёный», вариант) — дыры вырезаны из оболочки, сечение прямоугольное, кромки чёткие.
 *
 * Общее для обоих:
 *  1. Точки-центры ячеек на сфере из «зерна»; у верхнего полюса — кольцо из pole_ribs точек,
 *     поэтому рёбра сходятся к полюсу радиально (требование мастера к верхнему узлу).
 *  2. Вороной на сфере (выпуклая оболочка точек = триангуляция Делоне).
 *  3. На полюсе — площадка с плоской посадкой сверху и снизу под шайбу и отверстие под трубу.
 *  4. Масса → труба центрального узла (M10×1 / M12) → крепление (порог 15 кг) → зазор ламп.
 *  5. Нарезка на панели (рез по тонким местам рёбер, панель влезает в стол принтера с усадкой).
 */
import { add, sub, mul, dot, cross, len, norm, angle, slerp, rng, tangentBasis, area2, inset, roundOut, inradius } from './geom.ts';

type V3 = [number, number, number];
type V2 = [number, number];

export function build(P: any, wasm: any) {
  const { Manifold } = wasm;
  const t0 = Date.now();

  const style: 'facet' | 'smooth' = P.style ?? 'facet';
  const R = P.diameter / 2;                    // наружный радиус шара
  const T = P.shell_depth;                     // глубина ребра (толщина оболочки)
  const Rin = R - T;                           // внутренний радиус оболочки
  const Rm = R - T / 2;                        // средняя поверхность оболочки
  const half = P.rib_mid / 2;
  const rand = rng(P.seed);
  const warn: string[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const fib = (i: number, n: number): V3 => { const z = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - z * z), phi = i * golden; return [r * Math.cos(phi), r * Math.sin(phi), z]; };

  // ── 0. форма оболочки: средняя поверхность r = rho(w) вдоль направления w из центра ──
  // шар — одобренный, как был. Остальные формы (мастер 2026-09-27: «формы генерируются рандомно»):
  // "oval" — сплюснутый овал высотой height_ratio от ширины + плавные случайные «вздутия» от зерна;
  // у верхнего полюса форма спокойная (площадка под шайбу плоская и на оси).
  const shape: string = P.shape ?? 'sphere';
  const general = shape !== 'sphere';
  const Rx = R - T / 2;
  let Rz = general ? (P.height_ratio ?? 1) * R - T / 2 : Rm;
  // профиль: "ellipse" — эллипс; "cushion" — «подушка»: плоский эллипс-сердцевина, обведённый кругом радиуса
  // rim_radius_ratio × полувысоты — край круглый (ячейки обнимают его спокойно, режется на панели), верх выпуклый
  let profTab: Float64Array | null = null;
  // «Волна» (02): край овала идёт волной вверх-вниз; гребней, сдвиг и высота — от зерна.
  // Таблица расстояний по азимуту и широте; к оси волна сходит на нет (площадка на полюсе ровная).
  let waveTab: Float64Array | null = null;
  const NAZ = 180, NLAT = 361;
  const wr = rng(P.seed * 13 + 5);
  const wave = {
    n: (P.wave_counts ?? [3, 4, 5])[Math.floor(wr() * (P.wave_counts ?? [3, 4, 5]).length)],
    ph: 2 * Math.PI * wr(), ph2: 2 * Math.PI * wr(),
    amp: (P.wave_amp_ratio ?? 0.09) * P.diameter * (0.8 + 0.4 * wr()),
  };
  const buildWave = () => {
    const tab = new Float64Array(NAZ * NLAT);
    for (let ia = 0; ia < NAZ; ia++) {
      const phi = (2 * Math.PI * ia) / NAZ;
      const h = wave.amp * (Math.sin(wave.n * phi + wave.ph) + 0.3 * Math.sin(2 * wave.n * phi + wave.ph2));
      const ang: number[] = [], dist: number[] = [];
      for (let i = 0; i <= 1500; i++) {
        const u = -Math.PI / 2 + (Math.PI * i) / 1500, r = Rx * Math.cos(u), q = r / Rx;
        const z = Rz * Math.sin(u) + h * q * q;
        ang.push(Math.atan2(z, r)); dist.push(Math.hypot(r, z));
      }
      for (let il = 0, j = 0; il < NLAT; il++) {
        const a = -Math.PI / 2 + (Math.PI * il) / (NLAT - 1);
        while (j < ang.length - 2 && ang[j + 1] < a) j++;
        const tt = Math.max(0, Math.min(1, (a - ang[j]) / (ang[j + 1] - ang[j] || 1)));
        tab[ia * NLAT + il] = dist[j] + (dist[j + 1] - dist[j]) * tt;
      }
    }
    waveTab = tab;
  };
  const buildProfile = () => {
    if (shape === 'wave') { buildWave(); return; }
    if ((P.profile ?? 'ellipse') !== 'cushion') { profTab = null; return; }
    const rr = (P.rim_radius_ratio ?? 0.8) * Rz, a1 = Rx - rr, c1 = Math.max(1, Rz - rr);
    const NT = 721, tab = new Float64Array(NT), ang: number[] = [], dist: number[] = [];
    for (let i = 0; i <= 4000; i++) {
      const u = -Math.PI / 2 + (Math.PI * i) / 4000, ex = a1 * Math.cos(u), ez = c1 * Math.sin(u);
      const nx = Math.cos(u) / a1, nz = Math.sin(u) / c1, nl = Math.hypot(nx, nz);
      const px = ex + (rr * nx) / nl, pz = ez + (rr * nz) / nl;
      ang.push(Math.atan2(pz, px)); dist.push(Math.hypot(px, pz));
    }
    for (let i = 0, j = 0; i < NT; i++) {                   // широта −90…90° → расстояние
      const a = -Math.PI / 2 + (Math.PI * i) / (NT - 1);
      while (j < ang.length - 2 && ang[j + 1] < a) j++;
      const t = Math.max(0, Math.min(1, (a - ang[j]) / (ang[j + 1] - ang[j] || 1)));
      tab[i] = dist[j] + (dist[j + 1] - dist[j]) * t;
    }
    profTab = tab;
  };
  const baseRho = (w: V3) => {
    if (waveTab) {
      const fa = (((Math.atan2(w[1], w[0]) / (2 * Math.PI)) + 1) % 1) * NAZ, ia = Math.floor(fa) % NAZ, ta = fa - Math.floor(fa), ib = (ia + 1) % NAZ;
      const fl = ((Math.asin(Math.max(-1, Math.min(1, w[2]))) + Math.PI / 2) / Math.PI) * (NLAT - 1);
      const il = Math.min(NLAT - 2, Math.floor(fl)), tl = fl - il;
      const v = (i: number, l: number) => waveTab![i * NLAT + l];
      return (v(ia, il) * (1 - tl) + v(ia, il + 1) * tl) * (1 - ta) + (v(ib, il) * (1 - tl) + v(ib, il + 1) * tl) * ta;
    }
    if (!profTab) return 1 / Math.sqrt((w[0] * w[0] + w[1] * w[1]) / (Rx * Rx) + (w[2] * w[2]) / (Rz * Rz));
    const f = ((Math.asin(Math.max(-1, Math.min(1, w[2]))) + Math.PI / 2) / Math.PI) * (profTab.length - 1);
    const i = Math.min(profTab.length - 2, Math.floor(f)), t = f - i;
    return profTab[i] + (profTab[i + 1] - profTab[i]) * t;
  };
  const calm = (w: V3) => {                                  // 0 у полюса → 1 дальше calm_deg[1]
    const [d0, d1] = P.shape_calm_deg ?? [25, 45];
    const t = Math.max(0, Math.min(1, ((angle(w, [0, 0, 1]) * 180) / Math.PI - d0) / (d1 - d0)));
    return t * t * (3 - 2 * t);
  };
  let bumps: { c: V3; s2: number; a: number }[] = [];
  const noise = (w: V3) => { let n = 0; for (const b of bumps) n += b.a * Math.exp(-(1 - dot(w, b.c)) / b.s2); return n; };
  if (general) buildProfile();
  const amp = general ? P.shape_irregularity ?? 0 : 0;
  let kS = 1;                                               // масштаб: ширина по факту = заданной
  let kvx = 0, kvy = 0, shapeGain = 1;                      // балансировка: плавный наклон профиля
  const rho = (w: V3) => (general ? kS * baseRho(w) * (1 + amp * calm(w) * noise(w)) * (1 - (kvx * w[0] + kvy * w[1]) * calm(w)) : Rm);
  const surf = (w: V3): V3 => mul(w, rho(w));
  const normalAt = (w: V3): V3 => {
    if (!general) return w;
    const [t1, t2] = tangentBasis(w), e = 2e-3, p0 = surf(w);
    let n = norm(cross(sub(surf(norm(add(w, mul(t1, e)))), p0), sub(surf(norm(add(w, mul(t2, e)))), p0)));
    return dot(n, w) < 0 ? mul(n, -1) : n;
  };
  // выборка по поверхности: точка, вес = площадь на телесный угол (для равных ячеек и центра тяжести)
  const NSS = general ? P.shape_samples ?? 20000 : 0;
  const curvAt = (x: V3) => {
    const r = Math.hypot(x[0], x[1]);
    const dth: V3 = r > 1e-6 ? [(x[2] * x[0]) / r, (x[2] * x[1]) / r, -r] : [1, 0, 0];
    const dph: V3 = r > 1e-6 ? [-x[1] / r, x[0] / r, 0] : [0, 1, 0];
    const n0 = normalAt(x), p0 = surf(x);
    let k = 0;
    for (const d of [dth, dph]) { const x1 = norm(add(x, mul(d, 0.02))); k = Math.max(k, angle(n0, normalAt(x1)) / len(sub(surf(x1), p0))); }
    return k;
  };
  type Smp = { x: V3; X: V3; wt: number; n: V3; k: number };
  const sampleAt = (x: V3): Smp => { const r0 = rho(x), n = normalAt(x); return { x, X: mul(x, r0), wt: (r0 * r0) / Math.max(0.2, dot(n, x)), n, k: curvAt(x) }; };
  const sampleShape = () => Array.from({ length: NSS }, (_, i) => sampleAt(fib(i, NSS)));
  let samples: Smp[] = [];
  // лампы: точки по оси патрона и колбы с радиусом (капсула) — для выбора формы и проверки зазора
  let Lp: any = { ...P.lamps, socket_name: P.lamps.socket_name ?? 'E27', bulb_name: P.lamps.bulb_name ?? 'A60' };
  const lampTiers: { direction: string; count: number }[] = Lp.tiers ?? [{ direction: Lp.direction, count: Lp.count }];
  const single = (lampTiers.reduce((s0, t) => s0 + t.count, 0) === 1) && P.lamps.single_center !== false && !P.bottom_seat;
  const capsFor = (deg: number) => {
  if (single) {                                               // колба по центру, патрон над ней, всё на оси
    const out: { q: V3; r: number }[] = [];
    for (let k = 0; k <= 4; k++) out.push({ q: [0, 0, Lp.bulb_length / 2 - Lp.bulb_d / 2 - ((Lp.bulb_length - Lp.bulb_d) * k) / 4], r: Lp.bulb_d / 2 });
    out.push({ q: [0, 0, Lp.bulb_length / 2 + Lp.socket_length / 2], r: (Lp.socket_d ?? 40) / 2 });
    return out;
  }
  const lampCaps: { q: V3; r: number }[] = [];
  // все рожки — по кольцу через равные углы, ярусы чередуются (lamp k → ярус k % число ярусов)
  const nAll = lampTiers.reduce((s0, t) => s0 + t.count, 0);
  lampTiers.forEach((t, ti) => {
    const sign = t.direction === 'up' ? 1 : t.direction === 'down' ? -1 : 0;
    const th = sign * (deg * Math.PI) / 180;
    const rb = Lp.arm_bend_radius, a = Math.max(0, (Lp.arm_length - rb * Math.abs(th)) / 2);
    const endR = Lp.ring_radius + a + rb * Math.sin(Math.abs(th)) + a * Math.cos(th);
    const endZ = Math.sign(th) * rb * (1 - Math.cos(th)) + a * Math.sin(th);
    for (let i = 0; i < t.count; i++) {
      const ph = (2 * Math.PI * (ti + i * lampTiers.length)) / nAll, c = Math.cos(ph), sn = Math.sin(ph);
      const at = (s0: number): V3 => { const rr = endR + s0 * Math.cos(th), zz = endZ + s0 * Math.sin(th); return [rr * c, rr * sn, zz]; };
      lampCaps.push({ q: at(Lp.socket_length), r: (Lp.socket_d ?? 40) / 2 });
      for (let k = 0; k <= 4; k++) lampCaps.push({ q: at(Lp.socket_length + Lp.bulb_d / 2 + ((Lp.bulb_length - Lp.bulb_d) * k) / 4), r: Lp.bulb_d / 2 });
    }
  });
  return lampCaps;
  };
  const innerGap = (q: V3) => {
    const r = len(q);
    if (r < 1) { const h: V3 = [1, 0, 0]; return rho(h) * dot(normalAt(h), h) - T / 2; }   // точка в самом центре — до стенки вбок
    const w = mul(q, 1 / r); return (rho(w) - r) * dot(normalAt(w), w) - T / 2;
  };
  const lampGap = (deg: number) => Math.min(...capsFor(deg).map((c) => innerGap(c.q) - c.r));
  // угол гиба рожка: самый большой до arm_angle_deg, при котором лампы не ближе lamp_min_gap к рёбрам
  // (мастер 2026-09-27: «на овале угол трубы поменьше, чтобы не задело»)
  // патрон и рожок под размер (мастер 2026-09-27: «в маленьком — E14», «трубы чуть укоротить»):
  // E27/A60 → E14/G45 → рожок короче — пока лампы с прямыми рожками не влезут с запасом lamp_min_gap
  const pickLampSpec = () => {
    const opts = single ? [{}] : [{}, ...(P.lamps.fallbacks ?? [])];   // одна лампа — всегда E27
    for (const o of opts) {
      Lp = { ...P.lamps, socket_name: P.lamps.socket_name ?? 'E27', bulb_name: P.lamps.bulb_name ?? 'A60', ...o };
      if (lampGap(pickAngle()) >= (P.lamp_min_gap ?? 40)) return;      // с лучшим допустимым углом гиба
    }
  };
  const pickAngle = () => {
    if (single) return 0;
    for (let deg = Lp.arm_angle_deg; deg > 0; deg -= 5) if (lampGap(deg) >= (P.lamp_min_gap ?? 40)) return deg;
    return 0;
  };
  if (general) {
    // из нескольких наборов «вздутий» берём тот, где центр площади оболочки ближе всего к оси —
    // чтобы люстра висела ровно (центр тяжести на оси, mounting-standard §6)
    const br = rng(P.seed * 7 + 101);
    let best: any = null;
    for (let tr = 0; tr < (P.shape_tries ?? 24); tr++) {
      const cand = Array.from({ length: P.shape_bumps ?? 7 }, () => {
        const z = (2 * br() - 1) * (P.shape_bump_band ?? 1), ph = 2 * Math.PI * br(), rr0 = Math.sqrt(1 - z * z);   // band < 1 — «вздутия» ближе к поясу (лопасти)
        return { c: [rr0 * Math.cos(ph), rr0 * Math.sin(ph), z] as V3, s2: 0.25 + 0.4 * br(), a: 2 * br() - 1 - (P.shape_inward ?? 0) };
      });
      bumps = cand;
      let mx = 0; for (let i = 0; i < 2000; i++) mx = Math.max(mx, Math.abs(noise(fib(i, 2000))));
      for (const b of cand) b.a /= mx || 1;                   // «вздутие» не больше amp
      let cx = 0, cy = 0, sw = 0;                            // центр площади оболочки
      for (let i = 0; i < 3000; i++) {
        const x = fib(i, 3000), r0 = rho(x), wt = (r0 * r0) / Math.max(0.2, dot(normalAt(x), x));
        cx += wt * x[0] * r0; cy += wt * x[1] * r0; sw += wt;
      }
      const off = Math.hypot(cx, cy) / sw;
      // зазор до ламп при этой форме (ширина приведена к заданной)
      let w0 = 0;
      for (let i = 0; i < 2000; i++) { const X = surf(fib(i, 2000)); w0 = Math.max(w0, Math.hypot(X[0], X[1])); }
      const k0 = kS; kS = Rx / w0; const g = lampGap(0); kS = k0;
      const score = off + (g < (P.lamp_min_gap ?? 40) ? 1000 + (P.lamp_min_gap ?? 40) - g : 0);
      if (!best || score < best.score) best = { off, cand, score };
    }
    bumps = best.cand;
    // добиваем центр площади на ось: подбираем наклон профиля (у полюса форма не меняется)
    const centroid = () => {
      let cx = 0, cy = 0, sw = 0;
      for (let i = 0; i < 3000; i++) {
        const x = fib(i, 3000), r0 = rho(x), wt = (r0 * r0) / Math.max(0.2, dot(normalAt(x), x));
        cx += wt * x[0] * r0; cy += wt * x[1] * r0; sw += wt;
      }
      return [cx / sw, cy / sw];
    };
    let [ox, oy] = centroid();
    const probe = 0.02; kvx = probe; const gx = (centroid()[0] - ox) / probe; kvx = 0; shapeGain = gx;
    for (let it = 0; it < 6 && Math.hypot(ox, oy) > 0.3; it++) { kvx -= ox / gx; kvy -= oy / gx; [ox, oy] = centroid(); }
    // габарит — как задано: ширина = диаметр, высота = height_ratio × диаметр (по средней поверхности ± T/2)
    for (let it = 0; it < 4; it++) {
      let w0 = 0, zl = 1e9, zh = -1e9;
      for (let i = 0; i < 6000; i++) { const x = fib(i, 6000), X = surf(x); w0 = Math.max(w0, Math.hypot(X[0], X[1])); zl = Math.min(zl, X[2]); zh = Math.max(zh, X[2]); }
      Rz *= (P.height_ratio * P.diameter - T) / (zh - zl);
      buildProfile();
      kS *= Rx / w0;
    }
    samples = sampleShape();
  }

  // ── 1. точки-центры ячеек ──
  const north: V3 = [0, 0, 1];
  // число ячеек от диаметра: ячейка того же размера, что у одобренного шара (cell_ref) — рисунок одинаковый
  // (для других форм — по площади оболочки: ячейка того же размера в мм)
  // узор: "round" — круглые ячейки (одобренный шар), "drops" — вытянутые по меридиану «капли» (мастер 2026-09-27)
  // узоры: круглые · «капли» (вытянуты по меридиану) · «ленты» (вытянуты по кругу — для «Волны», лист 02)
  const drops = P.pattern === 'drops', bands = P.pattern === 'bands';
  const PAT = drops ? P.drops : bands ? P.bands : null;
  const stretch = PAT ? PAT.stretch : P.cell_stretch ?? 1;
  const refCells = PAT ? PAT.cell_ref_cells : P.cell_ref.cells;
  const refRm = P.cell_ref.diameter / 2 - T / 2, cellLen = refRm * Math.sqrt((4 * Math.PI) / refCells);
  const area = general ? samples.reduce((a0, q) => a0 + q.wt, 0) * ((4 * Math.PI) / NSS) : 0;
  // где поверхность гнётся круто (край овала) — ячейка мельче: обнимает не больше rim_cell_turn_deg изгиба
  // (мастер 2026-09-27: «можно по мельче по краю»); где пологая — размер как у шара
  const turn = ((P.rim_cell_turn_deg ?? 45) * Math.PI) / 180;
  const hAt = (k: number) => (P.rim_cell_turn_deg == null ? cellLen : Math.min(cellLen, turn / Math.max(k, 1e-9)));   // null — выключено
  const dens = samples.map((q) => (cellLen / hAt(q.k)) ** 4);  // плотность для выравнивания (размер ~ плотность^-1/4)
  const nCells = general ? Math.round(samples.reduce((a0, q) => a0 + q.wt / hAt(q.k) ** 2, 0) * ((4 * Math.PI) / NSS))
    : P.cells_auto ? Math.round(refCells * (P.diameter / P.cell_ref.diameter) ** 2) : P.cells;
  const cellAng = general ? cellLen / rho([0, 0, 1]) : Math.sqrt((4 * Math.PI) / nCells);   // у полюса
  const ringAng = cellAng * 0.62;
  const poleClear = cellAng * 0.95;
  const seeds: V3[] = [];
  const fixed: boolean[] = [];
  const ringRot = rand() * 2 * Math.PI;
  for (let k = 0; k < P.pole_ribs; k++) {
    const phi = ringRot + (2 * Math.PI * k) / P.pole_ribs;
    seeds.push([Math.sin(ringAng) * Math.cos(phi), Math.sin(ringAng) * Math.sin(phi), Math.cos(ringAng)]);
    fixed.push(true);
  }
  // нижняя площадка (верхний шар «Двойного»): такое же кольцо точек у нижнего полюса — рёбра сходятся лучами
  const botSeat = !!P.bottom_seat;
  if (botSeat) for (let k = 0; k < P.pole_ribs; k++) {
    const phi = ringRot + (2 * Math.PI * (k + 0.5)) / P.pole_ribs;
    seeds.push([Math.sin(ringAng) * Math.cos(phi), Math.sin(ringAng) * Math.sin(phi), -Math.cos(ringAng)]);
    fixed.push(true);
  }
  const nFixed = seeds.length;
  const inPole = (p: V3) => Math.acos(Math.max(-1, Math.min(1, p[2]))) < poleClear || (botSeat && Math.acos(Math.max(-1, Math.min(1, -p[2]))) < poleClear);
  const nFib = Math.round(nCells * 1.02);
  for (let i = 0; i < nFib && seeds.length < nCells; i++) {
    const z = 1 - (2 * (i + 0.5)) / nFib, r = Math.sqrt(1 - z * z), phi = i * golden;
    let p: V3 = [r * Math.cos(phi), r * Math.sin(phi), z];
    const [e1, e2] = tangentBasis(p);
    const j = cellAng * P.cell_jitter;
    p = norm(add(p, add(mul(e1, (rand() - 0.5) * j), mul(e2, (rand() - 0.5) * j))));
    if (inPole(p)) continue;
    seeds.push(p); fixed.push(false);
  }

  if (general && stretch === 1) {
    seeds.length = nFixed; fixed.length = nFixed;
    const cand = samples.map((q, i) => ({ i, w: inPole(q.x) ? 0 : q.wt / hAt(q.k) ** 2 }));
    const tot = cand.reduce((a0, c) => a0 + c.w, 0), need = nCells - nFixed, step = tot / need;
    let acc = step * rand(), sum = 0;
    for (const c of cand) { sum += c.w; while (sum >= acc && seeds.length < nCells) { seeds.push(samples[c.i].x); fixed.push(false); acc += step; } }
  }

  // ── 2. Вороной на сфере ──
  function voronoi(pts: V3[]) {
    const hull = Manifold.hull(pts.map((p) => mul(p, 1000)) as any);
    const mesh = hull.getMesh();
    const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
    const idx: number[] = [];
    for (let v = 0; v < vp.length / np; v++) {
      const q: V3 = [vp[v * np] / 1000, vp[v * np + 1] / 1000, vp[v * np + 2] / 1000];
      let best = 0, bd = 1e9;
      for (let s = 0; s < pts.length; s++) { const d = len(sub(q, pts[s])); if (d < bd) { bd = d; best = s; } }
      idx.push(best);
    }
    const tris: [number, number, number][] = [];
    const vv: V3[] = [];
    for (let t = 0; t < tv.length; t += 3) {
      const a = idx[tv[t]], b = idx[tv[t + 1]], c = idx[tv[t + 2]];
      let n = norm(cross(sub(pts[b], pts[a]), sub(pts[c], pts[a])));
      if (dot(n, pts[a]) < 0) n = mul(n, -1);
      tris.push([a, b, c]); vv.push(n);
    }
    hull.delete();
    const incident: number[][] = pts.map(() => []);
    tris.forEach((t, i) => t.forEach((s) => incident[s].push(i)));
    return { tris, vv, incident };
  }

  // «капли»: старт — пояса по широте, вдоль оси шаг в stretch раз больше, чем поперёк (от круглой раскладки
  // выравнивание само не перестроится — застревает рядом с ней). Шаг подбирается под число ячеек.
  // Ось: cell_stretch_deg 0 — по меридиану, 90 — по параллели. У полюсов ячейки сходятся клиньями.
  const psi = ((bands ? 90 : P.cell_stretch_deg ?? 0) * Math.PI) / 180;
  if (stretch !== 1) {
    const along = Math.abs(Math.cos(psi)) >= Math.abs(Math.sin(psi));      // ось ближе к меридиану
    const rows = (sp: number) => {
      const rr = rng(P.seed * 31 + 7), out: V3[] = [];
      const dv = along ? stretch * sp : sp, dh = along ? sp : stretch * sp;   // между поясами / в поясе
      for (let th = ringAng + dv, j = 0; th < Math.PI - 0.5 * dv - (botSeat ? ringAng : 0); th += dv, j++) {
        const n = Math.max(3, Math.round((2 * Math.PI * Math.sin(th)) / dh));
        const off = rr();                                       // сдвиг пояса случайный — без сплошных колец
        for (let i = 0; i < n; i++) {
          const phi = ringRot + ((i + off + (rr() - 0.5) * 0.3) * 2 * Math.PI) / n, t = th + (rr() - 0.5) * 0.45 * dv;
          out.push([Math.sin(t) * Math.cos(phi), Math.sin(t) * Math.sin(phi), Math.cos(t)]);
        }
      }
      if (!botSeat) out.push([0, 0, -1]);                    // нижний полюс (если там нет площадки)
      return out;
    };
    let lo = 0.02, hi = 3;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (nFixed + rows(mid).length > nCells) lo = mid; else hi = mid; }
    seeds.length = nFixed; fixed.length = nFixed;
    for (const p of rows(hi)) { seeds.push(p); fixed.push(false); }
  }
  if (general) {
    // ячейки выравниваются по настоящей поверхности (расстояния в мм, вес — площадь);
    // у «капель» расстояние вдоль меридиана поверхности считается в stretch раз короче
    const fr = samples.map((q) => {
      let a = sub([0, 0, 1], mul(q.n, q.n[2]));
      a = len(a) < 1e-6 ? tangentBasis(q.n)[0] : norm(a);
      const b0 = cross(q.n, a);
      const ax = add(mul(a, Math.cos(psi)), mul(b0, Math.sin(psi)));
      return { a: ax, b: cross(q.n, ax) };
    });
    const iters = stretch !== 1 ? PAT?.relax_iterations ?? 12 : P.relax_iterations_shape ?? 15;
    for (let it = 0; it < iters; it++) {
      const SP = seeds.map(surf);
      const sum = seeds.map(() => [0, 0, 0] as V3), cnt = new Int32Array(seeds.length);
      samples.forEach((q, qi) => {
        const { a, b } = fr[qi], n = q.n;
        let bi = 0, bd = Infinity;
        for (let k = 0; k < SP.length; k++) {
          const dx = SP[k][0] - q.X[0], dy = SP[k][1] - q.X[1], dz = SP[k][2] - q.X[2];
          const da = (dx * a[0] + dy * a[1] + dz * a[2]) / stretch, db = dx * b[0] + dy * b[1] + dz * b[2], dn = dx * n[0] + dy * n[1] + dz * n[2];
          const d = da * da + db * db + dn * dn;
          if (d < bd) { bd = d; bi = k; }
        }
        sum[bi] = add(sum[bi], mul(q.X, q.wt * dens[qi])); cnt[bi]++;
      });
      for (let k = 0; k < seeds.length; k++) {
        if (fixed[k] || !cnt[k]) continue;
        const qd = norm(sum[k]);
        if (!inPole(qd)) seeds[k] = qd;
      }
    }
  } else if (stretch === 1) {
    // круглые ячейки: выравнивание Ллойда по обычному расстоянию
    for (let it = 0; it < P.relax_iterations; it++) {
      const { vv, incident } = voronoi(seeds);
      for (let k = 0; k < seeds.length; k++) {
        if (fixed[k]) continue;
        let c: V3 = [0, 0, 0];
        incident[k].forEach((t) => (c = add(c, vv[t])));
        const q = norm(c);
        if (!inPole(q)) seeds[k] = q;
      }
    }
  } else {
    // «капли» на шаре: выравнивание по сфере, вдоль оси расстояние в stretch раз короче
    const NS = P.stretch_samples ?? 16000;
    const smp: number[] = [];                                // точка, ось, поперёк, степень вытяжки
    for (let i = 0; i < NS; i++) {
      const x = fib(i, NS), r = Math.hypot(x[0], x[1]), phi = Math.atan2(x[1], x[0]);
      const east: V3 = r > 1e-6 ? [-Math.sin(phi), Math.cos(phi), 0] : [1, 0, 0];
      const nrth = cross(x, east);
      const ax = add(mul(nrth, Math.cos(psi)), mul(east, Math.sin(psi))), bx = cross(x, ax);
      smp.push(...x, ...ax, ...bx, stretch);
    }
    for (let it = 0; it < (PAT ? PAT.relax_iterations : P.relax_iterations_stretch); it++) {
      const sum = seeds.map(() => [0, 0, 0] as V3), cnt = new Int32Array(seeds.length);
      for (let o = 0; o < smp.length; o += 10) {
        let best = 0, bd = Infinity;
        for (let k = 0; k < seeds.length; k++) {
          const dx = seeds[k][0] - smp[o], dy = seeds[k][1] - smp[o + 1], dz = seeds[k][2] - smp[o + 2];
          const a = (dx * smp[o + 3] + dy * smp[o + 4] + dz * smp[o + 5]) / smp[o + 9];
          const b = dx * smp[o + 6] + dy * smp[o + 7] + dz * smp[o + 8];
          const n = dx * smp[o] + dy * smp[o + 1] + dz * smp[o + 2];
          const d = a * a + b * b + n * n;
          if (d < bd) { bd = d; best = k; }
        }
        sum[best] = add(sum[best], [smp[o], smp[o + 1], smp[o + 2]]); cnt[best]++;
      }
      for (let k = 0; k < seeds.length; k++) {
        if (fixed[k] || !cnt[k]) continue;
        const q = norm(sum[k]);
        if (!inPole(q)) seeds[k] = q;
      }
    }
  }
  const { tris, vv, incident } = voronoi(seeds);

  // ── 3. дыры ячеек (общие для обоих видов и для нарезки) ──
  // гранёный: многоугольник в гномонической проекции на радиусе R (как вырезали раньше);
  // плавный: в азимутальной равнопромежуточной на Rm — расстояния на сфере почти без искажений.
  if (P.rib_mid * (Rin / R) < P.min_section) warn.push(`ребро на внутренней стороне ${(P.rib_mid * Rin / R).toFixed(1)} мм < ${P.min_section}`);
  if (T < P.min_section) warn.push(`глубина ребра ${T} мм < ${P.min_section}`);
  type Cell = { s: V3; e1: V3; e2: V3; core: V2[]; flat: Float64Array; fil: number; S?: V3; f1?: V3; f2?: V3; nc?: boolean };
  // другие формы: точка поверхности → касательная плоскость в центре ячейки, длина = хорда (≈ по поверхности)
  const planeG = (c: { S?: V3; f1?: V3; f2?: V3 }, Q: V3): V2 => {
    const d = sub(Q, c.S!), x = dot(d, c.f1!), y = dot(d, c.f2!), h = Math.hypot(x, y), L0 = len(d);
    return h > 1e-9 ? [(x * L0) / h, (y * L0) / h] : [0, 0];
  };
  const gnomonic = style === 'facet';
  const plane = (x: number, y: number, z: number): V2 => {
    if (gnomonic) return z > 0.2 ? [(R * x) / z, (R * y) / z] : [1e6, 1e6];
    const h = Math.hypot(x, y) || 1e-12, th = Math.atan2(h, z);
    return [(Rm * th * x) / h, (Rm * th * y) / h];
  };
  let skipped = 0;
  const buildCells = (): (Cell | null)[] => seeds.map((s, i) => {
    const [e1, e2] = tangentBasis(s);
    const S0 = general ? surf(s) : undefined, nS = general ? normalAt(s) : undefined;
    const [f1, f2] = general ? tangentBasis(nS!) : [e1, e2];
    const cf = { S: S0, f1, f2 };
    // углы ячейки по кругу; у плавного вида сторона идёт по настоящей дуге (на развёртке она выгнута —
    // по хорде длинное ребро выходило толще заданного на ~2 мм)
    const vs = incident[i].map((t) => vv[t]);
    const az = (w: V3) => Math.atan2(dot(w, e2), dot(w, e1));
    vs.sort((a, b) => az(a) - az(b));
    const pts2: V2[] = [];
    for (let j = 0; j < vs.length; j++) {
      const a = vs[j], b = vs[(j + 1) % vs.length];
      const n = gnomonic ? 1 : Math.max(1, Math.ceil(angle(a, b) / 0.02));
      for (let k = 0; k < n; k++) { const w = slerp(a, b, k / n); pts2.push(general ? planeG(cf, surf(w)) : plane(dot(w, e1), dot(w, e2), dot(w, s))); }
    }
    const poly: V2[] = [];
    for (const p of pts2) if (!poly.length || Math.hypot(p[0] - poly[poly.length - 1][0], p[1] - poly[poly.length - 1][1]) > 0.01) poly.push(p);
    while (poly.length > 1 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) <= 0.01) poly.pop();
    if (poly.length < 3 || area2(poly) <= 0) { skipped++; return null; }
    if (general) {
      // изогнутая форма: контур ячейки на развёртке бывает вогнутым — отступ через CrossSection
      // (работает с любым контуром; прежний отступ полуплоскостями годился только для выпуклых
      // и на вогнутых съедал дыру — рёбра выходили 13–14.6 мм вместо 11)
      const cs = new wasm.CrossSection([poly], 'Positive');
      const alive = (d: number) => { const o = cs.offset(-d, 'Miter', 4); const a = o.area(); o.delete(); return a > 1e-3; };
      let lo = 0, hi = 500;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (alive(mid)) lo = mid; else hi = mid; }
      const avail = lo - half;
      if (avail < 3) { cs.delete(); skipped++; return null; }
      const fil = Math.min(P.hole_round_ratio * avail, P.hole_fillet_max_mm ?? Infinity);   // потолок скругления — худее перепонки (мастер: «без болванок»)
      const co = cs.offset(-(half + fil), 'Miter', 4), polys: V2[][] = co.toPolygons() as any;
      co.delete(); cs.delete();
      let big: V2[] = [];
      for (const pg of polys) if (Math.abs(area2(pg)) > Math.abs(area2(big.length > 2 ? big : [[0, 0], [0, 0], [0, 0]]))) big = pg;
      if (big.length < 3) { skipped++; return null; }
      if (area2(big) < 0) big = big.slice().reverse();
      return { s, e1, e2, core: big, flat: Float64Array.from(big.flat()), fil, nc: true, ...cf };
    }
    let fil: number;
    if (gnomonic) fil = P.hole_roundness;
    else {
      const avail = inradius(poly) - half;
      if (avail < 3) { skipped++; return null; }
      fil = P.hole_round_ratio * avail;                         // шар — одобренный, без потолка
    }
    const core = inset(poly, half + fil);
    if (core.length < 3 || Math.abs(area2(core)) < 1) { skipped++; return null; }
    return { s, e1, e2, core, flat: Float64Array.from(core.flat()), fil, ...cf };
  });
  let cells = buildCells();

  // расстояние (мм) от направления w до дыры ячейки c; < 0 — внутри дыры
  const sdHole = (c: Cell | null, wx: number, wy: number, wz: number) => {
    if (!c) return 1e3;
    const [qx, qy] = general ? planeG(c, surf([wx, wy, wz])) : plane(wx * c.e1[0] + wy * c.e1[1] + wz * c.e1[2], wx * c.e2[0] + wy * c.e2[1] + wz * c.e2[2], wx * c.s[0] + wy * c.s[1] + wz * c.s[2]);
    const k = c.flat, n = k.length / 2;
    let dmin = Infinity, inside = true, cross = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = k[2 * i], ay = k[2 * i + 1], ex = k[2 * j] - ax, ey = k[2 * j + 1] - ay;
      const px = qx - ax, py = qy - ay;
      if (c.nc) { const by = ay + ey; if ((ay > qy) !== (by > qy) && qx < ax + (ex * (qy - ay)) / ey) cross ^= 1; }
      else if (ex * py - ey * px < 0) inside = false;         // справа от ребра (обход против часовой) — снаружи
      let t = (px * ex + py * ey) / (ex * ex + ey * ey);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - ex * t, py - ey * t);
      if (d < dmin) dmin = d;
    }
    if (c.nc) inside = cross === 1;
    return (inside ? -dmin : dmin) - c.fil;
  };

  // расстояние (мм) от направления w до ближайшей дыры: своя ячейка и соседи
  const nb: Set<number>[] = seeds.map((_, i) => new Set([i]));
  for (const [a, b, c] of tris) { nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const mkNb = () => nb.map((st) => [...st].map((j) => cells[j]).filter((c): c is Cell => !!c));
  let nbList = mkNb();
  const sx = Float64Array.from(seeds.map((s) => s[0])), sy = Float64Array.from(seeds.map((s) => s[1])), sz = Float64Array.from(seeds.map((s) => s[2]));
  const metalU = (wx: number, wy: number, wz: number) => {
    let best = 0, bd = -2;
    for (let i = 0; i < sx.length; i++) { const d = wx * sx[i] + wy * sy[i] + wz * sz[i]; if (d > bd) { bd = d; best = i; } }
    let u = 1e3;
    for (const c of nbList[best]) { const d = sdHole(c, wx, wy, wz); if (d < u) u = d; }
    return u;
  };
  // радиус скругления кромки: у плавного — полукруг, у гранёного кромка острая
  const re = gnomonic ? 0 : Math.min(P.edge_round ?? T / 2, T / 2);

  // другие формы: центр тяжести МЕТАЛЛА на ось — считаем, где металл (по точкам оболочки и по её
  // толщине), подправляем наклон профиля, пересобираем ячейки; повторяем
  if (general) {
    const metalCentroid = () => {
      let cx = 0, cy = 0, sw = 0;
      for (let i = 0; i < samples.length; i += 2) {
        const x = samples[i].x, r0 = rho(x), wt = (r0 * r0) / Math.max(0.2, dot(normalAt(x), x));
        const u = metalU(x[0], x[1], x[2]);
        let f = 0;
        for (const v of [-0.4, -0.2, 0, 0.2, 0.4]) {             // доли толщины
          const ax = re - u, ay = Math.abs(v * T) - (T / 2 - re);
          if (re - (Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0)) > 0) f += 0.2;
        }
        cx += wt * f * x[0] * r0; cy += wt * f * x[1] * r0; sw += wt * f;
      }
      return [cx / sw, cy / sw];
    };
    for (let it = 0; it < 4; it++) {
      const [mx, my] = metalCentroid();
      if (Math.hypot(mx, my) < 0.8) break;
      kvx -= mx / shapeGain; kvy -= my / shapeGain;
      skipped = 0; cells = buildCells(); nbList = mkNb();
      for (let i = 0; i < samples.length; i++) samples[i] = sampleAt(samples[i].x);
    }
    // наклон чуть меняет ширину — общий масштаб обратно на заданную (центр тяжести от этого не сдвигается)
    let w0 = 0;
    for (let i = 0; i < 6000; i++) { const X = surf(fib(i, 6000)); w0 = Math.max(w0, Math.hypot(X[0], X[1])); }
    kS *= Rx / w0;
    skipped = 0; cells = buildCells(); nbList = mkNb();
  }
  if (skipped) warn.push(`${skipped} ячеек слишком малы для дыры — остались сплошными`);

  // ── 4. тело решётки ──
  let body: any;
  const rTop = rho([0, 0, 1]);
  const seatBottom = rTop - T / 2 - 2, seatTop = rTop + T / 2;   // площадка на полюсе: на всю глубину оболочки + 2 мм вниз
  if (style === 'facet') {
    const cutters = cells.filter((c): c is Cell => !!c).map((c) => {
      const ring3 = roundOut(c.core, c.fil).map(([x, y]) => add(mul(c.s, R), add(mul(c.e1, x), mul(c.e2, y))));
      return Manifold.hull([...ring3.map((p) => mul(p, 1.08)), ...ring3.map((p) => mul(p, (Rin - 15) / R))] as any);
    });
    body = Manifold.sphere(R, P.sphere_segments).subtract(Manifold.sphere(Rin, P.sphere_segments)).subtract(Manifold.union(cutters));
    // гранёный вид: сглаживаем только грани сферы (smooth_angle 60), кромки дыр остаются чёткими — без ряби
    if (P.smooth) body = body.smoothOut(P.smooth_angle ?? 60).refineToLength(P.smooth_step ?? 4);
  } else {
    // сечение ребра — оболочка толщиной T с полукруглыми кромками радиуса re у края дыры;
    // мягкая перепонка в узле получается сама из формы дыр
    const c0 = T / 2 - re;
    // функция расстояния: > 0 внутри металла (соглашение manifold)
    const sdf = (p: V3) => {
      const r = Math.hypot(p[0], p[1], p[2]);
      const v = r - Rm;
      if (Math.abs(v) > T / 2 + 2) return T / 2 - Math.abs(v);
      const u = metalU(p[0] / r, p[1] / r, p[2] / r);      // расстояние от точки до ближайшей дыры
      const ax = re - u, ay = Math.abs(v) - c0;
      const sdStrip = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0);
      return re - sdStrip;
    };
    const sdfG = (p: V3) => {
      const r = Math.hypot(p[0], p[1], p[2]);
      if (r < 1) return -T;
      const w: V3 = [p[0] / r, p[1] / r, p[2] / r], rr = rho(w);
      const v = (r - rr) * dot(normalAt(w), w);              // смещение по нормали к поверхности
      if (Math.abs(v) > T / 2 + 2) return T / 2 - Math.abs(v);
      const u = metalU(w[0], w[1], w[2]);
      const ax = re - u, ay = Math.abs(v) - c0;
      const sdStrip = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) + Math.min(Math.max(ax, ay), 0);
      return re - sdStrip;
    };
    let bxy = R + 4, bz = R + 4;
    if (general) { bxy = 0; bz = 0; for (const q of samples) { bxy = Math.max(bxy, Math.hypot(q.X[0], q.X[1])); bz = Math.max(bz, Math.abs(q.X[2])); } bxy += T; bz += T; }
    body = Manifold.levelSet((general ? sdfG : sdf) as any, { min: [-bxy, -bxy, -bz], max: [bxy, bxy, bz] } as any, P.mesh_step ?? 2.5);
  }

  // фактические габариты решётки (до площадки): внешний — в паспорт, внутренний — для зазора ламп
  let innerR = 1e9, outerR = 0, maxXY = 0, zLo = 1e9, zHi = -1e9;
  {
    const m = body.getMesh(), np = m.numProp, vp = m.vertProperties;
    for (let o = 0; o < vp.length; o += np) {
      const r = Math.hypot(vp[o], vp[o + 1], vp[o + 2]);
      if (r < innerR) innerR = r;
      if (r > outerR) outerR = r;
      maxXY = Math.max(maxXY, Math.hypot(vp[o], vp[o + 1])); zLo = Math.min(zLo, vp[o + 2]); zHi = Math.max(zHi, vp[o + 2]);
    }
  }

  // ── 5. площадка на полюсе (плоская сверху и снизу) + отверстие под трубу ──
  const seatR = P.pole_seat_d / 2;
  body = body.subtract(Manifold.cylinder(60, seatR, seatR, 96).translate([0, 0, seatTop]));   // срезать всё выше посадки
  body = body.add(Manifold.cylinder(seatTop - seatBottom, seatR, seatR, 96).translate([0, 0, seatBottom]));
  if (botSeat) {                                              // зеркально внизу: плоско сверху и снизу, под шайбы
    const rBot = rho([0, 0, -1]), bOut = -(rBot + T / 2), bIn = -(rBot - T / 2 - 2);
    body = body.subtract(Manifold.cylinder(60, seatR, seatR, 96).translate([0, 0, bOut - 60]));
    body = body.add(Manifold.cylinder(bIn - bOut, seatR, seatR, 96).translate([0, 0, bOut]));
  }

  const massOf = (vol: number) => (vol / 1000) * P.brass_density_g_cm3 / 1000;
  const massFrame0 = massOf(body.volume());
  const tube = massFrame0 + P.accessories_kg > P.tube_switch_kg ? { name: 'M12, стенка 2 мм', od: 12 } : { name: 'M10×1', od: 10 };
  body = body.subtract(Manifold.cylinder(seatTop - seatBottom + 40, tube.od / 2 + 0.3, tube.od / 2 + 0.3, 48).translate([0, 0, seatBottom - 20]));
  if (botSeat) body = body.subtract(Manifold.cylinder(2 * seatTop + 80, tube.od / 2 + 0.3, tube.od / 2 + 0.3, 48).translate([0, 0, -seatTop - 40]));   // труба насквозь

  const massFrame = massOf(body.volume());
  // центр тяжести каркаса — от оси (люстра должна висеть ровно)
  let com = 0;
  {
    const m = body.getMesh(), np = m.numProp, vp = m.vertProperties, tv = m.triVerts;
    let V = 0, cx = 0, cy = 0;
    for (let t = 0; t < tv.length; t += 3) {
      const a = tv[t] * np, b = tv[t + 1] * np, c = tv[t + 2] * np;
      const v6 = vp[a] * (vp[b + 1] * vp[c + 2] - vp[b + 2] * vp[c + 1]) - vp[a + 1] * (vp[b] * vp[c + 2] - vp[b + 2] * vp[c]) + vp[a + 2] * (vp[b] * vp[c + 1] - vp[b + 1] * vp[c]);
      V += v6; cx += v6 * (vp[a] + vp[b] + vp[c]); cy += v6 * (vp[a + 1] + vp[b + 1] + vp[c + 1]);
    }
    com = Math.hypot(cx, cy) / (4 * V);
  }
  if (com > 5) warn.push(`центр тяжести в ${com.toFixed(1)} мм от оси`);
  const massTotal = massFrame + P.accessories_kg;
  const mount = massTotal > P.heavy_mount_kg ? 'усиленное (> 15 кг)' : 'обычное';

  // ── 6. лампы: кольцо центрального узла В ЦЕНТРЕ шара; ярусы вниз / прямо / вверх, до max_count ламп (мастер) ──
  pickLampSpec();
  const L = Lp;
  const tiers: { direction: string; count: number }[] = L.tiers ?? [{ direction: L.direction, count: L.count }];
  const armDeg = !single && tiers.some((t) => t.direction !== 'straight') ? pickAngle() : 0;
  if (!single && armDeg < L.arm_angle_deg && tiers.some((t) => t.direction !== 'straight'))
    warn.push(`угол гиба рожков уменьшен до ${armDeg}° (при ${L.arm_angle_deg}° лампы ближе ${P.lamp_min_gap ?? 40} мм к рёбрам)`);
  const lampCount = tiers.reduce((sN, t) => sN + t.count, 0);
  if (lampCount > L.max_count) warn.push(`ламп ${lampCount} — больше ${L.max_count} не ставим (мастер)`);
  const tierInfo = tiers.map((t) => {
    const sign = t.direction === 'up' ? 1 : t.direction === 'down' ? -1 : 0;
    const th = sign * (armDeg * Math.PI) / 180;
    // рожок — гнутая труба: прямо от кольца, дуга радиусом arm_bend_radius на угол th, прямо до патрона
    const rb = L.arm_bend_radius, arcL = rb * Math.abs(th), a = Math.max(0, (L.arm_length - arcL) / 2);
    const endR = L.ring_radius + a + rb * Math.sin(Math.abs(th)) + a * Math.cos(th);
    const endZ = Math.sign(th) * rb * (1 - Math.cos(th)) + a * Math.sin(th);
    const lampLen = L.socket_length + L.bulb_length;
    const reach = Math.hypot(endR + lampLen * Math.cos(th), endZ + lampLen * Math.sin(th)) + L.bulb_d / 2;
    const rc = endR + (L.socket_length + L.bulb_length / 2) * Math.cos(th);          // центры колб по кругу
    const between = t.count > 1 ? 2 * rc * Math.sin(Math.PI / t.count) - L.bulb_d : Infinity;
    return { ...t, reach, between };
  });
  // зазор: от патрона и колбы (капсула Ø bulb_d) до внутренней поверхности, по каждой лампе
  const gap = lampGap(armDeg);
  if (gap < (P.lamp_min_gap ?? 40)) warn.push(`лампы близко к рёбрам: зазор ${gap.toFixed(0)} мм`);
  for (const t of tierInfo) if (t.between < 10) warn.push(`ярус «${t.direction}»: ${t.count} ламп не расходятся по кругу — между колбами ${t.between.toFixed(0)} мм`);
  const dirRu: Record<string, string> = { down: 'вниз', straight: 'прямо', up: 'вверх' };
  const lampsText = single
    ? `1 шт.: по центру на оси, без кольца, патрон на трубе через переходник, ${L.socket_name}/${L.bulb_name}`
    : `${lampCount} шт.: ` + tierInfo.map((t) => `${t.count} ${dirRu[t.direction] ?? t.direction}`).join(', ') + `, ${L.socket_name}/${L.bulb_name}, рожок ${L.arm_length} мм, кольцо Ø${2 * L.ring_radius}, гиб рожков ${armDeg}°`;

  const tag = `cell-${style}-${P.shape}${drops ? '-drops' : bands ? '-bands' : ''}-${P.diameter}-seed${P.seed}`;
  // для нарезки на панели (цех): узлы и рёбра решётки + функции формы
  const panelCtx = () => {
    // узлы решётки = вершины Вороного (совпадающие у полюса — склеить), рёбра — между соседними треугольниками
    const nodes: V3[] = [], nodeOf: number[] = [];
    for (const w of vv) {
      let found = nodes.findIndex((n) => angle(n, w) < 1e-4);
      if (found < 0) { found = nodes.length; nodes.push(w); }
      nodeOf.push(found);
    }
    const emap = new Map<string, number[]>();
    tris.forEach((t, i) => {
      for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!emap.has(key)) emap.set(key, []);
        emap.get(key)!.push(i);
      }
    });
    const edges: any[] = [];
    for (const [key, ts] of emap) {
      if (ts.length !== 2 || nodeOf[ts[0]] === nodeOf[ts[1]]) continue;
      const [cA, cB] = key.split('-').map(Number);
      edges.push({ n1: nodeOf[ts[0]], n2: nodeOf[ts[1]], cA, cB });
    }
    const width = (e: any, w: V3) => sdHole(cells[e.cA], w[0], w[1], w[2]) + sdHole(cells[e.cB], w[0], w[1], w[2]);
    return { Manifold, P, R, Rm, Rin, T, re, seatR, nodes, edges, width, metalU, body,
      general, surf: general ? surf : undefined, nrm: general ? normalAt : undefined, area, bottomSeat: botSeat };
  };
  const passport = {
    изделие: tag, семейство: P.family, вид: style === 'facet' ? 'гранёный' : 'плавный', узор: drops ? '«капли» (вытянутые)' : bands ? '«ленты» (вытянуты по кругу)' : 'круглые ячейки', зерно: P.seed, форма: P.shape,
    'диаметр, мм': P.diameter, 'габарит по факту, мм': general ? `Ø${Math.round(2 * maxXY)} × высота ${Math.round(zHi - zLo)}` : Math.round(2 * outerR), ячеек: seeds.length,
    'центр тяжести от оси, мм': +com.toFixed(1),
    'ребро, мм': style === 'facet'
      ? `${P.rib_mid} × глубина ${T}, сечение прямоугольное, дыры скруглены R${P.hole_roundness}`
      : `${P.rib_mid} в самом узком месте × глубина ${T}, кромки полукруглые R${Math.min(P.edge_round ?? T / 2, T / 2)}, округлость дыр ${Math.round(P.hole_round_ratio * 100)}%`,
    'масса каркаса, кг': +massFrame.toFixed(2), 'масса в сборе, кг (оснащение условно)': +massTotal.toFixed(2),
    'труба центрального узла': tube.name, крепление: mount,
    лампы: lampsText, 'зазор ламп до рёбер, мм': Math.round(gap), 'площадка на полюсе, мм': `Ø${P.pole_seat_d} под шайбу Ø${P.washer_d}, высота ${Math.round(seatTop - seatBottom)}`,
  };
  return { body, passport, tag, warn, massOf, panelCtx, L: { ...L, single }, armDeg, t0 };
}
