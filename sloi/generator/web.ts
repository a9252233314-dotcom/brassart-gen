/** Вход для браузера: то же ядро, что в цеху. Собирается esbuild в один файл для страницы. */
import { build } from './sloi-core.ts';
(globalThis as any).SLOI = { build };
