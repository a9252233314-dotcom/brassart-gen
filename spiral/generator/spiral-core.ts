/**
 * Brass Art — ядро генератора СПИРАЛЬ: лента из латунного листа спиралью-воронкой вокруг центральной колонны.
 * Лента «на ребре»: ширина по вертикали, путь — плоская спираль с уменьшающимся книзу радиусом (поверхность развёртывается,
 * гнётся из листа, как у ОРБИТЫ). Рожки: резьба в колонне, конец входит в литую пластину ОРБИТЫ на ленте, свеча — на рожке.
 * Без файлов: то же ядро пойдёт на сайт. Единицы — мм, Z вверх, 0 — верхняя кромка ленты.
 */
type V3 = [number, number, number];

export function build(P: any, wasm: any) {
  const { Manifold, Mesh, CrossSection } = wasm;
  const B = P.band, CO = P.column, AR = P.arms, IN = P.insert, LP = P.lamp, warn: string[] = [];
  const kg = (vol: number) => vol * P.brass_density_g_cm3 / 1e6;
  const w = B.width, t = B.wall, N = B.turns, TH = 2 * Math.PI * N;
  const Rtop = P.diameter / 2 - t / 2, Rbot = Rtop * B.r_bottom_frac;
  const LH = LP.socket_h + LP.bulb_h;
  const kD = P.diameter / (P.base_diameter || 650), Hgt = P.height * kD;   // ручка сайта — ширина; высота растёт вместе с ней
  const Hs = Hgt - w - 40;                                         // высота хода спирали (лампы верхнего рожка выше ленты)
  // путь по углу θ: радиус и высота центра ленты
  const rOf = (th: number) => { const u = th / TH; return Rtop - (Rtop - Rbot) * Math.pow(u, B.radius_ease); };
  const zOf = (th: number) => -w / 2 - Hs * th / TH;
  const pt = (th: number): V3 => [rOf(th) * Math.cos(th), rOf(th) * Math.sin(th), zOf(th)];
  // длина по плану (развёртка — по ней) и обратное: θ по длине
  const NS = 4000, sArr = new Float64Array(NS + 1);
  for (let i = 1; i <= NS; i++) {
    const a = pt(TH * (i - 1) / NS), b = pt(TH * i / NS);
    sArr[i] = sArr[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const Lplan = sArr[NS];
  const thOfS = (s: number) => {
    let lo = 0, hi = NS;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sArr[m] < s) lo = m; else hi = m; }
    const f = (s - sArr[lo]) / Math.max(1e-9, sArr[hi] - sArr[lo]);
    return TH * (lo + f) / NS;
  };
  // горизонтальная нормаль к ленте (к оси) в точке θ
  const frame = (th: number) => {
    const e = 1e-4, a = pt(th - e), b = pt(th + e);
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty);
    const T: V3 = [tx / l, ty / l, 0];
    let nI: V3 = [-T[1], T[0], 0];                                      // одна из нормалей; к оси — где ближе к центру
    const c = pt(th);
    if (nI[0] * c[0] + nI[1] * c[1] > 0) nI = [-nI[0], -nI[1], 0];
    return { c, T, nI };
  };

  // ── лента: прямоугольник ширина × толщина вдоль пути ──
  const n = Math.ceil(Lplan / B.step_mm) + 1, verts: number[] = [], tri: number[] = [];
  for (let j = 0; j < n; j++) {
    const th = thOfS(Lplan * j / (n - 1)), F = frame(th);
    for (const [dz, dn] of [[-w / 2, -t / 2], [-w / 2, t / 2], [w / 2, t / 2], [w / 2, -t / 2]])
      verts.push(F.c[0] + F.nI[0] * dn, F.c[1] + F.nI[1] * dn, F.c[2] + dz);
  }
  for (let j = 0; j < n - 1; j++) for (let k = 0; k < 4; k++) {
    const a = j * 4 + k, b = j * 4 + (k + 1) % 4, c = (j + 1) * 4 + (k + 1) % 4, d = (j + 1) * 4 + k;
    tri.push(a, b, c, a, c, d);
  }
  tri.push(0, 2, 1, 0, 3, 2); const L4 = (n - 1) * 4; tri.push(L4, L4 + 1, L4 + 2, L4, L4 + 2, L4 + 3);
  const mk = () => new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tri) }));
  let band: any;
  try { band = mk(); if (band.volume() < 0) throw 0; } catch (e) {
    for (let i = 0; i < tri.length; i += 3) { const x = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = x; }
    band = mk();
  }

  // ── колонна и штанга ──
  const zTopCol = 0 + CO.cap_h, zBotCol = zOf(TH) - w / 2;
  const column = Manifold.cylinder(zTopCol - zBotCol, CO.d / 2, CO.d / 2, 48).translate([0, 0, zBotCol])
    .subtract(Manifold.cylinder(zTopCol - zBotCol - 2 * CO.wall, CO.d / 2 - CO.wall, CO.d / 2 - CO.wall, 48).translate([0, 0, zBotCol + CO.wall]));
  const zCeil = zTopCol + P.rod.length;
  const rod = Manifold.cylinder(zCeil - zTopCol + 5, P.rod.d / 2, P.rod.d / 2, 24).translate([0, 0, zTopCol - 5]);
  const cup = Manifold.cylinder(P.rod.cup_h, P.rod.cup_d / 2 * 0.8, P.rod.cup_d / 2, 64).translate([0, 0, zCeil - P.rod.cup_h]);
  const finial = Manifold.union(Manifold.cylinder(14, CO.d / 2 * 0.6, CO.d / 2, 40).translate([0, 0, zBotCol - 14]),
    Manifold.sphere(CO.d / 2 * 0.6, 32).scale([1, 1, 0.8]).translate([0, 0, zBotCol - 14]));

  // ── пластина ОРБИТЫ на внутренней стороне ленты: горка поперёк ленты, длина по ленте IN.len ──
  const insertAt = (th: number) => {
    const F = frame(th), L = IN.len, pts: [number, number][] = [], k = 24;
    for (let i = 0; i <= k; i++) { const x = -L / 2 + L * i / k; pts.push([x, IN.h * (1 + Math.cos(2 * Math.PI * x / L)) / 2 + 0.01]); }
    const cs = new CrossSection([[[-L / 2, 0], [L / 2, 0], ...pts.reverse()]], 'Positive');
    const ex = cs.extrude(IN.w).translate([0, 0, -IN.w / 2]);           // X — вдоль ленты, Y — от ленты к оси, Z — по вертикали
    const o: V3 = [F.c[0] + F.nI[0] * t / 2, F.c[1] + F.nI[1] * t / 2, F.c[2]];
    const M = [F.T[0], F.T[1], 0, 0, F.nI[0], F.nI[1], 0, 0, 0, 0, 1, 0, o[0], o[1], o[2], 1];
    // правая тройка: T × nI = ±Z; если левая — зеркалим по Z (горка симметрична)
    const cz = F.T[0] * F.nI[1] - F.T[1] * F.nI[0];
    if (cz < 0) M[10] = -1;
    return ex.transform(M);
  };

  // ── рожки со свечами: равномерно по длине ленты ──
  const arms: any[] = [], inserts: any[] = [], lamps: { socket: any; bulb: any; at: V3 }[] = [], info: any[] = [];
  let mx = 0, my = 0, mm = 0;
  for (let k = 0; k < AR.count; k++) {
    const s = Lplan * (k + 0.5) / AR.count, th = thOfS(s), F = frame(th), r = rOf(th), ux = Math.cos(th), uy = Math.sin(th);
    inserts.push(insertAt(th));
    // рожок: горизонтально от стенки колонны по радиусу до пластины
    const r0 = CO.d / 2 - 1, r1 = r - t / 2 - IN.h + 2, z = F.c[2], len = r1 - r0;
    const arm = Manifold.cylinder(len, AR.d / 2, AR.d / 2, 20).rotate([0, 90, 0]).translate([r0, 0, z]).rotate([0, 0, th * 180 / Math.PI]);
    arms.push(arm);
    // свеча на рожке, в lamp_inset от ленты
    const rl = r - t / 2 - AR.lamp_inset, rb = LP.bulb_d / 2;
    if (rl - LP.socket_d / 2 < CO.d / 2 + 10) warn.push(`рожок ${k + 1}: свече тесно у колонны (виток узкий)`);
    const lx = rl * ux, ly = rl * uy, zs = z + AR.d / 2 - 1;
    const socket = Manifold.cylinder(LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 32).translate([lx, ly, zs]);
    const bulb = Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 24), Manifold.sphere(rb, 24).translate([0, 0, LP.bulb_h - rb])).translate([lx, ly, zs + LP.socket_h]);
    lamps.push({ socket, bulb, at: [lx, ly, zs + LP.socket_h + LP.bulb_h / 2] });
    // зазор колбы до ленты: своя лента рядом и виток выше (по тому же направлению)
    const own = AR.lamp_inset - rb;
    let up = Infinity;
    for (let m = 1; m <= N; m++) {
      const th2 = th - 2 * Math.PI * m; if (th2 < 0) break;
      const r2 = rOf(th2), z2 = zOf(th2);
      const dr = Math.abs(r2 - rl) - rb - t / 2, dz = (z2 - w / 2) - (zs + LH);
      up = Math.min(up, Math.max(dr, dz));
    }
    const gap = Math.min(own, up);
    if (gap < LP.min_gap) warn.push(`рожок ${k + 1}: колба ближе ${LP.min_gap} мм к ленте (${gap.toFixed(0)} мм)`);
    info.push({ arm: k + 1, angle_deg: +((th * 180 / Math.PI) % 360).toFixed(0), z: +z.toFixed(0), r_band: +r.toFixed(0), arm_len: +len.toFixed(0), lamp_gap_mm: +gap.toFixed(0) });
  }

  // ── полосы листа и развёртки: путь по плану × высота; стык полос — под пластиной (как у ОРБИТЫ) ──
  const nStrips = Math.ceil(Lplan / B.strip_max_mm), strips: { sa: number; sb: number; outline: [number, number][]; holes: [number, number][] }[] = [];
  const armS = Array.from({ length: AR.count }, (_, k) => Lplan * (k + 0.5) / AR.count);
  const cuts = [0];
  for (let i = 1; i < nStrips; i++) {                                   // рез — у ближайшего рожка к равному делению
    const target = Lplan * i / nStrips;
    cuts.push(armS.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)));
  }
  cuts.push(Lplan);
  const spliceS = cuts.slice(1, -1);
  for (let i = 0; i < cuts.length - 1; i++) {
    const sa = Math.max(0, cuts[i] - (i ? IN.len / 2 : 0)), sb = Math.min(Lplan, cuts[i + 1] + (i < cuts.length - 2 ? IN.len / 2 : 0));
    const top: [number, number][] = [], bot: [number, number][] = [];
    for (let s = sa; s <= sb + 1e-6; s += 5) { const z = zOf(thOfS(s)); top.push([s - sa, z + w / 2]); bot.push([s - sa, z - w / 2]); }
    const holes: [number, number][] = armS.filter((s) => s >= sa && s <= sb).map((s) => [s - sa, zOf(thOfS(s))]);
    strips.push({ sa, sb, outline: [...top, ...bot.reverse()], holes });
  }

  // ── масса и центр тяжести ──
  const tube = (m: any, d: number, wl: number) => kg(m.volume() * (1 - ((d / 2 - wl) / (d / 2)) ** 2));
  const add = (m: any, kgv: number) => {                                // центр тяжести детали — по её коробке (для ленты — по пути ниже)
    const bb = m.boundingBox(); mx += kgv * (bb.min[0] + bb.max[0]) / 2; my += kgv * (bb.min[1] + bb.max[1]) / 2; mm += kgv;
  };
  const mBand = kg(band.volume());
  { let sx = 0, sy = 0; for (let i = 0; i < NS; i++) { const p = pt(TH * (i + 0.5) / NS), ds = sArr[i + 1] - sArr[i]; sx += p[0] * ds; sy += p[1] * ds; }
    mx += mBand * sx / Lplan; my += mBand * sy / Lplan; mm += mBand; }
  const mArms = arms.reduce((a, m) => { const v = tube(m, AR.d, AR.wall); add(m, v); return a + v; }, 0);
  const mIns = inserts.reduce((a, m) => { const v = kg(m.volume()); add(m, v); return a + v; }, 0);
  const mCol = kg(column.volume()), mRod = tube(rod, P.rod.d, 2), mFin = kg(finial.volume());
  mm += mCol + mRod + mFin;
  const mLamps = AR.count * LP.socket_bulb_kg;
  lamps.forEach((l) => { mx += LP.socket_bulb_kg * l.at[0]; my += LP.socket_bulb_kg * l.at[1]; mm += LP.socket_bulb_kg; });
  const total = mBand + mArms + mIns + mCol + mRod + mFin + mLamps, com = Math.hypot(mx, my) / mm;
  if (com > 5) warn.push(`центр тяжести в ${com.toFixed(0)} мм от оси — спираль несимметрична (решение мастера: противовес / раскладка рожков)`);

  const passport = {
    family: 'СПИРАЛЬ', layout: 'рожки со свечами',
    size: { diameter_mm: P.diameter, height_body_mm: +Hgt.toFixed(0), z_top: +(zOf(0) + w / 2 + LH * 0.4).toFixed(0), z_bottom: +(zBotCol - 14).toFixed(0), z_ceiling: +zCeil.toFixed(0) },
    band: { length_plan_mm: +Lplan.toFixed(0), width: w, wall: t, turns: N, r_top: +Rtop.toFixed(0), r_bottom: +Rbot.toFixed(0), strips: strips.length, splices: spliceS.length },
    arms: { count: AR.count, thread: AR.thread, items: info },
    inserts: { count: inserts.length, size_mm: `${IN.len}×${IN.w}×${IN.h}`, note: 'пластина ОРБИТЫ, M4 сквозь ленту' },
    lamps: { count: AR.count, type: LP.bulb, socket: LP.socket },
    column: { d: CO.d, wall: CO.wall, note: 'УСЛОВНО — узел решает мастер' },
    com_offset_mm: +com.toFixed(1), mount: total > 15 ? 'усиленное (> 15 кг)' : 'обычное',
    mass_kg: { band: +mBand.toFixed(2), arms: +mArms.toFixed(2), inserts: +mIns.toFixed(2), column: +mCol.toFixed(2), rod: +mRod.toFixed(2), lamps: +mLamps.toFixed(2), total: +total.toFixed(2) },
  };
  return { passport, warn, band, column, rod, cup, finial, arms, inserts, lamps, strips, kg };
}
