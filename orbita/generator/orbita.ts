/**
 * Brass Art — генератор ОРБИТА, запуск в цеху: изделие → STL (вид в сборе), мастер-модели ленты и лодочки под печать, паспорт.
 * Геометрия — в orbita-core.ts (то же ядро пойдёт на сайт).
 *
 * Запуск:  node orbita.ts ../params.json ../out/v01
 */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeStl } from '../../generator/stl.ts';
import { build } from './orbita-core.ts';

type V3 = [number, number, number];
const D2R = Math.PI / 180;

async function main() {
  const [paramsPath = '../params.json', outDir = '../out/v01'] = process.argv.slice(2);
  const P = JSON.parse(readFileSync(resolve(paramsPath), 'utf8'));
  const wasm = await Module();
  wasm.setup();
  const { Manifold } = wasm;
  const out = resolve(outDir);
  mkdirSync(join(out, 'view'), { recursive: true });
  mkdirSync(join(out, 'print'), { recursive: true });
  const t0 = Date.now();
  const B = build(P, wasm);
  const { warn, kg, vertsOf, tag } = B;
  // печать: мастер-модель ×(1+усадка). Сначала по съёму (d вверх); не влезает — ищем наклон в объёме стола
  const k = 1 + P.print.shrink_pct / 100, bed = P.print.bed_mm, mg = P.print.margin;
  const lim = [bed[0] - 2 * mg, bed[1] - 2 * mg, bed[2] - mg];
  const rotM = (ax: V3, a: number) => {   // матрица поворота вокруг оси (строки)
    const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  };
  const mm = (A: number[][], B: number[][]) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const toPrint = (man: any, base: number[][]) => {
    const hv = vertsOf(Manifold.hull([man]).getMesh());
    const ext = (Rm: number[][]) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of hv) for (let c = 0; c < 3; c++) { const v = Rm[c][0] * p[0] + Rm[c][1] * p[1] + Rm[c][2] * p[2]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
      return [0, 1, 2].map((c) => (hi[c] - lo[c]) * k);
    };
    let best: { Rm: number[][]; sz: number[]; tilt: number } | null = null;
    for (let tx = 0; tx <= 60; tx += 5) for (let ty = -60; ty <= 60; ty += 5) {
      const tilt = Math.hypot(tx, ty);
      if (best && tilt > best.tilt) continue;
      for (let rz = 0; rz < 180; rz += 3) {
        const Rm = mm(rotM([0, 0, 1], rz * D2R), mm(rotM([0, 1, 0], ty * D2R), mm(rotM([1, 0, 0], tx * D2R), base)));
        const sz = ext(Rm);
        if (sz[0] <= lim[0] && sz[1] <= lim[1] && sz[2] <= lim[2] && (!best || tilt < best.tilt || sz[2] < best.sz[2])) best = { Rm, sz, tilt };
      }
    }
    if (!best) return { pm: null, sz: ext(base), ok: false, tilt: 0 };
    const Rm = best.Rm;
    const mat = [Rm[0][0], Rm[1][0], Rm[2][0], 0, Rm[0][1], Rm[1][1], Rm[2][1], 0, Rm[0][2], Rm[1][2], Rm[2][2], 0, 0, 0, 0, 1];
    let pm = man.transform(mat as any).scale(k);
    const bb = pm.boundingBox();
    pm = pm.translate([-(bb.min[0] + bb.max[0]) / 2, -(bb.min[1] + bb.max[1]) / 2, -bb.min[2]]);
    return { pm, sz: best.sz, ok: true, tilt: best.tilt };
  };
  const fits: any[] = [];
  for (const pc of B.printJobs) {
    const r = toPrint(pc.m, pc.base);
    if (r.pm) writeStl(join(out, 'print', `${pc.name}.stl`), r.pm.getMesh(), 1, `ORBITA ${pc.name}`);
    fits.push({ name: pc.name, what: pc.what, kg: +kg(pc.m.volume()).toFixed(3), size_mm: r.sz.map((v: number) => +v.toFixed(1)), fits: r.ok, tilt_deg: +r.tilt.toFixed(0) });
    if (!r.ok) warn.push(`${pc.name} не влезает в стол ни под каким наклоном: ${r.sz.map((v: number) => v.toFixed(0)).join('×')}`);
  }
  const W = (name: string, m: any) => writeStl(join(out, 'view', `${name}.stl`), m.getMesh(), 0.001, `${tag} ${name}`);
  W('band', B.band); W('ring', B.ring); W('arms', Manifold.compose(B.arms)); W('lodochka', B.lodochka); W('rod', B.rod); W('cup', B.cup); W('clamp', B.clamp);
  W('sockets', Manifold.compose(B.lamps.map((l: any) => l.socket))); W('bulbs', Manifold.compose(B.lamps.map((l: any) => l.bulb)));
  const passport = { ...B.passport, print: fits, warn, build_s: (Date.now() - t0) / 1000 };
  writeFileSync(join(out, 'passport.json'), JSON.stringify(passport, null, 2));
  const { band: bd, ...short } = passport as any;
  console.log(JSON.stringify({ ...short, print: undefined, band: { ...bd, pieces_info: undefined } }, null, 1));
  console.log(fits.map((f) => `${f.name} ${f.size_mm.join('×')} ${f.fits ? 'ок' : 'НЕТ'}${f.tilt_deg ? ` (наклон ${f.tilt_deg}°)` : ''}`).join(' | '));
}
main().catch((e) => { console.error(e); process.exit(1); });
