// Сборка сайта brassart-gen: каждое семейство — своя страница с живым генератором, сверху общее меню семейств.
// Всё в одном файле на страницу — со сторонних серверов ничего не грузится, кроме шрифтов.
// Запуск из корня репозитория:  node web/build.mjs
//   → index.html     — CELL (шар-решётка)
//   → lepestok.html  — ЛЕПЕСТОК (лепестки вокруг вазы)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const esb = (cwd, out) => execSync(`npx --yes esbuild web.ts --bundle --format=iife --target=es2020 --outfile=${out} --log-level=warning`, { cwd, stdio: 'inherit' });
esb('generator', '../web/cell-core.js');
esb('lepestok/generator', '../web/lepestok-core.js');

const nm = 'generator/node_modules/';
const safe = (s) => s.replaceAll('</script', '<\\/script');
const three = ['three/build/three.min.js', 'three/examples/js/controls/OrbitControls.js', 'three/examples/js/environments/RoomEnvironment.js']
  .map((f) => readFileSync(nm + f, 'utf8')).join('\n;\n');
let mj = readFileSync(nm + 'manifold-3d/manifold.js', 'utf8');
if (!mj.includes('export default Module;')) throw new Error('manifold.js: не найден export default Module');
mj = mj.replace('export default Module;', 'self.ManifoldModule = Module;');
const wasm = readFileSync(nm + 'manifold-3d/manifold.wasm').toString('base64');
const nav = readFileSync('web/nav.html', 'utf8');

const families = [
  { fam: 'cell', out: 'index.html', tpl: ['web/page_template.html'], core: 'web/cell-core.js', marker: '/*__CELL_CORE__*/', params: 'params.json',
    desc: 'Brass Art · CELL — генеративная латунная люстра: форма, узор, ширина и лампы собираются прямо в браузере.' },
  { fam: 'lepestok', out: 'lepestok.html', tpl: ['lepestok/web/page_template.html', 'lepestok/web/page_body.html'], core: 'lepestok/web/lepestok-core.js',
    marker: '/*__LEP_CORE__*/', params: 'lepestok/params.json',
    desc: 'Brass Art · ЛЕПЕСТОК — генеративная латунная люстра: лепестки в два яруса вокруг гранёной вазы собираются прямо в браузере.' },
];

for (const f of families) {
  const menu = nav.replace(`data-fam="${f.fam}"`, `data-fam="${f.fam}" aria-current="page"`);
  const page = f.tpl.map((p) => readFileSync(p, 'utf8')).join('')
    .replace('<!--__FAMILY_NAV__-->', () => menu)
    .replace('/*__THREE__*/', () => safe(three))
    .replace('/*__MANIFOLD_JS__*/', () => safe(mj))
    .replace(f.marker, () => safe(readFileSync(f.core, 'utf8')))
    .replace('/*__MANIFOLD_WASM__*/', () => wasm)
    .replace('/*__PARAMS__*/', () => JSON.stringify(JSON.parse(readFileSync(f.params, 'utf8'))));
  if (page.includes('__FAMILY_NAV__')) throw new Error(`${f.fam}: в шаблоне нет места под меню`);
  const cut = page.indexOf('</style>') + '</style>'.length;       // всё до конца первого <style> — в head
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${f.desc}">
${page.slice(0, cut)}
</head>
<body>
${page.slice(cut)}
</body>
</html>
`;
  writeFileSync(f.out, html);
  console.log(f.out + ':', Math.round(html.length / 1024), 'КБ');
}
