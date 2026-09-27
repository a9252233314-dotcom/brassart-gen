/** Запись бинарного STL. scale: 1 — миллиметры (печать), 0.001 — метры (Blender, 1 BU = 1 м). */
import { writeFileSync } from 'node:fs';

export function writeStl(path: string, mesh: any, scale: number, title: string) {
  const np = mesh.numProp, vp = mesh.vertProperties, tv = mesh.triVerts;
  const ntri = tv.length / 3;
  const buf = Buffer.alloc(84 + ntri * 50);
  buf.write(`Brass Art ${title}`.slice(0, 79), 0);
  buf.writeUInt32LE(ntri, 80);
  for (let t = 0; t < ntri; t++) {
    const o = 84 + t * 50;
    for (let k = 0; k < 3; k++) {
      const v = tv[t * 3 + k];
      for (let c = 0; c < 3; c++) buf.writeFloatLE(vp[v * np + c] * scale, o + 12 + k * 12 + c * 4);
    }
  }
  writeFileSync(path, buf);
  return ntri;
}
