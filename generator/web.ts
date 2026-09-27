/** Вход для браузера: то же ядро, что в цеху. Собирается esbuild в один файл для сайта. */
import { build } from './core.ts';
(globalThis as any).CELL = { build };
