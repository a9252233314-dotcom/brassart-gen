/**
 * Brass Art — генератор CELL, запуск в цеху: изделие → STL, паспорт, панели под печать, шаблон гиба рожка.
 * Сама геометрия — в core.ts (то же ядро работает на сайте).
 *
 * Запуск:  node generate.ts ../params.json ../out
 */
import Module from 'manifold-3d';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from './core.ts';
import { cutPanels } from './panels.ts';
import { writeStl } from './stl.ts';

async function main() {
  const [paramsPath = '../params.json', outDir = '../out'] = process.argv.slice(2);
  const P = JSON.parse(readFileSync(resolve(paramsPath), 'utf8'));
  const wasm = await Module();
  wasm.setup();
  const { body, passport: base, tag, warn, massOf, panelCtx, L, armDeg, t0 } = build(P, wasm);

  // ── 7. вывод: изделие целиком ──
  mkdirSync(resolve(outDir), { recursive: true });
  const ntri = writeStl(join(resolve(outDir), `${tag}.stl`), body.getMesh(), 0.001, tag);   // метры (1 BU = 1 м)

  // ── 8. панели под печать мастер-моделей ──
  let panelInfo: any = 'выключено (panels.enabled = false)';
  if (P.panels?.enabled) {
    const res = cutPanels(panelCtx());
    warn.push(...res.warn);

    const pdir = join(resolve(outDir), `${tag}.panels`);
    rmSync(pdir, { recursive: true, force: true });
    mkdirSync(join(pdir, 'print'), { recursive: true });
    mkdirSync(join(pdir, 'view'), { recursive: true });
    const rows = res.panels.map((p: any) => {
      writeStl(join(pdir, 'print', `${p.id}.stl`), p.print.getMesh(), 1, `${tag} ${p.id} mm x${res.shrink}`);   // мм, с усадкой
      writeStl(join(pdir, 'view', `${p.id}.stl`), p.view.getMesh(), 0.001, `${tag} ${p.id} view`);              // метры, на месте
      return { id: p.id, 'масса, кг': +massOf(p.vol).toFixed(2), 'печать, мм': p.size.map((x: number) => Math.round(x)), швов: p.cuts, номер: p.label,
        'номер, направление': p.labelAt ? p.labelAt.map((x: number) => +x.toFixed(4)) : null, 'центр, направление': p.axis.map((x: number) => +x.toFixed(4)) };
    });
    const heavy = rows.reduce((a: any, b: any) => (b['масса, кг'] > a['масса, кг'] ? b : a));
    const big = Math.max(...res.panels.map((p: any) => Math.max(p.size[0], p.size[1])));
    panelInfo = {
      панелей: rows.length, швов: res.seams.length,
      'самая тяжёлая': `${heavy.id}, ${heavy['масса, кг']} кг`,
      'наибольший размер на столе, мм': Math.round(big),
      'стол, мм': P.panels.bed_mm, 'усадка, %': P.panels.shrink_pct,
      'потеря на резах, г': Math.round((body.volume() - res.volSum) / 1000 * P.brass_density_g_cm3),
      файлы: `${tag}.panels/print/*.stl (мм, с усадкой) · view/*.stl (м, на месте) · panels.json`,
    };
    panelInfo['номера на панелях'] = res.labelNote;
    writeFileSync(join(pdir, 'panels.json'), JSON.stringify({ изделие: tag, ...panelInfo, сборка: res.steps, панели: rows, швы: res.seams }, null, 2));
  }

  const passport = { ...base, треугольников: ntri, панели: panelInfo, 'время, с': +((Date.now() - t0) / 1000).toFixed(1), предупреждения: warn };
  writeFileSync(join(resolve(outDir), `${tag}.passport.json`), JSON.stringify(passport, null, 2));
  writeFileSync(join(resolve(outDir), `${tag}.rozhok_1to1.svg`), bendTemplate(L, armDeg, tag));
  console.log(JSON.stringify(passport, null, 2));
}

function bendTemplate(L: any, deg: number, tag: string) {
  const rb = L.arm_bend_radius, D = L.arm_tube_d, th = (deg * Math.PI) / 180, arc = rb * th, a = (L.arm_length - arc) / 2;
  const ox = 40, oy = 60, cx = ox + a, cy = oy + rb, pts: [number, number][] = [[ox, oy], [ox + a, oy]];
  for (let k = 1; k <= 40; k++) { const t = (th * k) / 40; pts.push([cx + rb * Math.sin(t), cy - rb * Math.cos(t)]); }
  const [ex, ey] = pts[pts.length - 1]; pts.push([ex + a * Math.cos(th), ey + a * Math.sin(th)]);
  const path = 'M ' + pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ');
  let ruler = '';
  for (let i = 0; i <= 10; i++) ruler += `<line x1="${15 + i * 10}" y1="267" x2="${15 + i * 10}" y2="273" stroke="#000" stroke-width="0.3"/><text x="${14 + i * 10}" y="279" font-size="3">${i * 10}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" font-family="Arial">
<text x="15" y="18" font-size="6" font-weight="bold">Рожок — шаблон гиба 1:1 · ${tag}</text>
<text x="15" y="26" font-size="4">Труба латунь Ø${D}, M10 в кольцо. Печатать 100%, без «подогнать по размеру». Проверь линейку ниже.</text>
<path d="${path}" fill="none" stroke="#ccc" stroke-width="${D}" stroke-linejoin="round"/>
<path d="${path}" fill="none" stroke="#000" stroke-width="0.4" stroke-dasharray="3,1.5"/>
<line x1="${ox}" y1="${oy - 12}" x2="${ox}" y2="${oy + 12}" stroke="#c00" stroke-width="0.6"/>
<text x="${ox - 3}" y="${oy - 14}" font-size="3.5" fill="#c00">стенка кольца</text>
${deg > 0 ? `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.8"/><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rb}" fill="none" stroke="#999" stroke-width="0.25" stroke-dasharray="1,1"/><text x="${(cx + 2).toFixed(1)}" y="${(cy + 2).toFixed(1)}" font-size="3.5">центр гиба, R${rb} по оси трубы</text>` : ''}
<text x="${ox}" y="${oy + 34}" font-size="4">прямо ${a.toFixed(0)} мм → гиб ${deg}° R${rb} (по оси ${arc.toFixed(0)} мм) → прямо ${a.toFixed(0)} мм до патрона; вся ось ${L.arm_length} мм</text>
<text x="${ox}" y="${oy + 41}" font-size="4">+ резьбовой хвост M10 в кольцо и под патрон — по месту</text>
<line x1="15" y1="270" x2="115" y2="270" stroke="#000" stroke-width="0.5"/>${ruler}
<text x="15" y="287" font-size="3.5">проверка: от 0 до 100 должно быть ровно 100 мм</text>
</svg>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
