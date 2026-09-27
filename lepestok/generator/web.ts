/** Вход для браузера: то же ядро, что в цеху. Собирается esbuild в один файл для страницы. */
import { build } from './lepestok-core.ts';
(globalThis as any).LEPESTOK = { build };
