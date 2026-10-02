/**
 * Brass Art — ядро генератора СЛОИ (раскладка «пагода»): тарелки-линзы на центральной трубке M10.
 * Тарелка — две половины ротационной вытяжки из листа (мастер): верх — прямой конус, низ — пологий конус,
 * по кромке плоский поясок под пайку, в центре площадка под гайки. Лампы G9 стоят в гильзах на верхнем конусе.
 * Без файлов: то же ядро пойдёт на сайт. Единицы — мм, Z вверх, 0 — верх верхней тарелки по кромке.
 */
type V2 = [number, number];
const D2R = Math.PI / 180;

export function build(P: any, wasm: any) {
  const { Manifold, CrossSection } = wasm;
  const PL = P.plate, AX = P.axis, LP = P.lamp, warn: string[] = [];
  const kg = (vol: number) => vol * P.brass_density_g_cm3 / 1e6;
  const t = PL.sheet, f = PL.rim_flange, cf = PL.center_flat_r, rh = PL.hole_d / 2, seg = PL.segments;
  const tT = Math.tan(PL.top_slope_deg * D2R), tB = Math.tan(PL.bottom_slope_deg * D2R);

  // профиль половины по радиусу (наружная поверхность): r → z. top: поясок → конус вверх → площадка
  const halfProfile = (R: number, top: boolean) => {
    const s = top ? 1 : -1, tan = top ? tT : tB, h = (R - cf) * tan;
    return { h, pts: [[rh, s * h], [cf, s * h], [R, 0], [R + f, 0]] as V2[] };
  };
  // половина как тело вращения: наружная линия + та же, сдвинутая внутрь линзы на толщину листа
  const half = (R: number, top: boolean) => {
    const { pts } = halfProfile(R, top), s = top ? -1 : 1;
    const inner = pts.map(([r, z], i) => {
      const slope = i === 1 || i === 0 ? 0 : (i === 2 ? (top ? tT : tB) : 0);
      return [r, z + s * t / Math.cos(Math.atan(slope))] as V2;
    });
    const poly: V2[] = top ? [...inner, ...pts.slice().reverse()] : [...pts, ...inner.slice().reverse()];
    return new CrossSection([poly], 'Positive').revolve(seg);
  };
  // ── вариация «как у GPT»: ось проходит сквозь каждую тарелку не по центру, а у кромки (мастер 2026-10-02: «крепление
  // каждой тарелки смещено от центра, как на фото GPT»); где ось проходит сквозь конус — точёные втулки с конусным
  // торцом сверху и снизу. Тарелки разворачиваются вокруг оси по спирали; свеча — в центре каждой тарелки, на площадке
  if (P.layout === 'offset') return offsetLayout();
  function offsetLayout() {
    const O = P.offset, kD = (P.diameter || O.diameter) / O.diameter, Hgt = P.height * kD;
    const sizes: number[] = O.sizes.map((D: number) => Math.round(D * kD));
    const lens = sizes.map((D) => { const R = D / 2; return { R, ht: (R - cf) * tT, hb: (R - cf) * tB, top: half(R, true), bot: half(R, false) }; });
    const n = O.count, LH = LP.socket_h + LP.bulb_h, turn = O.turn_deg * D2R, bd = O.bushing_d, bh = O.bushing_h;
    const pl = Array.from({ length: n }, (_, i) => { const s = O.pattern[i % O.pattern.length], L = lens[s]; return { s, L, e: L.R - O.axis_from_rim, a: i * turn }; });
    const eTop = pl[0].L.ht + LH, eBot = Math.max(pl[n - 1].L.hb, (pl[n - 1].L.R - pl[n - 1].e) * tB + bh + AX.finial_h);
    const pitch = (Hgt - eTop - eBot) / (n - 1);
    const zOf = (i: number) => -i * pitch;
    const hole = (z0: number, h: number) => Manifold.cylinder(h, AX.d / 2 + 0.5, AX.d / 2 + 0.5, 24).translate([0, 0, z0]);
    const plates: any[] = [], parts: any[] = [], lamps: any[] = [], solids: any[] = [], info: any[] = [];
    let mx = 0, my = 0, mm = 0;
    pl.forEach((p, i) => {
      const z = zOf(i), cx = p.e * Math.cos(p.a), cy = p.e * Math.sin(p.a), L = p.L;
      const top = L.top.translate([cx, cy, z]).subtract(hole(z - 200, 400)), bot = L.bot.translate([cx, cy, z]).subtract(hole(z - 200, 400));
      plates.push(top, bot); solids.push(Manifold.union(top, bot));
      const zt = z + (L.R - p.e) * tT, zb = z - (L.R - p.e) * tB;          // поверхность колпака и чаши там, где проходит ось
      parts.push(Manifold.cylinder(bh + 3, bd / 2, bd / 2, 32).translate([0, 0, zt - 3]).subtract(top),       // втулка сверху: торец по конусу
        Manifold.cylinder(bh + 3, bd / 2, bd / 2, 32).translate([0, 0, zb - bh]).subtract(bot));                // втулка снизу
      const zs = z + L.ht, rb = LP.bulb_d / 2;                            // свеча в центре тарелки, на площадке
      const socket = Manifold.cylinder(LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 32).translate([cx, cy, zs]);
      const bulb = Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 24), Manifold.sphere(rb, 24).translate([0, 0, LP.bulb_h - rb])).translate([cx, cy, zs + LP.socket_h]);
      lamps.push({ socket, bulb, at: [cx, cy, zs + LP.socket_h + LP.bulb_h / 2] });
      // снизу в центре — маленькая латунная шишка (гайка патрона, закрывает отверстие), меньше гильзы под лампой (мастер 2026-10-02)
      const kd = O.knob_d / 2, kz = z - L.hb + 0.5;
      parts.push(Manifold.union(Manifold.cylinder(O.knob_h * 0.45, kd, kd * 0.8, 32).translate([cx, cy, kz - O.knob_h * 0.45]),
        Manifold.sphere(kd * 0.8, 24).scale([1, 1, 0.9]).translate([cx, cy, kz - O.knob_h * 0.45])));
      const m = kg(top.volume() + bot.volume()); mx += m * cx; my += m * cy; mm += m;
      if (L.R - p.e - bd / 2 < 10) warn.push(`тарелка ${i + 1}: втулка ближе 10 мм к кромке`);
      // свеча и тарелки выше: от верха колбы до низа тарелки над ней
      let gapMin = Infinity;
      for (let j = 0; j < i; j++) {
        const q = pl[j], qx = q.e * Math.cos(q.a), qy = q.e * Math.sin(q.a), d = Math.hypot(cx - qx, cy - qy);
        if (d > q.L.R + rb) continue;
        const under = zOf(j) - (q.L.R - Math.max(cf, d - rb)) * tB, gap = under - (zs + LH);
        gapMin = Math.min(gapMin, gap);
      }
      if (gapMin < LP.min_gap) warn.push(`тарелка ${i + 1}: колба ближе ${LP.min_gap} мм к тарелке выше (${gapMin.toFixed(0)} мм)`);
      info.push({ plate: i + 1, D: L.R * 2, z_rim: +z.toFixed(1), angle_deg: +((i * O.turn_deg) % 360).toFixed(0), offset_mm: +p.e.toFixed(0), lamp_gap_mm: isFinite(gapMin) ? +gapMin.toFixed(0) : null });
    });
    // тарелки не задевают друг друга
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n && (j - i) * pitch < 150; j++) {
      const v = Manifold.intersection(solids[i], solids[j]).volume();
      if (v > 1) warn.push(`тарелки ${i + 1} и ${j + 1} задевают друг друга (${v.toFixed(0)} мм³)`);
    }
    const zTopAxis = zOf(0) + (pl[0].L.R - pl[0].e) * tT + bh, zCeil = zTopAxis + P.rod.length;
    const zBotAxis = zOf(n - 1) - (pl[n - 1].L.R - pl[n - 1].e) * tB - bh;
    const axis = Manifold.cylinder(zCeil - zBotAxis, AX.d / 2, AX.d / 2, 24).translate([0, 0, zBotAxis]);
    const finial = Manifold.union(Manifold.cylinder(AX.finial_h * 0.55, AX.finial_d / 2 * 0.55, AX.finial_d / 2, 32).translate([0, 0, zBotAxis - AX.finial_h * 0.55]),
      Manifold.sphere(AX.finial_d / 2, 32).scale([1, 1, 0.8]).translate([0, 0, zBotAxis - AX.finial_h * 0.55]));
    const cup = Manifold.cylinder(P.rod.cup_h, P.rod.cup_d / 2 * 0.8, P.rod.cup_d / 2, 64).translate([0, 0, zCeil - P.rod.cup_h]);
    const counts = sizes.map((_, s) => pl.filter((p) => p.s === s).length);
    const plateKg = lens.map((L) => kg(L.top.volume() + L.bot.volume()));
    const mPlates = counts.reduce((a, c, s) => a + c * plateKg[s], 0);
    const wl = AX.wall || 1.5, mAxis = kg(axis.volume() * (1 - ((AX.d / 2 - wl) / (AX.d / 2)) ** 2));
    const mSmall = parts.reduce((a, m) => a + kg(m.volume()), 0) + kg(finial.volume()), mLamps = n * LP.socket_bulb_kg;
    const total = mPlates + mAxis + mSmall + mLamps, com = Math.hypot(mx, my) / mm;
    if (AX.d < 12 && total > 6) warn.push(`масса ${total.toFixed(1)} кг > 6 кг: трубка M10 — до 6 кг, нужна M12`);
    if (com > 3) warn.push(`центр тяжести тарелок в ${com.toFixed(1)} мм от оси`);
    const reach = Math.max(...pl.map((p) => p.e + p.L.R));
    const passport = {
      family: 'СЛОИ', layout: 'смещённая',
      size: { diameter_mm: Math.round(2 * reach + 2 * f), height_body_mm: +(eTop + (n - 1) * pitch + eBot).toFixed(0), pitch_mm: +pitch.toFixed(1),
        z_top: +eTop.toFixed(1), z_bottom: +(zOf(n - 1) - eBot).toFixed(1), z_ceiling: +zCeil.toFixed(1) },
      plates: sizes.map((D, s) => ({ D, count: counts[s], kg_each: +plateKg[s].toFixed(2), lens_mm: +(lens[s].ht + lens[s].hb).toFixed(1),
        top: `конус ${PL.top_slope_deg}°, h ${lens[s].ht.toFixed(1)}`, bottom: `конус ${PL.bottom_slope_deg}°, h ${lens[s].hb.toFixed(1)}` })),
      tiers: info.map((t) => ({ ...t, lamps: 1 })), com_offset_mm: +com.toFixed(1),
      lamps: { count: n, type: LP.bulb, socket: LP.socket, socket_cut_deg: 0, where: 'в центре каждой тарелки' },
      bushings: { count: 2 * n, d_mm: bd, note: 'точёные, торец по конусу тарелки (сверху — колпак, снизу — чаша)' },
      axis: { thread: AX.thread, d_mm: AX.d, length_mm: +(zCeil - zBotAxis).toFixed(0) }, mount: total > 15 ? 'усиленное (> 15 кг)' : 'обычное',
      mass_kg: { plates: +mPlates.toFixed(2), axis: +mAxis.toFixed(2), nuts_finial: +mSmall.toFixed(2), lamps: +mLamps.toFixed(2), total: +total.toFixed(2) },
      sheet_m2: +(counts.reduce((a, c, s) => a + c * 2 * Math.PI * (sizes[s] / 2 + f) ** 2, 0) / 1e6).toFixed(2),
    };
    return { passport, warn, plates, parts, axis, finial, cup, lamps, lens, halfProfile, sizes, kg };
  }

  // ширина люстры = самая большая тарелка; остальные размеры и высота — в той же пропорции (P.diameter — ручка сайта)
  const kD = (P.diameter || Math.max(...PL.sizes)) / Math.max(...PL.sizes), Hgt = P.height * kD;
  const sizes: number[] = PL.sizes.map((D: number) => Math.round(D * kD)), plates: any[] = [], info: any[] = [];
  const lens = sizes.map((D) => { const R = D / 2; return { R, ht: (R - cf) * tT, hb: (R - cf) * tB, top: half(R, true), bot: half(R, false) }; });

  // высоты ярусов: шаг такой, чтобы от верха ламп верхнего яруса до низа наконечника вышло ровно H
  const tiers: number[] = PL.tiers, n = tiers.length, LH = LP.socket_h + LP.bulb_h;
  // кольцо ламп: если тарелка выше меньше — середина открытого пояса; если больше (нижние ярусы) — у кромки под ней
  const covered = (i: number) => i > 0 && lens[tiers[i - 1]].R >= lens[tiers[i]].R;
  const lampR = (i: number) => {
    const R = lens[tiers[i]].R, Rup = i > 0 ? lens[tiers[i - 1]].R : cf + LP.socket_d;
    return covered(i) ? R - LP.socket_d / 2 - PL.lamp_rim_margin : (Math.max(Rup, cf + LP.socket_d) + R) / 2;
  };
  const coneZ = (i: number, r: number) => (lens[tiers[i]].R - r) * tT;  // высота верхнего конуса над кромкой
  const eTop = Math.max(lens[tiers[0]].ht + AX.nut_h, PL.lamps[0] ? coneZ(0, lampR(0)) + LH : 0);
  const eBot = lens[tiers[n - 1]].hb + AX.nut_h + AX.finial_h;
  const pitch = (Hgt - eTop - eBot) / (n - 1);
  if (pitch < 60) warn.push(`ярусы слишком тесно: шаг ${pitch.toFixed(0)} мм`);
  const zOf = (i: number) => -i * pitch;                              // кромка яруса i

  const parts: any[] = [], lamps: { socket: any; bulb: any; at: [number, number, number] }[] = [];
  let lampN = 0; const info_gap: number[] = [];
  for (let i = 0; i < n; i++) {
    const L = lens[tiers[i]], z = zOf(i);
    const top = L.top.translate([0, 0, z]), bot = L.bot.translate([0, 0, z]);
    plates.push(top, bot);
    const nut = (zz: number) => Manifold.cylinder(AX.nut_h, AX.nut_af / Math.sqrt(3), AX.nut_af / Math.sqrt(3), 6).translate([0, 0, zz]);
    parts.push(nut(z + L.ht), nut(z - L.hb - AX.nut_h));
    // лампы: гильза стоит на конусе (низ срезан под угол конуса), лампа сверху
    const k = PL.lamps[i] || 0, rl = lampR(i);
    if (k && covered(i)) {                                           // под тарелкой выше: от верха колбы до её низа
      const U = lens[tiers[i - 1]], under = zOf(i - 1) - (U.R - Math.max(cf, rl - LP.bulb_d / 2)) * tB;
      const topBulb = z + coneZ(i, rl) + LH, vgap = under - topBulb;
      if (vgap < LP.min_gap) warn.push(`ярус ${i + 1}: колба ближе ${LP.min_gap} мм к низу тарелки выше (${vgap.toFixed(0)} мм)`);
      info_gap.push(+vgap.toFixed(0));
    } else if (k) {
      const Rup = i > 0 ? lens[tiers[i - 1]].R : 0, gap = rl - LP.socket_d / 2 - Rup;
      if (i > 0 && gap < LP.min_gap) warn.push(`ярус ${i + 1}: гильза ближе ${LP.min_gap} мм к кромке тарелки выше (${gap.toFixed(0)} мм)`);
      if (rl + LP.socket_d / 2 > L.R - 10) warn.push(`ярус ${i + 1}: гильза не влезает на конус до кромки`);
    }
    for (let j = 0; j < k; j++) {
      const a = 2 * Math.PI * (j + 0.5 * (i % 2)) / k, x = rl * Math.cos(a), y = rl * Math.sin(a);
      const zLow = z + coneZ(i, rl + LP.socket_d / 2), zMid = z + coneZ(i, rl);
      const socket = Manifold.cylinder(zMid - zLow + LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 32).translate([x, y, zLow])
        .subtract(top);                                                // низ гильзы повторяет конус
      const rb = LP.bulb_d / 2, zb = zMid + LP.socket_h;
      const bulb = Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 24), Manifold.sphere(rb, 24).translate([0, 0, LP.bulb_h - rb])).translate([x, y, zb]);
      lamps.push({ socket, bulb, at: [x, y, zb + LP.bulb_h / 2] }); lampN++;
    }
    info.push({ tier: i + 1, D: L.R * 2, z_rim: +z.toFixed(1), lamps: k, lamp_ring_r: k ? +rl.toFixed(1) : null });
  }
  // ось: трубка от чаши до наконечника; наконечник — латунная капля
  const zTopAxis = zOf(0) + lens[tiers[0]].ht + AX.nut_h, zCeil = zTopAxis + P.rod.length;
  const zBotAxis = zOf(n - 1) - lens[tiers[n - 1]].hb - AX.nut_h;
  const axis = Manifold.cylinder(zCeil - zBotAxis, AX.d / 2, AX.d / 2, 24).translate([0, 0, zBotAxis]);
  const finial = Manifold.union(Manifold.cylinder(AX.finial_h * 0.55, AX.finial_d / 2 * 0.55, AX.finial_d / 2, 32).translate([0, 0, zBotAxis - AX.finial_h * 0.55]),
    Manifold.sphere(AX.finial_d / 2, 32).scale([1, 1, 0.8]).translate([0, 0, zBotAxis - AX.finial_h * 0.55]));
  const cup = Manifold.cylinder(P.rod.cup_h, P.rod.cup_d / 2 * 0.8, P.rod.cup_d / 2, 64).translate([0, 0, zCeil - P.rod.cup_h]);

  // масса: тарелки по размерам, ось, гайки, гильзы
  const plateKg = lens.map((L) => kg(L.top.volume() + L.bot.volume()));
  const counts = sizes.map((_, s) => tiers.filter((x) => x === s).length);
  const mPlates = counts.reduce((a, c, s) => a + c * plateKg[s], 0);
  const wl = AX.wall || 1.5, mAxis = kg(axis.volume() * (1 - ((AX.d / 2 - wl) / (AX.d / 2)) ** 2));   // трубка: стенка wl от сплошного прутка
  const mSmall = parts.reduce((a, m) => a + kg(m.volume()), 0) + kg(finial.volume());
  const mLamps = lampN * LP.socket_bulb_kg;
  const total = mPlates + mAxis + mSmall + mLamps;
  // труба по стандарту CELL: M10×1 — до 6 кг, M12 (стенка 2) — выше, не более M12; > 15 кг — усиленное крепление
  if (AX.d < 12 && total > 6) warn.push(`масса ${total.toFixed(1)} кг > 6 кг: трубка M10 — до 6 кг, нужна M12`);
  const mount = total > 15 ? 'усиленное (> 15 кг)' : 'обычное';
  const H = (zTopAxis - (zBotAxis - AX.finial_h)) + (PL.lamps[0] ? Math.max(0, eTop - lens[tiers[0]].ht - AX.nut_h) : 0);

  const passport = {
    family: 'СЛОИ', layout: 'пагода',
    size: { diameter_mm: Math.max(...sizes) + 2 * f, height_body_mm: +(eTop + (n - 1) * pitch + eBot).toFixed(0), pitch_mm: +pitch.toFixed(1),
      z_top: +eTop.toFixed(1), z_bottom: +(zOf(n - 1) - eBot).toFixed(1), z_ceiling: +zCeil.toFixed(1) },
    plates: sizes.map((D, s) => ({ D, count: counts[s], kg_each: +plateKg[s].toFixed(2), lens_mm: +(lens[s].ht + lens[s].hb).toFixed(1),
      top: `конус ${PL.top_slope_deg}°, h ${lens[s].ht.toFixed(1)}`, bottom: `конус ${PL.bottom_slope_deg}°, h ${lens[s].hb.toFixed(1)}` })),
    tiers: info,
    lamps: { count: lampN, type: LP.bulb, socket: LP.socket, socket_cut_deg: PL.top_slope_deg, under_plate_gap_mm: info_gap },
    axis: { thread: AX.thread, d_mm: AX.d, length_mm: +(zCeil - zBotAxis).toFixed(0) }, mount,
    mass_kg: { plates: +mPlates.toFixed(2), axis: +mAxis.toFixed(2), nuts_finial: +mSmall.toFixed(2), lamps: +mLamps.toFixed(2), total: +total.toFixed(2) },
    sheet_m2: +(counts.reduce((a, c, s) => a + c * 2 * Math.PI * (sizes[s] / 2 + f) ** 2, 0) / 1e6).toFixed(2),
  };
  void H;
  return { passport, warn, plates, parts, axis, finial, cup, lamps, lens, halfProfile, sizes, kg };
}
