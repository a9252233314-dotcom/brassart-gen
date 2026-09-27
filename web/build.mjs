// Сборка живой демо-страницы index.html (для GitHub Pages): шаблон + ядро генератора + manifold (wasm вшит) + params.json.
// Запуск из корня репозитория:  node web/build.mjs   (нужны generator/node_modules — `cd generator && npm i`)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npx --yes esbuild web.ts --bundle --format=iife --target=es2020 --outfile=../web/cell-core.js --log-level=warning', { cwd: 'generator', stdio: 'inherit' });

const core = readFileSync('web/cell-core.js', 'utf8');
let mj = readFileSync('generator/node_modules/manifold-3d/manifold.js', 'utf8');
if (!mj.includes('export default Module;')) throw new Error('manifold.js: не найден export default Module');
mj = mj.replace('export default Module;', 'window.ManifoldModule = Module;');
const wasm = readFileSync('generator/node_modules/manifold-3d/manifold.wasm').toString('base64');
const params = readFileSync('params.json', 'utf8');
const safe = (s) => s.replaceAll('</script', '<\\/script');

const t = readFileSync('web/page_template.html', 'utf8')
  .replace('/*__CELL_CORE__*/', () => safe(core))
  .replace('/*__MANIFOLD_JS__*/', () => safe(mj))
  .replace('/*__MANIFOLD_WASM__*/', () => wasm)
  .replace('/*__PARAMS__*/', () => JSON.stringify(JSON.parse(params)));

// шаблон — содержимое страницы без <head>/<body>: всё до конца <style> уходит в head
const cut = t.indexOf('</style>') + '</style>'.length;
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Brass Art · CELL — генеративная латунная люстра: форма, узор, ширина и лампы собираются прямо в браузере.">
${t.slice(0, cut)}
</head>
<body>
${t.slice(cut)}
</body>
</html>
`;
writeFileSync('index.html', html);
console.log('index.html:', Math.round(html.length / 1024), 'КБ');
