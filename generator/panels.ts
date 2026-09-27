/**
 * Brass Art — нарезка каркаса на литейные панели (мастер-модели на печать).
 *
 * Правила — из стандартов, не выдуманы (docs/manufacturing.md §3, docs/print-prep.md):
 *  - рез только поперёк ребра, в самом тонком месте пролёта: не толще cut_max_width_mm
 *    и не ближе cut_node_clear_mm к узлу; узлы и толстые перемычки не режутся;
 *  - стык встык, без замков (сварка); рез — плоскость поперёк ребра;
 *  - панель неглубокая, не больше max_arc_deg дуги — тянется из полуформы;
 *  - одна печать = одна панель: мастер-модель, увеличенная на усадку, влезает в поле принтера;
 *  - раскладка: сначала меньше панелей (формовок), потом меньше швов;
 *  - номер панели = шаг сборки; номер отливается выпуклыми цифрами изнутри панели (чтобы не запутаться).
 */
import { add, sub, mul, dot, cross, len, norm, angle, slerp, rng, tangentBasis, hull2, fitRect } from './geom.ts';

type V3 = [number, number, number];
type V2 = [number, number];

export function cutPanels(ctx: any) {
  const { Manifold, P, R, Rm, T, seatR, nodes, edges, width } = ctx;
  const C = P.panels, k = 1 + C.shrink_pct / 100;
  const bx = C.bed_mm[0] - 2 * C.bed_margin_mm, by = C.bed_mm[1] - 2 * C.bed_margin_mm, bz = C.bed_mm[2] - C.bed_margin_mm;
  const halfArc = ((C.max_arc_deg / 2) * Math.PI) / 180;
  const warn: string[] = [];
  const nN = nodes.length;
  // форма: шар — прежние формулы (одобренная нарезка не меняется); другие формы — настоящая поверхность
  const G = !!ctx.general;
  const surf: (w: V3) => V3 = ctx.surf ?? ((w: V3) => mul(w, Rm));
  const nrm: (w: V3) => V3 = ctx.nrm ?? ((w: V3) => w);
  const outer = (w: V3) => add(surf(w), mul(nrm(w), T / 2));
  const inner = (w: V3) => sub(surf(w), mul(nrm(w), T / 2));

  // ── 1. тонкое место каждого ребра: там и только там разрешён рез ──
  for (const e of edges) {
    const a = nodes[e.n1], b = nodes[e.n2], ang = angle(a, b);
    const Lr = G ? len(sub(surf(a), surf(b))) : ang * Rm;
    const N = Math.max(24, Math.ceil(Lr / 1.5));
    const ws: number[] = [];
    let im = 0;
    for (let i = 0; i <= N; i++) { ws.push(width(e, slerp(a, b, i / N))); if (ws[i] < ws[im]) im = i; }
    let i0 = im, i1 = im;                                      // середина «тонкой полки» — дальше всего от узлов
    while (i0 > 0 && ws[i0 - 1] <= ws[im] + 0.3) i0--;
    while (i1 < N && ws[i1 + 1] <= ws[im] + 0.3) i1++;
    const t = (i0 + i1) / 2 / N;
    e.w = ws[im];
    e.m = slerp(a, b, t);
    e.tan = norm(cross(norm(cross(a, b)), e.m));              // направление ребра в точке реза
    e.n = nrm(e.m);
    if (G) {                                                   // касательная к настоящей поверхности
      const t0 = sub(surf(slerp(a, b, Math.min(1, t + 0.01))), surf(slerp(a, b, Math.max(0, t - 0.01))));
      e.tan = norm(sub(t0, mul(e.n, dot(t0, e.n))));
    }
    const pm = surf(e.m);
    if (G) {
      // на изогнутой форме настоящее ребро чуть смещено от линии Вороного — найти его поперёк и резать по нему
      const g = cross(e.n, e.tan), inside = (sN: number) => { const q = norm(add(pm, mul(g, sN))); return ctx.metalU(q[0], q[1], q[2]) > 0; };
      let a0 = 0;
      if (!inside(0)) for (let d = 0.5; d <= 12; d += 0.5) { if (inside(d)) { a0 = d; break; } if (inside(-d)) { a0 = -d; break; } }
      let s0 = a0, s1 = a0;
      while (s0 > -40 && inside(s0 - 0.5)) s0 -= 0.5;
      while (s1 < 40 && inside(s1 + 0.5)) s1 += 0.5;
      e.off = (s0 + s1) / 2; e.wReal = s1 - s0;
    }
    const clear = G ? Math.min(len(sub(pm, surf(a))), len(sub(pm, surf(b)))) : Math.min(t, 1 - t) * ang * Rm;
    let fromPole = G ? len(sub(pm, surf([0, 0, 1]))) : angle(e.m, [0, 0, 1]) * Rm;
    if (ctx.bottomSeat) fromPole = Math.min(fromPole, G ? len(sub(pm, surf([0, 0, -1]))) : angle(e.m, [0, 0, -1]) * Rm);   // и нижняя площадка
    // отступ от узла: cut_node_clear_mm, но на коротких рёбрах (мелкие ячейки у края) — доля длины, не меньше cut_node_clear_min_mm
    const needClear = Math.max(C.cut_node_clear_min_mm ?? C.cut_node_clear_mm, Math.min(C.cut_node_clear_mm, 0.3 * Lr));
    e.cut = e.w <= C.cut_max_width_mm && clear >= needClear && fromPole >= seatR + C.cut_node_clear_mm;
  }

  const belt = G && C.belt !== false;
  const upFacing = (w: V3) => nrm(w)[2] >= 0;
  // линия пояса: по каждому азимуту — первое место сверху, где стенка перестаёт смотреть вверх;
  // верх/низ — по положению относительно этой линии (а не по наклону в точке: у «вздутий» он скачет)
  const NB = 240, beltTh = new Float64Array(NB);
  if (belt) for (let i = 0; i < NB; i++) {
    const ph = (2 * Math.PI * i) / NB, c = Math.cos(ph), sn = Math.sin(ph);
    const dir = (th: number): V3 => [Math.sin(th) * c, Math.sin(th) * sn, Math.cos(th)];
    let th0 = 0.05;
    while (th0 < Math.PI - 0.05 && upFacing(dir(th0))) th0 += 0.02;
    let lo = th0 - 0.02, hi = th0;
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (upFacing(dir(mid))) lo = mid; else hi = mid; }
    beltTh[i] = (lo + hi) / 2;
  }
  const beltAt = (ph: number) => {
    const f = (((ph / (2 * Math.PI)) % 1) + 1) % 1 * NB, i = Math.floor(f) % NB, t = f - Math.floor(f);
    return beltTh[i] * (1 - t) + beltTh[(i + 1) % NB] * t;
  };
  const side = (w: V3) => (Math.acos(Math.max(-1, Math.min(1, w[2]))) <= beltAt(Math.atan2(w[1], w[0])) ? 1 : -1);
  if (belt) for (const e of edges) {
    const a = nodes[e.n1], b = nodes[e.n2];
    if (side(a) === side(b)) continue;
    let lo = 0, hi = 1;                                       // где на ребре стенка вертикальна
    for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (side(slerp(a, b, mid)) === side(a)) lo = mid; else hi = mid; }
    const tb = (lo + hi) / 2, Le = len(sub(surf(a), surf(b))), dt = Math.min(0.45, (C.belt_window_mm ?? 15) / Math.max(Le, 1));
    let t = tb, wb = Infinity;
    for (let k = -10; k <= 10; k++) { const tt = Math.max(0.02, Math.min(0.98, tb + (dt * k) / 10)), wv = width(e, slerp(a, b, tt)); if (wv < wb) { wb = wv; t = tt; } }
    e.belt = true; e.cut = true;
    e.m = slerp(a, b, t); e.n = nrm(e.m); e.w = wb;
    { const pmb = surf(e.m), g0 = cross(e.n, norm(sub(surf(slerp(a, b, Math.min(1, t + 0.01))), surf(slerp(a, b, Math.max(0, t - 0.01))))));
      const g = norm(g0), inside = (sN: number) => { const q = norm(add(pmb, mul(g, sN))); return ctx.metalU(q[0], q[1], q[2]) > 0; };
      let s0 = 0, s1 = 0; while (s0 > -60 && inside(s0 - 0.5)) s0 -= 0.5; while (s1 < 60 && inside(s1 + 0.5)) s1 += 0.5;
      e.off = (s0 + s1) / 2; e.wReal = s1 - s0; }
    const t0 = sub(surf(slerp(a, b, Math.min(1, t + 0.01))), surf(slerp(a, b, Math.max(0, t - 0.01))));
    e.tan = norm(sub(t0, mul(e.n, dot(t0, e.n))));
  }

  // ── 2. «атомы»: узлы, связанные нережущимися рёбрами, всегда в одной панели ──
  const par = nodes.map((_: V3, i: number) => i);
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (const e of edges) if (!e.cut) par[find(e.n1)] = find(e.n2);
  const roots = [...new Set<number>(nodes.map((_: V3, i: number) => find(i)))];
  const aOf = new Map(roots.map((r, i) => [r, i]));
  const nA = roots.length;
  const aNodes: number[][] = roots.map(() => []);
  for (let i = 0; i < nN; i++) aNodes[aOf.get(find(i))!].push(i);
  const aDir: V3[] = aNodes.map((ns) => norm(ns.reduce((s: V3, i) => add(s, nodes[i]), [0, 0, 0] as V3)));
  const cands = edges.filter((e: any) => e.cut && !e.belt && find(e.n1) !== find(e.n2))
    .map((e: any) => ({ e, a: aOf.get(find(e.n1))!, b: aOf.get(find(e.n2))! }));
  // поясные резы — всегда граница панели; верх и низ между собой не соседи
  const beltCuts = edges.filter((e: any) => e.belt).map((e: any) => ({ e, a: aOf.get(find(e.n1))!, b: aOf.get(find(e.n2))! }));
  const aBelt: V3[][] = roots.map(() => []);
  for (const c of beltCuts) { aBelt[c.a].push(c.e.m); aBelt[c.b].push(c.e.m); }
  const inc: number[][] = roots.map(() => []);
  cands.forEach((c: any, i: number) => { inc[c.a].push(i); inc[c.b].push(i); });
  const other = (ci: number, a: number) => (cands[ci].a === a ? cands[ci].b : cands[ci].a);

  // ── 3. оценка панели по её скелету (узлы + точки реза) ──
  const est = (lab: Int32Array, q: number, pad: number, step = 3) => {
    const pts: V3[] = [];
    for (let a = 0; a < nA; a++) if (lab[a] === q) {
      for (const n of aNodes[a]) pts.push(nodes[n]);
      for (const ci of inc[a]) if (lab[other(ci, a)] !== q) pts.push(cands[ci].e.m);
      for (const m of aBelt[a]) pts.push(m);
    }
    if (G) {
      const ns = pts.map(nrm), P3 = pts.map(outer);
      const axis = norm(ns.reduce((s, p) => add(s, p), [0, 0, 0] as V3));
      const [u, v] = tangentBasis(axis);
      let arc = 0, okArc: boolean;
      if (belt) {
        // шов по поясу: чаша вынимается прямо вверх (верх) или вниз (низ) — поверхность не должна смотреть
        // против вынимания (без отрицательных уклонов, мастер 2026-09-17); правило 60° здесь не нужно
        const pull: V3 = [0, 0, ns.reduce((s0, n) => s0 + n[2], 0) >= 0 ? 1 : -1];
        for (const n of ns) arc = Math.max(arc, angle(n, pull));
        okArc = arc <= ((C.belt_draft_max_deg ?? 100) * Math.PI) / 180;   // у кромки кусочек ребра может чуть зайти за пояс
      } else {
        for (const n of ns) arc = Math.max(arc, angle(n, axis));
        okArc = arc + pad / R <= halfArc;
      }
      const f = fitRect(hull2(P3.map((p) => [dot(p, u), dot(p, v)] as V2)), bx, by, pad, k, step);
      return { ok: f.ratio <= 1 && okArc, ratio: f.ratio, axis, arc };
    }
    const axis = norm(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3));
    const [u, v] = tangentBasis(axis);
    let arc = 0;
    const p2: V2[] = pts.map((p) => { arc = Math.max(arc, angle(p, axis)); return [dot(p, u) * R, dot(p, v) * R]; });
    const f = fitRect(hull2(p2), bx, by, pad, k, step);
    return { ok: f.ratio <= 1 && arc + pad / R <= halfArc, ratio: f.ratio, axis, arc };
  };
  const connected = (lab: Int32Array, q: number, skip = -1) => {
    let start = -1, total = 0;
    for (let a = 0; a < nA; a++) if (lab[a] === q && a !== skip) { total++; if (start < 0) start = a; }
    if (total <= 1) return true;
    const seen = new Uint8Array(nA), st = [start];
    seen[start] = 1;
    let cnt = 1;
    while (st.length) {
      const a = st.pop()!;
      for (const ci of inc[a]) { const b = other(ci, a); if (!seen[b] && b !== skip && lab[b] === q) { seen[b] = 1; cnt++; st.push(b); } }
    }
    return cnt === total;
  };
  const nbCount = (lab: Int32Array, a: number) => {
    const cnt = new Map<number, number>();
    for (const ci of inc[a]) { const q = lab[other(ci, a)]; cnt.set(q, (cnt.get(q) ?? 0) + 1); }
    return cnt;
  };

  if (process.env.PANEL_DEBUG) {
    const why = { толсто: 0, уузла: 0, полюс: 0 };
    for (const e of edges) if (!e.cut) {
      const a = nodes[e.n1], b = nodes[e.n2], L = angle(a, b) * Rm;
      if (e.w > C.cut_max_width_mm) why.толсто++;
      else if (angle(e.m, [0, 0, 1]) * Rm < seatR + C.cut_node_clear_mm) why.полюс++;
      else why.уузла++;
    }
    const lens = edges.map((e: any) => Math.round(angle(nodes[e.n1], nodes[e.n2]) * Rm)).sort((x: number, y: number) => x - y);
    const sizes = aNodes.map((ns) => ns.length).sort((x, y) => y - x);
    const thick = edges.filter((e: any) => e.w > C.cut_max_width_mm).map((e: any) => [Math.round(angle(nodes[e.n1], nodes[e.n2]) * Rm), +e.w.toFixed(1)]);
    console.error('рёбер', edges.length, 'режутся', edges.filter((e: any) => e.cut).length, JSON.stringify(why));
    console.error('длины', JSON.stringify(lens.slice(0, 30)), '…');
    console.error('атомы (узлов)', JSON.stringify(sizes.slice(0, 12)));
    console.error('толстые [длина, ширина]', JSON.stringify(thick.slice(0, 25)));
  }
  // одиночный атом не влезает — никакая раскладка не поможет
  for (let a = 0; a < nA; a++) {
    const lab = new Int32Array(nA).fill(-1); lab[a] = 0;
    const e0 = est(lab, 0, C.est_pad_mm);
    if (!e0.ok) throw new Error(`узел ${a} (${aNodes[a].length} шт.) не проходит: на столе ${(e0.ratio * 100).toFixed(0)}% поля, дуга ${((2 * e0.arc * 180) / Math.PI).toFixed(0)}° — нарезка невозможна`);
  }

  // ── 4. поиск раскладки ──
  const poleN = nodes.reduce((bi: number, p: V3, i: number) => (p[2] > nodes[bi][2] ? i : bi), 0);
  const poleA = aOf.get(find(poleN))!;
  function kmeans(K: number, rnd: () => number) {
    const cs: V3[] = [aDir[poleA]];
    while (cs.length < K) {
      let bi = 0, bd = -1;
      for (let a = 0; a < nA; a++) {
        const d = Math.min(...cs.map((c) => angle(aDir[a], c))) * (0.8 + 0.4 * rnd());
        if (d > bd) { bd = d; bi = a; }
      }
      cs.push(aDir[bi]);
    }
    const lab = new Int32Array(nA);
    for (let it = 0; it < 25; it++) {
      for (let a = 0; a < nA; a++) {
        let best = 0, bd = -2;
        for (let q = 0; q < K; q++) { const d = dot(aDir[a], cs[q]); if (d > bd) { bd = d; best = q; } }
        lab[a] = best;
      }
      const sum: V3[] = cs.map(() => [0, 0, 0]);
      for (let a = 0; a < nA; a++) sum[lab[a]] = add(sum[lab[a]], mul(aDir[a], aNodes[a].length));
      for (let q = 0; q < K; q++) if (len(sum[q]) > 1e-9) cs[q] = norm(sum[q]);
    }
    return lab;
  }
  function fixConn(lab: Int32Array) {
    for (let pass = 0; pass < 30; pass++) {
      let changed = false;
      for (const q of new Set(lab)) {
        const comp = new Int32Array(nA).fill(-1), sizes: number[] = [];
        for (let a = 0; a < nA; a++) if (lab[a] === q && comp[a] < 0) {
          const id = sizes.length, st = [a];
          let sz = 0;
          comp[a] = id;
          while (st.length) { const x = st.pop()!; sz += aNodes[x].length; for (const ci of inc[x]) { const y = other(ci, x); if (lab[y] === q && comp[y] < 0) { comp[y] = id; st.push(y); } } }
          sizes.push(sz);
        }
        if (sizes.length <= 1) continue;
        const keep = sizes.indexOf(Math.max(...sizes));
        for (let a = 0; a < nA; a++) if (lab[a] === q && comp[a] !== keep) {
          const cnt = nbCount(lab, a); cnt.delete(q);
          if (cnt.size) { lab[a] = [...cnt].sort((x, y) => y[1] - x[1])[0][0]; changed = true; }
        }
      }
      if (!changed) return;
    }
  }
  // переполненную панель — пополам: две области растут от двух дальних атомов по соседству,
  // поэтому обе половины связны; одиночный атом всегда влезает (проверено выше)
  function split(lab: Int32Array, q: number, fresh: number, rnd: () => number) {
    const mem: number[] = [];
    for (let a = 0; a < nA; a++) if (lab[a] === q) mem.push(a);
    if (mem.length < 2) return;
    let s1 = mem[Math.floor(rnd() * mem.length)], s2 = s1;
    for (let rep = 0; rep < 2; rep++) {
      let bd = -1;
      for (const a of mem) { const d = angle(aDir[a], aDir[s1]); if (d > bd) { bd = d; s2 = a; } }
      [s1, s2] = [s2, s1];
    }
    const inP = new Set(mem), side = new Map<number, number>([[s1, 0], [s2, 1]]);
    const size = [aNodes[s1].length, aNodes[s2].length], dir = [aDir[s1], aDir[s2]];
    const grow = (g: number) => {
      let best = -1, bd = -2;
      for (const [a, sd] of side) if (sd === g) for (const ci of inc[a]) {
        const b = other(ci, a);
        if (inP.has(b) && !side.has(b)) { const d = dot(aDir[b], dir[g]); if (d > bd) { bd = d; best = b; } }
      }
      if (best >= 0) { side.set(best, g); size[g] += aNodes[best].length; }
      return best >= 0;
    };
    while (side.size < mem.length) {
      const g = size[0] <= size[1] ? 0 : 1;
      if (!grow(g) && !grow(1 - g)) break;
    }
    for (const [a, sd] of side) if (sd === 1) lab[a] = fresh;
  }
  function mergePass(lab: Int32Array, pad: number) {
    for (let guard = 0; guard < 100; guard++) {
      const pairs = new Map<string, number>();
      for (const c of cands) { const p = lab[c.a], q = lab[c.b]; if (p !== q) { const key = p < q ? `${p},${q}` : `${q},${p}`; pairs.set(key, (pairs.get(key) ?? 0) + 1); } }
      let merged = false;
      for (const [key] of [...pairs].sort((x, y) => y[1] - x[1])) {
        const [p, q] = key.split(',').map(Number);
        const save = lab.slice();
        for (let a = 0; a < nA; a++) if (lab[a] === q) lab[a] = p;
        if (est(lab, p, pad).ok) { merged = true; break; }
        lab.set(save);
      }
      if (!merged) return;
    }
  }
  // маленькую панель — раздать соседям целиком, если все её атомы где-то помещаются
  function dissolve(lab: Int32Array, pad: number) {
    for (let guard = 0; guard < 100; guard++) {
      const size = new Map<number, number>();
      for (let a = 0; a < nA; a++) size.set(lab[a], (size.get(lab[a]) ?? 0) + aNodes[a].length);
      let done = false;
      for (const q of [...size.keys()].sort((x, y) => size.get(x)! - size.get(y)!)) {
        const save = lab.slice();
        let left = [...Array(nA).keys()].filter((a) => lab[a] === q), progress = true;
        while (left.length && progress) {
          progress = false;
          for (const a of left) {
            const cnt = nbCount(lab, a); cnt.delete(q);
            for (const [r] of [...cnt].sort((x, y) => y[1] - x[1])) {
              lab[a] = r;
              if (est(lab, r, pad).ok) break;
              lab[a] = q;
            }
            if (lab[a] !== q) { left = left.filter((x) => x !== a); progress = true; break; }
          }
        }
        if (!left.length) { done = true; break; }
        lab.set(save);
      }
      if (!done) return;
    }
  }
  function improve(lab: Int32Array, pad: number) {
    for (let pass = 0; pass < 30; pass++) {
      let moved = false;
      for (let a = 0; a < nA; a++) {
        const p = lab[a], cnt = nbCount(lab, a), own = cnt.get(p) ?? 0;
        for (const [q, n] of cnt) {
          if (q === p || n <= own || !connected(lab, p, a)) continue;
          lab[a] = q;
          if (est(lab, q, pad).ok && est(lab, p, pad).ok) { moved = true; break; }
          lab[a] = p;
        }
      }
      if (!moved) return;
    }
  }
  const cutsOf = (lab: Int32Array) => cands.filter((c: any) => lab[c.a] !== lab[c.b]).length;

  function search(pad: number) {
    const rnd = rng(P.seed * 7919 + 17);
    const sphere = G ? ctx.area : 4 * Math.PI * R * R, bedArea = (bx * by) / (k * k);
    const Kest = Math.max(2, Math.ceil(sphere / (bedArea * 0.75)));
    let best: { lab: Int32Array; np: number; nc: number } | null = null;
    for (let K = Math.max(2, Math.floor(Kest * 0.6)); K <= Kest + 4; K++) {
      for (let r = 0; r < C.restarts; r++) {
        const lab = kmeans(K, rnd);
        fixConn(lab);
        let fresh = K;
        for (let guard = 0; guard < 200; guard++) {
          const bad = [...new Set(lab)].filter((q) => !est(lab, q, pad).ok);
          if (!bad.length) break;
          for (const q of bad) split(lab, q, fresh++, rnd);
        }
        mergePass(lab, pad); dissolve(lab, pad); improve(lab, pad); mergePass(lab, pad); dissolve(lab, pad); improve(lab, pad);
        const labels = [...new Set(lab)];
        if (labels.some((q) => !connected(lab, q) || !est(lab, q, pad).ok)) continue;
        const np = labels.length, nc = cutsOf(lab);
        if (!best || np < best.np || (np === best.np && nc < best.nc)) best = { lab: lab.slice(), np, nc };
      }
    }
    if (process.env.PANEL_DEBUG) console.error('поиск: поле', pad, 'мм, оценка', Kest, '→', best ? `${best.np} панелей, ${best.nc} швов` : 'нет');
    return best;
  }

  // ── номер панели: цифры из скруглённых штрихов (как на табло), с уклоном под формовку ──
  const L = C.label;
  const SEG: Record<string, number[]> = { a: [0, 2, 1, 2], b: [1, 2, 1, 1], c: [1, 1, 1, 0], d: [0, 0, 1, 0], e: [0, 0, 0, 1], f: [0, 1, 0, 2], g: [0, 1, 1, 1] };
  const DIG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];
  const strokes = (text: string, h: number) => {
    const w = h / 2, gap = h * 0.35, total = text.length * w + (text.length - 1) * gap, list: number[][] = [];
    [...text].forEach((ch, i) => {
      const x0 = -total / 2 + i * (w + gap);
      for (const sg of DIG[+ch]) { const [ax, ay, qx, qy] = SEG[sg]; list.push([x0 + ax * w, -h / 2 + (ay * h) / 2, x0 + qx * w, -h / 2 + (qy * h) / 2]); }
    });
    list.push([total / 2 + gap * 0.6, -h / 2, total / 2 + gap * 0.6, -h / 2]);   // точка-низ
    return { list, w: total + gap * 0.6 };
  };
  // место под номер: на внутренней плоской части перепонки, подальше от кромок дыр и от резов;
  // цифры читаются изнутри шара, «верх» — к полюсу
  function placeLabel(text: string, myNodes: number[], myCuts: V3[]) {
    const { Rin, metalU } = ctx, rb = L.stroke_mm / 2, scaleU = G ? 1 : Rin / Rm;
    for (let h = L.height_mm; h >= L.min_height_mm - 1e-9; h -= 1) {
      const { w } = strokes(text, h), hx = w / 2 + rb, hy = h / 2 + rb;
      let best: any = null;
      for (const n of myNodes) {
        const nd = nodes[n];
        const pIn = inner(nd), n0 = nrm(nd);
        if ((G ? Math.hypot(pIn[0], pIn[1]) : Math.min(angle(nd, [0, 0, 1]), ctx.bottomSeat ? angle(nd, [0, 0, -1]) : 9) * Rin) < seatR + Math.hypot(hx, hy) + 6) continue;   // не на площадках полюсов
        const [t1, t2] = tangentBasis(G ? n0 : nd);
        for (const [ox, oy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3], [8, 0], [-8, 0], [0, 8], [0, -8]]) {
          const c = G ? n0 : norm(add(mul(nd, Rin), add(mul(t1, ox), mul(t2, oy))));
          const cp = G ? add(pIn, add(mul(t1, ox), mul(t2, oy))) : mul(c, Rin);
          if (myCuts.some((m) => len(sub(G ? inner(m) : mul(m, Rin), cp)) < Math.hypot(hx, hy) + 4)) continue;
          let up = sub([0, 0, 1], mul(c, c[2]));
          up = len(up) < 1e-6 ? t1 : norm(up);
          const right0 = cross(c, up);
          for (const deg of [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90]) {
            const ph = (deg * Math.PI) / 180, cs = Math.cos(ph), sn = Math.sin(ph);
            const upR = add(mul(up, cs), mul(right0, -sn)), rightR = add(mul(right0, cs), mul(up, sn));
            let clear = Infinity;
            for (let i = 0; i <= 4 && clear >= 0; i++) for (let j = 0; j <= 4; j++) {
              const p = add(cp, add(mul(rightR, -hx + (hx * i) / 2), mul(upR, -hy + (hy * j) / 2)));
              const wd = norm(p);
              clear = Math.min(clear, metalU(wd[0], wd[1], wd[2]) * scaleU - L.edge_clear_mm);   // запас до края дыры
            }
            const score = clear - 0.02 * Math.abs(deg);
            if (clear >= 0 && (!best || score > best.score)) best = { score, c, cp, up: upR, right: rightR, h };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
  function labelSolid(text: string, pl: any) {
    const re = ctx.re, uu = Math.min(L.edge_clear_mm, re);
    const sink = 0.5 + (re > 0 ? re - Math.sqrt(re * re - (re - uu) * (re - uu)) : 0);
    const rb = L.stroke_mm / 2, rt = rb * 0.6, hz = L.relief_mm;
    const cyl = (x: number, y: number) => Manifold.cylinder(hz + sink, rb, rt, 16).translate([x, y, -sink]);
    const solid = Manifold.union(strokes(text, pl.h).list.map(([x1, y1, x2, y2]) => Manifold.hull([cyl(x1, y1), cyl(x2, y2)] as any)));
    const n: V3 = mul(pl.c, -1), o: V3 = G ? pl.cp : mul(pl.c, ctx.Rin), r: V3 = pl.right, u: V3 = pl.up;   // рельеф — внутрь
    return solid.transform([r[0], r[1], r[2], 0, u[0], u[1], u[2], 0, n[0], n[1], n[2], 0, o[0], o[1], o[2], 1] as any);
  }

  // ── 5. разрез и проверка по настоящей геометрии (если оценка ошиблась — поле шире и заново) ──
  let pad = C.est_pad_mm;
  for (let attempt = 0; attempt < 4; attempt++) {
    const best = search(pad);
    if (!best) throw new Error('раскладка на панели не найдена');
    const lab = best.lab;
    const labels = [...new Set(lab)];
    // порядок сборки = номер панели: P01 — верхняя (с площадкой), каждая следующая — та, у которой
    // больше всего швов с уже собранными; при равенстве — что выше
    const between = new Map<string, number>();
    for (const c of [...cands, ...beltCuts]) { const p = lab[c.a], q = lab[c.b]; if (p !== q) { const key = p < q ? `${p},${q}` : `${q},${p}`; between.set(key, (between.get(key) ?? 0) + 1); } }
    const seamsBetween = (p: number, q: number) => between.get(p < q ? `${p},${q}` : `${q},${p}`) ?? 0;
    const zOf = new Map(labels.map((q) => [q, est(lab, q, pad).axis[2]]));
    const order = [lab[poleA]], rest = new Set(labels.filter((q) => q !== lab[poleA]));
    while (rest.size) {
      let bq = -1, bs = -1, bzz = -2;
      for (const q of rest) {
        let sN = 0;
        for (const p of order) sN += seamsBetween(p, q);
        const z = zOf.get(q)!;
        if (sN > bs || (sN === bs && z > bzz)) { bq = q; bs = sN; bzz = z; }
      }
      order.push(bq); rest.delete(bq);
    }
    const idOf = new Map(order.map((q, i) => [q, i]));
    const n0 = ctx.numStart ?? 1;                            // «Двойной»: номера нижнего шара продолжают верхний
    const pid = (i: number) => `P${String(i + n0).padStart(2, '0')}`;
    const nodePanel = new Int32Array(nN);
    for (let a = 0; a < nA; a++) for (const n of aNodes[a]) nodePanel[n] = idOf.get(lab[a])!;

    const cuts = [...cands.filter((c: any) => lab[c.a] !== lab[c.b]), ...beltCuts];
    const slabs = cuts.map((c: any) => {
      const e = c.e, t: V3 = e.tan, n: V3 = G ? e.n : e.m, g = cross(n, t), p = G ? add(surf(e.m), mul(g, e.off ?? 0)) : mul(n, Rm);
      const box = Manifold.cube([C.kerf_mm, Math.max(e.w, e.wReal ?? 0) + 6, T + 6], true);
      return box.transform([t[0], t[1], t[2], 0, g[0], g[1], g[2], 0, n[0], n[1], n[2], 0, p[0], p[1], p[2], 1] as any);
    });
    const cutBody = ctx.body.subtract(Manifold.union(slabs));
    const parts = cutBody.decompose();

    // каждая часть — к панели, чьи узлы ей ближе всего (голосование по вершинам)
    const pieces = parts.map((m: any) => {
      const mesh = m.getMesh(), np = mesh.numProp, vp = mesh.vertProperties, nv = vp.length / np;
      const votes = new Map<number, number>();
      const stepV = Math.max(1, Math.floor(nv / 500));
      for (let v = 0; v < nv; v += stepV) {
        const w = norm([vp[v * np], vp[v * np + 1], vp[v * np + 2]]);
        let bn = 0, bd = -2;
        for (let n = 0; n < nN; n++) { const d = dot(w, nodes[n]); if (d > bd) { bd = d; bn = n; } }
        votes.set(nodePanel[bn], (votes.get(nodePanel[bn]) ?? 0) + 1);
      }
      return { m, id: [...votes].sort((x, y) => y[1] - x[1])[0][0], vol: m.volume() };
    });
    const main = pieces.filter((p: any) => p.vol > 1000);           // > 1 см³
    if (pieces.length !== main.length) warn.push(`отрезались мелкие кусочки: ${pieces.length - main.length}`);
    const byId = new Map<number, any>();
    for (const p of main) {
      if (byId.has(p.id)) throw new Error(`панель ${p.id + 1} распалась на части — рез прошёл не там`);
      byId.set(p.id, p);
    }
    if (byId.size !== labels.length) {
      if (process.env.PANEL_DEBUG) for (let i = 0; i < labels.length; i++) if (!byId.has(i)) {
        const my = cuts.filter((c: any) => nodePanel[c.e.n1] === i || nodePanel[c.e.n2] === i);
        console.error('нет панели', pid(i), 'узлов', [...nodePanel].filter((x) => x === i).length, 'резов', my.length,
          JSON.stringify(my.map((c: any) => [c.e.belt ? 'пояс' : 'рез', +c.e.w.toFixed(1), Math.round(surf(c.e.m)[2])])));
      }
      if (process.env.PANEL_DEBUG) console.error('мелкие куски:', pieces.filter((q: any) => q.vol <= 1000).map((q: any) => Math.round(q.vol)));
      throw new Error(`панелей по раскладке ${labels.length}, по геометрии ${byId.size}`);
    }

    // номер панели — выпуклые цифры на внутренней стороне перепонки (отливаются вместе с панелью)
    const noLabel: string[] = [];
    if (L?.enabled) for (let i = 0; i < order.length; i++) {
      const pn = byId.get(i);
      const myNodes: number[] = [];
      for (let n = 0; n < nN; n++) if (nodePanel[n] === i) myNodes.push(n);
      const myCuts: V3[] = cuts.filter((c: any) => nodePanel[c.e.n1] === i || nodePanel[c.e.n2] === i).map((c: any) => c.e.m);
      const text = String(i + n0).padStart(2, '0');
      const pl = placeLabel(text, myNodes, myCuts);
      if (!pl) { noLabel.push(pid(i)); continue; }
      pn.m = pn.m.add(labelSolid(text, pl));
      pn.vol = pn.m.volume();
      pn.label = `«${text}» изнутри, высота цифр ${pl.h} мм`;
      pn.labelAt = G ? norm(pl.cp) : pl.c;
    }
    if (noLabel.length) warn.push(`номер не поместился на перепонку: ${noLabel.join(', ')} — пометить вручную`);

    // укладка на стол: ось панели вверх (купол вверх), поворот с наибольшим запасом, ×усадка
    let worst = 0;
    const panels = order.map((_, i) => {
      const { m, vol, label, labelAt } = byId.get(i);
      const mesh = m.getMesh(), np = mesh.numProp, vp = mesh.vertProperties;
      let s: V3 = [0, 0, 0];
      for (let o = 0; o < vp.length; o += np) s = add(s, [vp[o], vp[o + 1], vp[o + 2]]);
      const ax = norm(s), [u, v] = tangentBasis(ax);
      const p2: V2[] = [];
      for (let o = 0; o < vp.length; o += np) { const p: V3 = [vp[o], vp[o + 1], vp[o + 2]]; p2.push([dot(p, u), dot(p, v)]); }
      const f = fitRect(hull2(p2), bx, by, 0, k, 1);
      let pm = m.transform([u[0], v[0], ax[0], 0, u[1], v[1], ax[1], 0, u[2], v[2], ax[2], 0, 0, 0, 0, 1] as any)
        .rotate([0, 0, -f.deg]).scale(k);
      const bb = pm.boundingBox();
      pm = pm.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]);
      const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      worst = Math.max(worst, size[0] / bx, size[1] / by, size[2] / bz);
      return { id: pid(i), view: m, print: pm, vol, size, axis: ax, label: label ?? 'нет', labelAt,
        cuts: cuts.filter((c: any) => nodePanel[c.e.n1] === i || nodePanel[c.e.n2] === i).length };
    });
    if (worst > 1) {                                            // оценка по скелету оказалась тесной
      pad += (worst - 1) * Math.max(bx, by) / (2 * k) + 1;
      warn.length = 0;
      continue;
    }
    // шаги сборки и швы в порядке сварки: на шаге i варятся швы новой панели с уже собранными
    const steps: any[] = [], seams: any[] = [];
    for (let i = 0; i < order.length; i++) {
      const mine = cuts.filter((c: any) => { const p = nodePanel[c.e.n1], q = nodePanel[c.e.n2]; return (p === i && q < i) || (q === i && p < i); });
      const to = [...new Set<number>(mine.map((c: any) => Math.min(nodePanel[c.e.n1], nodePanel[c.e.n2])))].sort((x, y) => x - y);
      const ids: string[] = [];
      for (const j of to) for (const c of mine.filter((c: any) => Math.min(nodePanel[c.e.n1], nodePanel[c.e.n2]) === j)) {
        const id = `S${String(seams.length + 1).padStart(2, '0')}`;
        ids.push(id);
        seams.push({ id, шаг: i + 1, панели: [pid(j), pid(i)], ...(c.e.belt ? { пояс: true } : {}), 'ребро в месте реза, мм': +c.e.w.toFixed(1),
          точка: surf(c.e.m).map((x: number) => +x.toFixed(1)) });
      }
      steps.push({ шаг: i + 1, панель: pid(i), к: to.map(pid), швы: ids.length ? `${ids[0]}–${ids[ids.length - 1]}` : '—', швов: ids.length });
    }
    const volSum = panels.reduce((s, p) => s + p.vol, 0);
    const labelNote = L?.enabled
      ? `выпуклые цифры ${L.relief_mm} мм на внутренней стороне перепонки, штрих ${L.stroke_mm} мм; после сварки можно сошлифовать`
      : 'выключено';
    return { panels, seams, steps, warn, shrink: k, volSum, pad, labelNote };
  }
  throw new Error('панели не влезают в стол даже с запасом — нужна опока/стол больше или другие ручки');
}
