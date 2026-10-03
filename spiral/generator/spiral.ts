/**
 * Brass Art — генератор СПИРАЛЬ, запуск в цеху: вид в сборе (STL), развёртки полос ленты 1:1 (SVG), паспорт.
 * Геометрия — в spiral-core.ts.   Запуск:  node spiral.ts ../params.json ../out/v01
 */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeStl } from '../../generator/stl.ts';
import { build } from './spiral-core.ts';

const [paramsPath = '../params.json', outDir = '../out/v01'] = process.argv.slice(2);
const P = JSON.parse(readFileSync(resolve(paramsPath), 'utf8'));
const wasm = await Module(); wasm.setup();
const { Manifold } = wasm;
const out = resolve(outDir);
for (const d of ['view', 'strips']) mkdirSync(join(out, d), { recursive: true });
const B = build(P, wasm);
const W = (name: string, m: any) => writeStl(join(out, 'view', name + '.stl'), m.getMesh(), 0.001, 'SPIRAL ' + name);
W('band', B.band); W('column', B.column); W('rod', B.rod); W('cup', B.cup); W('finial', B.finial);
W('arms', Manifold.compose(B.arms)); W('inserts', Manifold.compose(B.inserts));
W('sockets', Manifold.compose(B.lamps.map((l) => l.socket))); W('bulbs', Manifold.compose(B.lamps.map((l) => l.bulb)));

// развёртки: полоса 1:1, отверстия Ø4.5 под M4 (пластина рожка), стыки полос — под пластиной
B.strips.forEach((st, i) => {
  const xs = st.outline.map((p) => p[0]), ys = st.outline.map((p) => p[1]);
  const x0 = Math.min(...xs), y1 = Math.max(...ys), pad = 20, Wd = Math.max(...xs) - x0 + 2 * pad, Ht = y1 - Math.min(...ys) + 2 * pad + 20;
  const X = (x: number) => x - x0 + pad, Y = (y: number) => y1 - y + pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd.toFixed(1)}mm" height="${Ht.toFixed(1)}mm" viewBox="0 0 ${Wd.toFixed(1)} ${Ht.toFixed(1)}">
<rect width="100%" height="100%" fill="#fff"/>
<polygon points="${st.outline.map((p) => `${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(' ')}" fill="none" stroke="#000" stroke-width="0.3"/>
${st.holes.map((h) => `<circle cx="${X(h[0]).toFixed(2)}" cy="${Y(h[1]).toFixed(2)}" r="2.25" fill="none" stroke="#c33" stroke-width="0.3"/>`).join('\n')}
<text x="${pad}" y="${Ht - 6}" font-size="5" font-family="Arial">СПИРАЛЬ · полоса ${i + 1} из ${B.strips.length} · лист ${P.band.sheet_grade} ${P.band.wall} мм · длина ${(st.sb - st.sa).toFixed(0)} мм · 1:1 · отверстия Ø4.5 — пластины рожков (M4)</text>
</svg>`;
  writeFileSync(join(out, 'strips', `strip_${i + 1}.svg`), svg);
});
writeFileSync(join(out, 'passport.json'), JSON.stringify({ ...B.passport, warn: B.warn }, null, 2));
console.log(JSON.stringify(B.passport, null, 1));
console.log('проверки:', B.warn.length ? B.warn.join(' | ') : 'все пройдены');
