(() => {
  // sloi-core.ts
  var D2R = Math.PI / 180;
  function build(P, wasm) {
    const { Manifold, CrossSection } = wasm;
    const PL = P.plate, AX = P.axis, LP = P.lamp, warn = [];
    const kg = (vol) => vol * P.brass_density_g_cm3 / 1e6;
    const t = PL.sheet, f = PL.rim_flange, cf = PL.center_flat_r, rh = PL.hole_d / 2, seg = PL.segments;
    const tT = Math.tan(PL.top_slope_deg * D2R), tB = Math.tan(PL.bottom_slope_deg * D2R);
    const halfProfile = (R, top) => {
      const s = top ? 1 : -1, tan = top ? tT : tB, h = (R - cf) * tan;
      return { h, pts: [[rh, s * h], [cf, s * h], [R, 0], [R + f, 0]] };
    };
    const half = (R, top) => {
      const { pts } = halfProfile(R, top), s = top ? -1 : 1;
      const inner = pts.map(([r, z], i) => {
        const slope = i === 1 || i === 0 ? 0 : i === 2 ? top ? tT : tB : 0;
        return [r, z + s * t / Math.cos(Math.atan(slope))];
      });
      const poly = top ? [...inner, ...pts.slice().reverse()] : [...pts, ...inner.slice().reverse()];
      return new CrossSection([poly], "Positive").revolve(seg);
    };
    const kD = (P.diameter || Math.max(...PL.sizes)) / Math.max(...PL.sizes), Hgt = P.height * kD;
    const sizes = PL.sizes.map((D) => Math.round(D * kD)), plates = [], info = [];
    const lens = sizes.map((D) => {
      const R = D / 2;
      return { R, ht: (R - cf) * tT, hb: (R - cf) * tB, top: half(R, true), bot: half(R, false) };
    });
    const tiers = PL.tiers, n = tiers.length, LH = LP.socket_h + LP.bulb_h;
    const covered = (i) => i > 0 && lens[tiers[i - 1]].R >= lens[tiers[i]].R;
    const lampR = (i) => {
      const R = lens[tiers[i]].R, Rup = i > 0 ? lens[tiers[i - 1]].R : cf + LP.socket_d;
      return covered(i) ? R - LP.socket_d / 2 - PL.lamp_rim_margin : (Math.max(Rup, cf + LP.socket_d) + R) / 2;
    };
    const coneZ = (i, r) => (lens[tiers[i]].R - r) * tT;
    const eTop = Math.max(lens[tiers[0]].ht + AX.nut_h, PL.lamps[0] ? coneZ(0, lampR(0)) + LH : 0);
    const eBot = lens[tiers[n - 1]].hb + AX.nut_h + AX.finial_h;
    const pitch = (Hgt - eTop - eBot) / (n - 1);
    if (pitch < 60) warn.push(`\u044F\u0440\u0443\u0441\u044B \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0442\u0435\u0441\u043D\u043E: \u0448\u0430\u0433 ${pitch.toFixed(0)} \u043C\u043C`);
    const zOf = (i) => -i * pitch;
    const parts = [], lamps = [];
    let lampN = 0;
    const info_gap = [];
    for (let i = 0; i < n; i++) {
      const L = lens[tiers[i]], z = zOf(i);
      const top = L.top.translate([0, 0, z]), bot = L.bot.translate([0, 0, z]);
      plates.push(top, bot);
      const nut = (zz) => Manifold.cylinder(AX.nut_h, AX.nut_af / Math.sqrt(3), AX.nut_af / Math.sqrt(3), 6).translate([0, 0, zz]);
      parts.push(nut(z + L.ht), nut(z - L.hb - AX.nut_h));
      const k = PL.lamps[i] || 0, rl = lampR(i);
      if (k && covered(i)) {
        const U = lens[tiers[i - 1]], under = zOf(i - 1) - (U.R - Math.max(cf, rl - LP.bulb_d / 2)) * tB;
        const topBulb = z + coneZ(i, rl) + LH, vgap = under - topBulb;
        if (vgap < LP.min_gap) warn.push(`\u044F\u0440\u0443\u0441 ${i + 1}: \u043A\u043E\u043B\u0431\u0430 \u0431\u043B\u0438\u0436\u0435 ${LP.min_gap} \u043C\u043C \u043A \u043D\u0438\u0437\u0443 \u0442\u0430\u0440\u0435\u043B\u043A\u0438 \u0432\u044B\u0448\u0435 (${vgap.toFixed(0)} \u043C\u043C)`);
        info_gap.push(+vgap.toFixed(0));
      } else if (k) {
        const Rup = i > 0 ? lens[tiers[i - 1]].R : 0, gap = rl - LP.socket_d / 2 - Rup;
        if (i > 0 && gap < LP.min_gap) warn.push(`\u044F\u0440\u0443\u0441 ${i + 1}: \u0433\u0438\u043B\u044C\u0437\u0430 \u0431\u043B\u0438\u0436\u0435 ${LP.min_gap} \u043C\u043C \u043A \u043A\u0440\u043E\u043C\u043A\u0435 \u0442\u0430\u0440\u0435\u043B\u043A\u0438 \u0432\u044B\u0448\u0435 (${gap.toFixed(0)} \u043C\u043C)`);
        if (rl + LP.socket_d / 2 > L.R - 10) warn.push(`\u044F\u0440\u0443\u0441 ${i + 1}: \u0433\u0438\u043B\u044C\u0437\u0430 \u043D\u0435 \u0432\u043B\u0435\u0437\u0430\u0435\u0442 \u043D\u0430 \u043A\u043E\u043D\u0443\u0441 \u0434\u043E \u043A\u0440\u043E\u043C\u043A\u0438`);
      }
      for (let j = 0; j < k; j++) {
        const a = 2 * Math.PI * (j + 0.5 * (i % 2)) / k, x = rl * Math.cos(a), y = rl * Math.sin(a);
        const zLow = z + coneZ(i, rl + LP.socket_d / 2), zMid = z + coneZ(i, rl);
        const socket = Manifold.cylinder(zMid - zLow + LP.socket_h, LP.socket_d / 2, LP.socket_d / 2, 32).translate([x, y, zLow]).subtract(top);
        const rb = LP.bulb_d / 2, zb = zMid + LP.socket_h;
        const bulb = Manifold.union(Manifold.cylinder(LP.bulb_h - rb, rb, rb, 24), Manifold.sphere(rb, 24).translate([0, 0, LP.bulb_h - rb])).translate([x, y, zb]);
        lamps.push({ socket, bulb, at: [x, y, zb + LP.bulb_h / 2] });
        lampN++;
      }
      info.push({ tier: i + 1, D: L.R * 2, z_rim: +z.toFixed(1), lamps: k, lamp_ring_r: k ? +rl.toFixed(1) : null });
    }
    const zTopAxis = zOf(0) + lens[tiers[0]].ht + AX.nut_h, zCeil = zTopAxis + P.rod.length;
    const zBotAxis = zOf(n - 1) - lens[tiers[n - 1]].hb - AX.nut_h;
    const axis = Manifold.cylinder(zCeil - zBotAxis, AX.d / 2, AX.d / 2, 24).translate([0, 0, zBotAxis]);
    const finial = Manifold.union(
      Manifold.cylinder(AX.finial_h * 0.55, AX.finial_d / 2 * 0.55, AX.finial_d / 2, 32).translate([0, 0, zBotAxis - AX.finial_h * 0.55]),
      Manifold.sphere(AX.finial_d / 2, 32).scale([1, 1, 0.8]).translate([0, 0, zBotAxis - AX.finial_h * 0.55])
    );
    const cup = Manifold.cylinder(P.rod.cup_h, P.rod.cup_d / 2 * 0.8, P.rod.cup_d / 2, 64).translate([0, 0, zCeil - P.rod.cup_h]);
    const plateKg = lens.map((L) => kg(L.top.volume() + L.bot.volume()));
    const counts = sizes.map((_, s) => tiers.filter((x) => x === s).length);
    const mPlates = counts.reduce((a, c, s) => a + c * plateKg[s], 0);
    const wl = AX.wall || 1.5, mAxis = kg(axis.volume() * (1 - ((AX.d / 2 - wl) / (AX.d / 2)) ** 2));
    const mSmall = parts.reduce((a, m) => a + kg(m.volume()), 0) + kg(finial.volume());
    const mLamps = lampN * LP.socket_bulb_kg;
    const total = mPlates + mAxis + mSmall + mLamps;
    if (AX.d < 12 && total > 6) warn.push(`\u043C\u0430\u0441\u0441\u0430 ${total.toFixed(1)} \u043A\u0433 > 6 \u043A\u0433: \u0442\u0440\u0443\u0431\u043A\u0430 M10 \u2014 \u0434\u043E 6 \u043A\u0433, \u043D\u0443\u0436\u043D\u0430 M12`);
    const mount = total > 15 ? "\u0443\u0441\u0438\u043B\u0435\u043D\u043D\u043E\u0435 (> 15 \u043A\u0433)" : "\u043E\u0431\u044B\u0447\u043D\u043E\u0435";
    const H = zTopAxis - (zBotAxis - AX.finial_h) + (PL.lamps[0] ? Math.max(0, eTop - lens[tiers[0]].ht - AX.nut_h) : 0);
    const passport = {
      family: "\u0421\u041B\u041E\u0418",
      layout: "\u043F\u0430\u0433\u043E\u0434\u0430",
      size: {
        diameter_mm: Math.max(...sizes) + 2 * f,
        height_body_mm: +(eTop + (n - 1) * pitch + eBot).toFixed(0),
        pitch_mm: +pitch.toFixed(1),
        z_top: +eTop.toFixed(1),
        z_bottom: +(zOf(n - 1) - eBot).toFixed(1),
        z_ceiling: +zCeil.toFixed(1)
      },
      plates: sizes.map((D, s) => ({
        D,
        count: counts[s],
        kg_each: +plateKg[s].toFixed(2),
        lens_mm: +(lens[s].ht + lens[s].hb).toFixed(1),
        top: `\u043A\u043E\u043D\u0443\u0441 ${PL.top_slope_deg}\xB0, h ${lens[s].ht.toFixed(1)}`,
        bottom: `\u043A\u043E\u043D\u0443\u0441 ${PL.bottom_slope_deg}\xB0, h ${lens[s].hb.toFixed(1)}`
      })),
      tiers: info,
      lamps: { count: lampN, type: LP.bulb, socket: LP.socket, socket_cut_deg: PL.top_slope_deg, under_plate_gap_mm: info_gap },
      axis: { thread: AX.thread, d_mm: AX.d, length_mm: +(zCeil - zBotAxis).toFixed(0) },
      mount,
      mass_kg: { plates: +mPlates.toFixed(2), axis: +mAxis.toFixed(2), nuts_finial: +mSmall.toFixed(2), lamps: +mLamps.toFixed(2), total: +total.toFixed(2) },
      sheet_m2: +(counts.reduce((a, c, s) => a + c * 2 * Math.PI * (sizes[s] / 2 + f) ** 2, 0) / 1e6).toFixed(2)
    };
    void H;
    return { passport, warn, plates, parts, axis, finial, cup, lamps, lens, halfProfile, sizes, kg };
  }

  // web.ts
  globalThis.SLOI = { build };
})();
