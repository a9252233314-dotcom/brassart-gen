// Сборка живой демо-страницы: шаблон + three.js + ядро генератора + manifold (wasm вшит) + params.json.
// Всё в одном файле — со сторонних серверов ничего не грузится, кроме шрифтов (они не задерживают страницу).
// Запуск из папки, где лежат generator/, web/, params.json:  node web/build.mjs
//   → index.html          (целая страница — для GitHub Pages)
//   → web/cell-demo.html  (без <head>/<body> — для закрытой страницы claude.ai)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npx --yes esbuild web.ts --bundle --format=iife --target=es2020 --outfile=../web/cell-core.js --log-level=warning', { cwd: 'generator', stdio: 'inherit' });

const nm = 'generator/node_modules/';
const safe = (s) => s.replaceAll('</script', '<\\/script');
const three = ['three/build/three.min.js', 'three/examples/js/controls/OrbitControls.js', 'three/examples/js/environments/RoomEnvironment.js']
  .map((f) => readFileSync(nm + f, 'utf8')).join('\n;\n');
let mj = readFileSync(nm + 'manifold-3d/manifold.js', 'utf8');
if (!mj.includes('export default Module;')) throw new Error('manifold.js: не найден export default Module');
mj = mj.replace('export default Module;', 'self.ManifoldModule = Module;');
const wasm = readFileSync(nm + 'manifold-3d/manifold.wasm').toString('base64');
const core = readFileSync('web/cell-core.js', 'utf8');
const params = JSON.stringify(JSON.parse(readFileSync('params.json', 'utf8')));

const page = readFileSync('web/page_template.html', 'utf8')
  .replace('/*__THREE__*/', () => safe(three))
  .replace('/*__MANIFOLD_JS__*/', () => safe(mj))
  .replace('/*__CELL_CORE__*/', () => safe(core))
  .replace('/*__MANIFOLD_WASM__*/', () => wasm)
  .replace('/*__PARAMS__*/', () => params);
writeFileSync('web/cell-demo.html', page);

// целая страница: всё до конца <style> — в head
const cut = page.indexOf('</style>') + '</style>'.length;
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Brass Art · CELL — генеративная латунная люстра: форма, узор, ширина и лампы собираются прямо в браузере.">
${page.slice(0, cut)}
</head>
<body>
${page.slice(cut)}
</body>
</html>
`;
writeFileSync('index.html', html);
console.log('index.html:', Math.round(html.length / 1024), 'КБ · web/cell-demo.html:', Math.round(page.length / 1024), 'КБ');
