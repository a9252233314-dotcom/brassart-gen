/**
 * Brass Art — генератор СЛОИ, запуск в цеху: вид в сборе (STL), чертежи половин тарелок 1:1 для вытяжника (SVG), паспорт.
 * Геометрия — в sloi-core.ts.   Запуск:  node sloi.ts ../params.json ../out/v01
 */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeStl } from '../../generator/stl.ts';
import { build } from './sloi-core.ts';

const [paramsPath = '../params.json', outDir = '../out/v01'] = process.argv.slice(2);
const P = JSON.parse(readFileSync(resolve(paramsPath), 'utf8'));
const wasm = await Module(); wasm.setup();
const { Manifold } = wasm;
const out = resolve(outDir);
for (const d of ['view', 'drawings']) mkdirSync(join(out, d), { recursive: true });
const B = build(P, wasm);
const W = (name: string, m: any) => writeStl(join(out, 'view', name + '.stl'), m.getMesh(), 0.001, 'SLOI ' + name);
W('plates', Manifold.compose(B.plates)); W('nuts', Manifold.compose(B.parts)); W('axis', B.axis); W('finial', B.finial); W('cup', B.cup);
W('sockets', Manifold.compose(B.lamps.map((l) => l.socket))); W('bulbs', Manifold.compose(B.lamps.map((l) => l.bulb)));

// чертёж половины 1:1: профиль от оси (слева) до кромки, ось вращения штрихпунктиром, размеры
const PL = P.plate;
for (const D of B.sizes) for (const top of [true, false]) {
  const { h, pts } = B.halfProfile(D / 2, top), R = D / 2 + PL.rim_flange, pad = 30, sx = (r: number) => pad + r, H = h + 2 * pad + 60;
  const sy = (z: number) => pad + 40 + (top ? h - z : -z);
  const line = pts.map(([r, z]) => `${sx(r).toFixed(2)},${sy(z).toFixed(2)}`).join(' ');
  const name = `тарелка Ø${D} — ${top ? 'КОЛПАК (верх)' : 'ЧАША (низ)'}`;
  const txt = [
    `${name} · лист латунь ${PL.sheet} мм · ротационная вытяжка · масштаб 1:1 (мм)`,
    `кромка Ø${D}, поясок до Ø${D + 2 * PL.rim_flange} (колпак ложится на чашу, без пайки) · конус ${top ? PL.top_slope_deg : PL.bottom_slope_deg}° · высота ${h.toFixed(1)} · площадка Ø${2 * PL.center_flat_r}, отверстие Ø${PL.hole_d}`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${R + 2 * pad}mm" height="${H}mm" viewBox="0 0 ${R + 2 * pad} ${H}">
<rect width="100%" height="100%" fill="#fff"/>
<line x1="${sx(0)}" y1="${pad}" x2="${sx(0)}" y2="${H - pad / 2}" stroke="#c33" stroke-width="0.3" stroke-dasharray="6 2 1 2"/>
<text x="${sx(0) + 2}" y="${pad + 4}" font-size="3.5" fill="#c33">ось вращения</text>
<polyline points="${line}" fill="none" stroke="#000" stroke-width="${PL.sheet}"/>
<line x1="${sx(D / 2)}" y1="${sy(0) + 8}" x2="${sx(D / 2)}" y2="${sy(0) + 14}" stroke="#555" stroke-width="0.25"/>
${txt.map((s, i) => `<text x="${pad}" y="${H - 14 + i * 6}" font-size="4" font-family="Arial">${s}</text>`).join('\n')}
</svg>`;
  writeFileSync(join(out, 'drawings', `plate_${D}_${top ? 'top' : 'bottom'}.svg`), svg);
}
writeFileSync(join(out, 'passport.json'), JSON.stringify({ ...B.passport, warn: B.warn }, null, 2));
console.log(JSON.stringify(B.passport, null, 1));
console.log('проверки:', B.warn.length ? B.warn.join(' | ') : 'все пройдены');
