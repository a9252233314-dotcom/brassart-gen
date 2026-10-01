// Brass Art · сцена для страниц генераторов (общая для всех семейств). Три сцены, переключатель в окне 3D:
//   «Студия»   — невидимые софтбоксы в отражениях металла, тёплый фон, ключевой свет с тенью;
//   «Кабинет»  — классическая столовая: орех, штукатурка, картина, окно в сумерки;
//   «Интерьер» — современная столовая в духе генеративного дизайна: стена из закрученных лент, стекло в пол, травертин.
// В комнатах люстра висит на потолке над столом, светят только её лампы (физические единицы, затухание с расстоянием),
// решётка отбрасывает тени на потолок и стены, латунь отражает саму комнату.
// В обеих: затенение между деталями (запекается на видеокарте после каждой сборки), ореол и свет у каждой лампы,
// медленное вращение, пока никто не трогает. На телефонах — одна лампа с тенью и меньше источников, на совсем слабых — без теней.
// Подключается сборщиком вместо /*__STUDIO__*/.
window.BrassStudio = (() => {
  const weak = matchMedia('(max-width: 860px)').matches || (navigator.deviceMemory || 8) <= 4;
  const tiny = (navigator.deviceMemory || 8) <= 2;                           // совсем слабые — без теней от ламп
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* без памяти */ } } };
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();          // цвет как на образце (hex — в sRGB)
  const rnd = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;     // повторяемый шум: комната всегда одна и та же

  // ── студия ──
  // невидимая «фотостудия» — её видно только в отражениях металла
  function studioEnv() {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: 0x17120e, side: THREE.BackSide })));
    const box = (w, h, color, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); s.add(m);
    };
    box(5, 2.2, 0xfff0dc, 3.0, [0, 6.5, 0.5]);      // верхний софтбокс
    box(2.2, 5.5, 0xffe2bd, 2.2, [-6, 1.2, 3]);     // ключевой слева
    box(1.2, 5.5, 0xffffff, 1.4, [6, 0.6, -2.5]);   // контровой справа
    box(9, 0.7, 0xffcf96, 0.7, [0, -3.2, -6]);      // тёплая полоса снизу-сзади
    box(3, 1.2, 0xfff6ea, 0.9, [2.5, 1.5, 6]);      // мягкий передний
    return s;
  }

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }

  // тёплый тёмный фон с затемнением к краям (лёгкий шум — чтобы на тёмном не было ступенек)
  const backdrop = () => canvasTex(512, 512, (g) => {
    const gr = g.createRadialGradient(256, 220, 20, 256, 256, 380);
    gr.addColorStop(0, '#3a2c20'); gr.addColorStop(0.55, '#1c1611'); gr.addColorStop(1, '#0a0806');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const im = g.getImageData(0, 0, 512, 512), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 3; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(im, 0, 0);
  });

  // ореол вокруг колбы
  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,236,200,1)'); gr.addColorStop(0.2, 'rgba(255,205,140,0.4)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // ── «Кабинет»: классическая столовая — орех, штукатурка, картина, окно в сумерки (мастер 2026-09-30: оставить вариантом) ──
  // рисование с переносом через край — текстура повторяется без шва
  const wrapped = (W, H, x, y, r, f) => { for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) if (x + dx > -r && x + dx < W + r && y + dy > -r && y + dy < H + r) f(x + dx, y + dy); };

  // пол: дубовая доска, тонированная (10 досок на 2.2 м)
  const floorTex = () => canvasTex(1024, 1024, (g, W, H) => {
    const r = rnd(7), N = 10, pw = W / N;
    for (let i = 0; i < N; i++) {
      let s = 0; const o = r() * H;
      while (s < H - 1) {
        let len = H * (0.28 + r() * 0.45); if (H - s - len < H * 0.2) len = H - s;
        const k = 0.85 + r() * 0.3, col = `rgb(${Math.round(80 * k)},${Math.round(62 * k)},${Math.round(49 * k)})`;
        const streaks = Array.from({ length: 30 }, () => [r() * pw, 0.03 + r() * 0.09, r() < 0.55, 0.5 + r() * 1.8, (r() - 0.5) * 8, (r() - 0.5) * 8]);
        const knots = r() < 0.35 ? [[r() * pw, r() * len, 3 + r() * 6]] : [];
        const plank = (y) => {
          g.save(); g.beginPath(); g.rect(i * pw, y, pw, len); g.clip();
          g.fillStyle = col; g.fillRect(i * pw, y, pw, len);
          for (const [x, a, dark, lw, b1, b2] of streaks) {
            g.strokeStyle = dark ? `rgba(30,18,10,${a})` : `rgba(170,130,90,${a * 0.7})`; g.lineWidth = lw;
            g.beginPath(); g.moveTo(i * pw + x, y); g.bezierCurveTo(i * pw + x + b1, y + len / 3, i * pw + x + b2, y + 2 * len / 3, i * pw + x, y + len); g.stroke();
          }
          for (const [x, yy, kr] of knots) { g.fillStyle = 'rgba(40,24,12,0.5)'; g.beginPath(); g.ellipse(i * pw + x, y + yy, kr * 0.6, kr * 1.6, 0, 0, 7); g.fill(); }
          g.fillStyle = 'rgba(18,10,5,0.7)'; g.fillRect(i * pw, y, pw, 1.5); g.fillRect(i * pw, y, 1.2, len);
          g.restore();
        };
        const y = (o + s) % H; plank(y); if (y + len > H) plank(y - H);
        s += len;
      }
    }
  }, [7 / 2.2, 7 / 2.2]);

  // стены: известковая штукатурка тёплого серо-бежевого, мягкие пятна
  const plasterTex = (base, seed) => canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    const r = rnd(seed);
    for (let k = 0; k < 1400; k++) {
      const x = r() * W, y = r() * H, rad = 8 + r() * 60, a = 0.01 + r() * 0.022, light = r() < 0.5;
      wrapped(W, H, x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, `rgba(${light ? '255,248,236' : '96,80,62'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
  }, [3.5, 3]);

  // орех: волокна вдоль длинной стороны
  const walnutTex = (rep) => canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#4b3122'; g.fillRect(0, 0, W, H);
    const r = rnd(23);
    for (let k = 0; k < 220; k++) {
      const y = r() * H, a = 0.05 + r() * 0.12, dark = r() < 0.6, amp = 3 + r() * 10, ph = r() * 6;
      g.strokeStyle = dark ? `rgba(28,16,8,${a})` : `rgba(140,96,62,${a})`; g.lineWidth = 0.6 + r() * 2.2;
      for (const dy of [-H, 0, H]) {
        g.beginPath();
        for (let x = 0; x <= W; x += 16) { const yy = y + dy + amp * Math.sin(x / W * 2 * Math.PI * 2 + ph); x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
        g.stroke();
      }
    }
  }, rep);

  // шерстяной ковёр: песочный с тонкой каймой
  const rugTex = () => canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#8a7f6c'; g.fillRect(0, 0, W, H);
    const r = rnd(5);
    for (let k = 0; k < 9000; k++) { const x = r() * W, y = r() * H, a = 0.04 + r() * 0.07; g.fillStyle = r() < 0.5 ? `rgba(255,245,225,${a})` : `rgba(40,32,22,${a})`; g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2); }
    g.strokeStyle = 'rgba(52,44,34,0.8)'; g.lineWidth = 7; g.strokeRect(22, 22, W - 44, H - 44);
    g.strokeStyle = 'rgba(52,44,34,0.35)'; g.lineWidth = 2; g.strokeRect(38, 38, W - 76, H - 76);
  });

  // картина: тёплая абстракция
  const artTex = () => canvasTex(400, 520, (g, W, H) => {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2d2721'); bg.addColorStop(1, '#1b1714'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#b07a3c'; g.beginPath(); g.arc(W * 0.56, H * 0.42, W * 0.27, 0, 7); g.fill();
    g.fillStyle = 'rgba(214,196,164,0.85)'; g.fillRect(W * 0.18, H * 0.62, W * 0.62, H * 0.035);
    g.strokeStyle = 'rgba(214,196,164,0.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(W * 0.24, H * 0.2); g.lineTo(W * 0.24, H * 0.82); g.stroke();
    const r = rnd(3); for (let k = 0; k < 5000; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,240,220' : '0,0,0'},0.05)`; g.fillRect(r() * W, r() * H, 1, 1); }
  });

  // окно: сумерки, вдали город
  const duskTex = () => canvasTex(256, 512, (g, W, H) => {
    const s = g.createLinearGradient(0, 0, 0, H);
    s.addColorStop(0, '#0e1830'); s.addColorStop(0.45, '#23385e'); s.addColorStop(0.72, '#5e6680'); s.addColorStop(0.78, '#8a7c78'); s.addColorStop(1, '#2a2a33');
    g.fillStyle = s; g.fillRect(0, 0, W, H);
    const r = rnd(9); let x = 0;
    g.fillStyle = '#15161d';
    while (x < W) { const bw = 10 + r() * 34, bh = 20 + r() * 90; g.fillRect(x, H * 0.8 - bh, bw, H * 0.2 + bh); x += bw + r() * 4; }
    for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(255,${180 + Math.round(r() * 40)},110,${0.5 + r() * 0.5})`; g.fillRect(r() * W, H * (0.66 + r() * 0.3), 2, 2); }
  });

  // скруглённая плита: w — по X, d — по Z, h — толщина по Y (снизу вверх от 0)
  function slab(w, d, h, rad, bev) {
    const x = -w / 2 + bev, z = -d / 2 + bev, W = w - 2 * bev, D = d - 2 * bev, q = Math.min(rad, W / 2, D / 2), s = new THREE.Shape();
    s.moveTo(x + q, z); s.lineTo(x + W - q, z); s.quadraticCurveTo(x + W, z, x + W, z + q); s.lineTo(x + W, z + D - q);
    s.quadraticCurveTo(x + W, z + D, x + W - q, z + D); s.lineTo(x + q, z + D); s.quadraticCurveTo(x, z + D, x, z + D - q);
    s.lineTo(x, z + q); s.quadraticCurveTo(x, z, x + q, z);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, h - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 10 });
    g.rotateX(-Math.PI / 2); g.translate(0, bev, 0);
    return g;
  }

  const CABINET = { w: 7, d: 7, h: 3, eye: 1.5 };                    // 7×7 м, потолок 3 м (выше, если люстра длинная)
  function buildCabinet() {
    const room = new THREE.Group();
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const add = (geo, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; room.add(m); return m; };
    const { w: RW, d: RD } = CABINET, WH = 7;                             // стены выше любого потолка — потолок режет их сам
    const floor = add(new THREE.PlaneGeometry(RW, RD), M({ map: floorTex(), roughness: 0.5 }), 0, 0, 0, false); floor.rotation.x = -Math.PI / 2;
    const ceil = add(new THREE.PlaneGeometry(RW, RD), M({ color: lin('#e7e0d4'), roughness: 0.95 }), 0, CABINET.h, 0, false); ceil.rotation.x = Math.PI / 2;
    const wallMat = M({ map: plasterTex('#ae9f8a', 11), roughness: 0.95 });
    const wall = (x, z, ry) => { const m = add(new THREE.PlaneGeometry(RW, WH), wallMat, x, WH / 2, z, false); m.rotation.y = ry; };
    wall(0, -RD / 2, 0); wall(0, RD / 2, Math.PI); wall(-RW / 2, 0, Math.PI / 2); wall(RW / 2, 0, -Math.PI / 2);
    const skirt = M({ color: lin('#d9d0c2'), roughness: 0.6 });                     // плинтус
    add(new THREE.BoxGeometry(RW, 0.09, 0.016), skirt, 0, 0.045, -RD / 2 + 0.008); add(new THREE.BoxGeometry(RW, 0.09, 0.016), skirt, 0, 0.045, RD / 2 - 0.008);
    add(new THREE.BoxGeometry(0.016, 0.09, RD), skirt, -RW / 2 + 0.008, 0.045, 0); add(new THREE.BoxGeometry(0.016, 0.09, RD), skirt, RW / 2 - 0.008, 0.045, 0);

    // окно в дальней стене: сумерки светят сами (яркость — в единицах сцены)
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: duskTex(), roughness: 0.06, metalness: 0 });
    const wx = -1.5, wy = 1.65, ww = 2.4, wh = 2.2, fz = -RD / 2 + 0.02;
    add(new THREE.PlaneGeometry(ww, wh), glass, wx, wy, fz, false);
    const frame = M({ color: lin('#1d1b19'), roughness: 0.45, metalness: 0.4 });
    const bar = (w2, h2, x, y) => add(new THREE.BoxGeometry(w2, h2, 0.07), frame, x, y, fz + 0.035);
    bar(ww + 0.12, 0.06, wx, wy + wh / 2 + 0.03); bar(ww + 0.12, 0.06, wx, wy - wh / 2 - 0.03);
    bar(0.06, wh, wx - ww / 2 - 0.03, wy); bar(0.06, wh, wx + ww / 2 + 0.03, wy); bar(0.045, wh, wx, wy); bar(ww, 0.04, wx, wy + wh * 0.22);
    add(new THREE.BoxGeometry(ww + 0.3, 0.035, 0.22), M({ color: lin('#d6cdbf'), roughness: 0.5 }), wx, wy - wh / 2 - 0.075, fz + 0.1);   // подоконник

    // стол из ореха 2.2×1.0 и шесть стульев
    const walnut = M({ map: walnutTex([2, 1]), roughness: 0.42 }), legWood = M({ map: walnutTex([1, 4]), roughness: 0.5 });
    add(slab(2.2, 1.0, 0.045, 0.04, 0.008), walnut, 0, 0.73, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.075, 0.73, 0.075), legWood, sx * 0.94, 0.365, sz * 0.36);
    const fabric = M({ color: lin('#4a473d'), roughness: 0.97 });
    const seatG = slab(0.47, 0.46, 0.075, 0.07, 0.02), backG = slab(0.45, 0.34, 0.05, 0.07, 0.018);
    const legG = new THREE.CylinderGeometry(0.016, 0.012, 0.41, 10), postG = new THREE.CylinderGeometry(0.011, 0.011, 0.2, 8);
    const chair = (x, z, ry) => {
      const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; room.add(c);
      const part = (geo, mat, px, py, pz, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.rotation.x = rx; m.castShadow = m.receiveShadow = true; c.add(m); };
      part(seatG, fabric, 0, 0.4, 0);
      part(backG, fabric, 0, 0.72, -0.2, Math.PI / 2 - 0.13);
      for (const lx of [-1, 1]) for (const lz of [-1, 1]) part(legG, legWood, lx * 0.19, 0.205, lz * 0.18);
      for (const lx of [-1, 1]) part(postG, legWood, lx * 0.15, 0.56, -0.2);
    };
    for (const sx of [-0.55, 0.55]) { chair(sx, -0.72, 0); chair(sx, 0.72, Math.PI); }
    chair(-1.42, 0, Math.PI / 2); chair(1.42, 0, -Math.PI / 2);
    const rug = add(new THREE.PlaneGeometry(3.4, 2.6), M({ map: rugTex(), roughness: 1 }), 0, 0.006, 0, false); rug.rotation.x = -Math.PI / 2;

    // комод и картина у левой стены
    const sx0 = -RW / 2 + 0.24;
    add(new THREE.BoxGeometry(0.46, 0.66, 1.9), walnut, sx0, 0.43, 0.2);
    add(new THREE.BoxGeometry(0.42, 0.1, 1.84), M({ color: lin('#1f1a16'), roughness: 0.7 }), sx0, 0.05, 0.2);
    for (const dz of [-0.32, 0.32]) add(new THREE.BoxGeometry(0.004, 0.6, 0.004), M({ color: lin('#20150e') }), sx0 + 0.231, 0.43, 0.2 + dz, false);
    add(new THREE.BoxGeometry(0.035, 1.34, 1.04), M({ color: lin('#2a1f17'), roughness: 0.6 }), -RW / 2 + 0.02, 1.72, 0.2);
    const art = add(new THREE.PlaneGeometry(0.98, 1.28), M({ map: artTex(), roughness: 0.9 }), -RW / 2 + 0.04, 1.72, 0.2, false); art.rotation.y = Math.PI / 2;

    room.userData = { ceil, glass, tall: [], cfg: CABINET };
    return room;
  }

  // ── «Интерьер»: современная столовая в духе генеративного дизайна (мастер 2026-09-30: «прям интерьер генеративного
  // дизайна») — сама архитектура сделана тем же языком, что люстры: стена из закрученных лент, рельеф из шестигранников,
  // стол на пьедесталах из слоёв, скульптуры из слоёв; стеклянная стена в сумерки; светлые тёплые тона — латунь главный акцент
  // пол: микроцемент — мягкие пятна и следы шпателя (тайл 4 м)
  const microcementTex = () => canvasTex(1024, 1024, (g, W, H) => {
    g.fillStyle = '#7b756c'; g.fillRect(0, 0, W, H);
    const r = rnd(17);
    for (let k = 0; k < 1500; k++) {
      const x = r() * W, y = r() * H, rad = 20 + r() * 150, a = 0.012 + r() * 0.03, light = r() < 0.5;
      wrapped(W, H, x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, `rgba(${light ? '255,252,246' : '70,64,58'},${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    g.lineCap = 'round';
    for (let k = 0; k < 240; k++) {
      const x = r() * W, y = r() * H, len = 80 + r() * 220, ang = r() * Math.PI, bend = (r() - 0.5) * 60;
      g.strokeStyle = `rgba(${r() < 0.5 ? '255,250,240' : '60,55,50'},${0.018 + r() * 0.03})`; g.lineWidth = 6 + r() * 18;
      const dx = Math.cos(ang) * len / 2, dy = Math.sin(ang) * len / 2;
      wrapped(W, H, x, y, len, (px, py) => { g.beginPath(); g.moveTo(px - dx, py - dy); g.quadraticCurveTo(px + bend, py - bend, px + dx, py + dy); g.stroke(); });
    }
  }, [2, 2]);

  // травертин: волнистые слои камня и поры (одна плита на столешницу)
  const travertineTex = () => {
    const t = canvasTex(1024, 512, (g, W, H) => {
      g.fillStyle = '#cdbd9f'; g.fillRect(0, 0, W, H);
      const r = rnd(29);
      for (let k = 0; k < 120; k++) {
        const y = r() * H, h = 2 + r() * 22, a = 0.04 + r() * 0.1, tone = r() < 0.5 ? '250,242,228' : '150,126,96', amp = 2 + r() * 8, ph = r() * 6;
        g.fillStyle = `rgba(${tone},${a})`; g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= W; x += 32) g.lineTo(x, y + amp * Math.sin(x / W * Math.PI * 3 + ph));
        for (let x = W; x >= 0; x -= 32) g.lineTo(x, y + h + amp * Math.sin(x / W * Math.PI * 3 + ph + 0.4));
        g.closePath(); g.fill();
      }
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(110,88,62,${0.12 + r() * 0.25})`; g.beginPath(); g.ellipse(r() * W, r() * H, 1 + r() * 5, 0.6 + r() * 1.4, 0, 0, 7); g.fill(); }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 2.4, 1 / 1.05); t.offset.set(0.5, 0.5);   // координаты плиты — в метрах
    return t;
  };

  // букле: мелкие петли светлой шерсти
  const boucleTex = () => canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#e2d9cb'; g.fillRect(0, 0, W, H);
    const r = rnd(41);
    for (let k = 0; k < 1500; k++) {
      const x = r() * W, y = r() * H, rad = 1.5 + r() * 3.5;
      g.strokeStyle = r() < 0.5 ? `rgba(255,252,245,${0.25 + r() * 0.3})` : `rgba(150,136,116,${0.18 + r() * 0.25})`; g.lineWidth = 0.8 + r();
      wrapped(W, H, x, y, rad, (px, py) => { g.beginPath(); g.arc(px, py, rad, 0, 7); g.stroke(); });
    }
  }, [6, 3]);

  // ковёр: шерсть тёплого серого
  const woolTex = () => canvasTex(512, 512, (g, W, H) => {
    g.fillStyle = '#b7afa2'; g.fillRect(0, 0, W, H);
    const r = rnd(5);
    for (let k = 0; k < 12000; k++) { g.fillStyle = r() < 0.5 ? `rgba(255,250,240,${0.05 + r() * 0.08})` : `rgba(60,52,44,${0.04 + r() * 0.07})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  }, [3, 3]);

  // канелюры фасада тумбы: у каждой свет и тень
  const fluteTex = () => canvasTex(256, 64, (g, W, H) => {
    for (let i = 0; i < 16; i++) {
      const gr = g.createLinearGradient(i * 16, 0, i * 16 + 16, 0);
      gr.addColorStop(0, '#9c958b'); gr.addColorStop(0.35, '#ebe5db'); gr.addColorStop(0.7, '#d5cec3'); gr.addColorStop(1, '#8f887e');
      g.fillStyle = gr; g.fillRect(i * 16, 0, 16, H);
    }
  }, [6, 1]);

  // стеклянная стена: сумерки, два плана городской застройки, огни в окнах
  const duskWideTex = () => canvasTex(1024, 512, (g, W, H) => {
    const s = g.createLinearGradient(0, 0, 0, H);
    s.addColorStop(0, '#0c1630'); s.addColorStop(0.5, '#22375e'); s.addColorStop(0.74, '#5d6680'); s.addColorStop(0.8, '#8c7d78'); s.addColorStop(1, '#2a2a33');
    g.fillStyle = s; g.fillRect(0, 0, W, H);
    const r = rnd(9);
    for (const [base, hmax, col] of [[0.8, 70, '#262833'], [0.85, 140, '#15161d']]) {
      let x = 0; g.fillStyle = col;
      while (x < W) { const bw = 14 + r() * 50, bh = 16 + r() * hmax; g.fillRect(x, H * base - bh, bw, H * (1 - base) + bh); x += bw + r() * 6; }
    }
    for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(255,${180 + Math.round(r() * 40)},110,${0.45 + r() * 0.5})`; g.fillRect(r() * W, H * (0.62 + r() * 0.34), 2, 2); }
  });

  // склейка геометрий в одну (меньше вызовов отрисовки); flat — нормали по граням (гранёные предметы)
  function merge(geos, flat = false) {
    const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    if (flat) parts.forEach((g) => g.computeVertexNormals());
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      if (!parts.every((g) => g.attributes[name])) continue;
      const arr = new Float32Array(parts.reduce((s, g) => s + g.attributes[name].array.length, 0));
      let o = 0; for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, parts[0].attributes[name].itemSize));
    }
    new Set([...geos, ...parts]).forEach((g) => g.dispose());
    return out;
  }

  // суперэллипс: p = 2 — эллипс, больше — к скруглённому прямоугольнику
  function superShape(a, b, p, n = 48) {
    const s = new THREE.Shape();
    for (let k = 0; k < n; k++) {
      const t = 2 * Math.PI * k / n, c = Math.cos(t), sn = Math.sin(t);
      const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), y = b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p);
      if (k) s.lineTo(x, y); else s.moveTo(x, y);
    }
    s.closePath();
    return s;
  }

  // предмет из слоёв: контур плавно меняется по высоте и закручивается (a, b — полуоси слоя от u = 0..1)
  function sliced({ n, h, gap, a, b, p, twist }) {
    const geos = [], sh = h / n;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n, g = new THREE.ExtrudeGeometry(superShape(a(u), b(u), p), { depth: sh * (1 - gap), bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2); g.rotateY(twist * (u - 0.5)); g.translate(0, k * sh, 0);
      geos.push(g);
    }
    return merge(geos);
  }

  // стена из вертикальных лент: каждая плавно закручивается по высоте, угол задаёт поле-волна. Где ленты развёрнуты
  // к комнате — стена закрыта и светлая, где встали ребром — открыта, видна тёмная стена за ними: узор из света и тени
  function twistWall(len, h, mat) {
    const w = 0.11, t = 0.012, step = 0.12, n = Math.floor(len / step), K = 60, d0 = 0.08;
    // диагональная волна: каждая лента за высоту успевает повернуться от «лицом» до «ребром», соседние — со сдвигом
    const ang = (z, y) => 0.75 + 0.7 * Math.sin(1.1 * z + 1.4 * y + 0.6 * Math.sin(0.8 * z));
    const C = [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]];   // сечение ленты: ширина × толщина
    const pos = [], idx = [];
    for (let i = 0; i < n; i++) {
      const z0 = -len / 2 + (i + 0.5) * step, base = pos.length / 3;
      for (let k = 0; k <= K; k++) {
        const y = h * k / K, a = ang(z0, y), U = [Math.sin(a), Math.cos(a)], V = [Math.cos(a), -Math.sin(a)];   // (x, z): вдоль ширины и толщины
        for (let f = 0; f < 4; f++) for (const [pu, pv] of [C[f], C[(f + 1) % 4]]) pos.push(d0 + U[0] * pu + V[0] * pv, y, z0 + U[1] * pu + V[1] * pv);
      }
      for (let k = 0; k < K; k++) for (let f = 0; f < 4; f++) {                 // у каждой грани свои вершины — рёбра ленты острые
        const a0 = base + k * 8 + f * 2, a1 = a0 + 8;
        idx.push(a0, a0 + 1, a1 + 1, a0, a1 + 1, a1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  const MODERN = { w: 8, d: 8, h: 3, eye: 1.5 };                     // 8×8 м, потолок 3 м (выше, если люстра длинная)
  function buildModern() {
    const room = new THREE.Group(), tall = [];
    const M = (o) => new THREE.MeshStandardMaterial(o);
    const add = (geo, mat, x, y, z, cast = true, parent = room) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
    const { w: RW, d: RD, h: RH } = MODERN, WH = 7;                      // стены выше любого потолка — потолок режет их сам
    const wallMat = M({ color: lin('#e4ded5'), roughness: 0.93 }), dark = M({ color: lin('#2b2824'), roughness: 0.5 });

    const floor = add(new THREE.PlaneGeometry(RW, RD), M({ map: microcementTex(), roughness: 0.36 }), 0, 0, 0, false); floor.rotation.x = -Math.PI / 2;
    const ceil = add(new THREE.PlaneGeometry(RW, RD), M({ color: lin('#f1ece5'), roughness: 0.96 }), 0, RH, 0, false); ceil.rotation.x = Math.PI / 2;
    const wall = (x, z, ry, mat) => { const m = add(new THREE.PlaneGeometry(RW, WH), mat, x, WH / 2, z, false); m.rotation.y = ry; };
    wall(0, -RD / 2, 0, wallMat); wall(0, RD / 2, Math.PI, wallMat); wall(RW / 2, 0, -Math.PI / 2, wallMat);
    wall(-RW / 2, 0, Math.PI / 2, M({ color: lin('#5a544c'), roughness: 0.95 }));   // за лентами — тёмная, видна там, где ленты встали ребром

    // левая стена — закрученные ленты от пола до потолка
    const louvre = twistWall(RD, RH, M({ color: lin('#ede7dd'), roughness: 0.8 }));
    louvre.position.set(-RW / 2, 0, 0); louvre.castShadow = louvre.receiveShadow = true; room.add(louvre); tall.push(louvre);

    // дальняя стена — стекло в пол, тонкие чёрные импосты; ночью стекло ещё и отражает комнату
    const glazing = new THREE.Group(); room.add(glazing); tall.push(glazing);
    const gx0 = -RW / 2 + 0.5, gx1 = 2.4, gw = gx1 - gx0, fz = -RD / 2 + 0.03;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: duskWideTex(), roughness: 0.06, metalness: 0 });
    const pane = new THREE.PlaneGeometry(gw, RH); pane.translate(0, RH / 2, 0);
    add(pane, glass, (gx0 + gx1) / 2, 0, fz, false, glazing);
    const frame = M({ color: lin('#161514'), roughness: 0.4, metalness: 0.5 });
    const mull = (w, h, x, y) => { const g = new THREE.BoxGeometry(w, h, 0.09); g.translate(0, h / 2, 0); add(g, frame, x, y, fz + 0.045, true, glazing); };
    for (let k = 0; k <= 4; k++) mull(0.045, RH, gx0 + gw * k / 4, 0);
    mull(gw + 0.045, 0.05, (gx0 + gx1) / 2, 0); mull(gw + 0.045, 0.05, (gx0 + gx1) / 2, RH - 0.05);

    // правая стена — рельеф из шестигранников: вылет каждого — по плавному полю
    const hexes = [], R = 0.1, hw = 2.7, hh = 1.7, hy = 1.55;
    for (let i = 0; i * 1.5 * R <= hw; i++) for (let j = 0; j * Math.sqrt(3) * R <= hh; j++) {
      const z = -hw / 2 + i * 1.5 * R, y = hy - hh / 2 + j * Math.sqrt(3) * R + (i % 2 ? Math.sqrt(3) * R / 2 : 0);
      if (y > hy + hh / 2) continue;
      const d = 0.02 + 0.13 * Math.pow(0.5 + 0.5 * Math.sin(3.1 * z + 1.9 * y + 0.8 * Math.sin(2.3 * y)), 2);
      const g = new THREE.CylinderGeometry(R * 0.93, R * 0.93, d, 6); g.rotateZ(-Math.PI / 2); g.translate(RW / 2 - d / 2, y, z + 0.4);
      hexes.push(g);
    }
    add(merge(hexes, true), M({ color: lin('#ebe5db'), roughness: 0.8 }), 0, 0, 0);

    // стол: столешница-«стадион» из травертина на двух пьедесталах из слоёв (закручены навстречу)
    add(slab(2.4, 1.05, 0.06, 0.6, 0.012), M({ map: travertineTex(), roughness: 0.45 }), 0, 0.71, 0);
    for (const sx of [-1, 1]) {
      add(sliced({ n: 20, h: 0.71, gap: 0.18, p: 3.2, twist: 0.5 * sx,
        a: (u) => 0.2 - 0.075 * Math.sin(Math.PI * u) + 0.03 * u, b: (u) => 0.3 - 0.11 * Math.sin(Math.PI * u) + 0.04 * u }), dark, sx * 0.62, 0, 0);
    }

    // стулья-чаши в букле на тюльпановых ножках
    const boucle = M({ map: boucleTex(), roughness: 1 }), metalBlack = M({ color: lin('#1b1a19'), roughness: 0.32, metalness: 0.7 });
    const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40);
    const baseG = lathe([[0.001, 0], [0.23, 0], [0.235, 0.008], [0.225, 0.016], [0.08, 0.05], [0.04, 0.12], [0.03, 0.4], [0.001, 0.4]]);
    const seatG = lathe([[0.001, 0.395], [0.2, 0.395], [0.235, 0.405], [0.25, 0.43], [0.24, 0.455], [0.2, 0.468], [0.001, 0.47]]);
    const bs = new THREE.Shape(), R1 = 0.27, R0 = 0.215, a0 = Math.PI / 2 - 1.75, a1 = Math.PI / 2 + 1.75, nb = 28;
    for (let k = 0; k <= nb; k++) { const t = a0 + (a1 - a0) * k / nb; if (k) bs.lineTo(R1 * Math.cos(t), R1 * Math.sin(t)); else bs.moveTo(R1 * Math.cos(t), R1 * Math.sin(t)); }
    for (let k = nb; k >= 0; k--) { const t = a0 + (a1 - a0) * k / nb; bs.lineTo(R0 * Math.cos(t), R0 * Math.sin(t)); }
    const backG = new THREE.ExtrudeGeometry(bs, { depth: 0.27, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 4, curveSegments: 8 });
    backG.rotateX(-Math.PI / 2); backG.translate(0, 0.45, 0);
    const chair = (x, z, ry) => {
      const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = ry; room.add(c);
      add(baseG, metalBlack, 0, 0, 0, true, c); add(seatG, boucle, 0, 0, 0, true, c); add(backG, boucle, 0, 0, 0, true, c);
    };
    for (const x of [-0.58, 0.58]) { chair(x, -0.84, 0); chair(x, 0.84, Math.PI); }
    chair(-1.64, 0, Math.PI / 2); chair(1.64, 0, -Math.PI / 2);

    // ковёр плавной формы
    const blob = new THREE.Shape(), nr = 96;
    for (let k = 0; k <= nr; k++) {
      const t = 2 * Math.PI * k / nr, rr = 1 + 0.05 * Math.sin(3 * t + 0.4) + 0.035 * Math.sin(5 * t + 1.7) + 0.02 * Math.sin(7 * t + 0.2);
      if (k) blob.lineTo(2.05 * rr * Math.cos(t), 1.5 * rr * Math.sin(t)); else blob.moveTo(2.05 * rr * Math.cos(t), 1.5 * rr * Math.sin(t));
    }
    const rugG = new THREE.ExtrudeGeometry(blob, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.012, bevelSegments: 2, curveSegments: 1 });
    rugG.rotateX(-Math.PI / 2); rugG.translate(0, 0.004, 0);
    add(rugG, M({ map: woolTex(), roughness: 1 }), 0, 0, 0, false);

    // у ближней стены — низкая тумба с канелюрами и две вазы из слоёв
    const cz = RD / 2 - 0.23;
    add(new THREE.BoxGeometry(3.0, 0.08, 0.4), dark, 0.3, 0.04, cz + 0.02);
    add(new THREE.BoxGeometry(3.0, 0.6, 0.46), M({ color: lin('#e6e0d6'), roughness: 0.55 }), 0.3, 0.38, cz);
    const front = add(new THREE.PlaneGeometry(2.98, 0.58), M({ map: fluteTex(), roughness: 0.6 }), 0.3, 0.38, cz - 0.232, false); front.rotation.y = Math.PI;
    const vase = (h, w, tw) => sliced({ n: 26, h, gap: 0.14, p: 2.6, twist: tw, a: (u) => w * (0.7 + 0.45 * Math.sin(Math.PI * (0.15 + 0.8 * u))), b: (u) => w * (0.6 + 0.35 * Math.sin(Math.PI * (0.1 + 0.85 * u))) });
    add(vase(0.42, 0.075, 1.1), dark, -0.5, 0.68, cz); add(vase(0.26, 0.06, -0.8), dark, -0.2, 0.68, cz + 0.05);

    // в углу у стекла — постамент со скульптурой из слоёв
    add(new THREE.BoxGeometry(0.42, 0.9, 0.42), M({ color: lin('#e8e2d8'), roughness: 0.7 }), -RW / 2 + 0.75, 0.45, -RD / 2 + 0.75);
    add(sliced({ n: 34, h: 0.62, gap: 0.12, p: 2.3, twist: 1.6, a: (u) => 0.1 + 0.07 * Math.sin(Math.PI * u * 1.3), b: (u) => 0.07 + 0.05 * Math.cos(Math.PI * u) }), dark, -RW / 2 + 0.75, 0.9, -RD / 2 + 0.75);

    room.userData = { ceil, glass, tall, cfg: MODERN };
    return room;
  }

  // тот же материал, но рассеянный свет и отражения гаснут там, куда «небо» не заглядывает (атрибут вершины ao ∈ [0..1])
  function withAO(mat) {
    const m = mat.clone();
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAOv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAOv = ao;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAOv;')
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float occ = clamp(vAOv * 1.08, 0.0, 1.0);
          reflectedLight.indirectDiffuse *= occ;
          float nv = saturate(dot(geometry.normal, geometry.viewDir));
          reflectedLight.indirectSpecular *= saturate(pow(nv + occ, exp2(-16.0 * material.roughness - 1.0)) - 1.0 + occ);
        }`);
    };
    return m;
  }

  // лампы: колбы бывают одним общим мешем (разбираем по связности) или отдельными; центр и размер каждой — в мировых координатах
  function lampsOf(mesh) {
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, n = pos.count;
    const par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    if (idx) { const ix = idx.array; for (let t = 0; t < ix.length; t += 3) { const a = find(ix[t]); par[find(ix[t + 1])] = a; par[find(ix[t + 2])] = a; } }
    const acc = new Map(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const r = idx ? find(i) : 0; let e = acc.get(r);
      if (!e) { e = new THREE.Box3(); acc.set(r, e); }
      e.expandByPoint(mesh.localToWorld(v.fromBufferAttribute(pos, i)));
    }
    return [...acc.values()].map((b) => ({ c: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()).length() }));
  }

  // ── затенение между деталями (сколько «неба» видно из каждой вершины) ──
  // люстру снимаем по глубине с N направлений (атлас карт глубины), потом каждая вершина проверяет,
  // видна ли она с направлений своей полусферы. Результат — атрибут вершины ao ∈ [0..1]
  function makeBaker(renderer) {
    if (!renderer.capabilities.isWebGL2) return null;
    const N = weak ? 32 : 48, COLS = 8, ROWS = N / COLS, TILE = weak ? 160 : 256, OW = 2048;
    const dirs = [];
    for (let k = 0; k < N; k++) {                                       // сфера Фибоначчи
      const z = 1 - 2 * (k + 0.5) / N, r = Math.sqrt(1 - z * z), ph = k * 2.399963229728653;
      dirs.push(new THREE.Vector3(r * Math.cos(ph), z, r * Math.sin(ph)));
    }
    const basis = `
      vec3 up = abs(d.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 u = normalize(cross(up, d)), v = cross(d, u);`;
    const depthMat = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Vector3() }, uD: { value: new THREE.Vector3() }, uR: { value: 1 } },
      vertexShader: `uniform vec3 uC, uD; uniform float uR;
        void main() {
          vec3 w = (modelMatrix * vec4(position, 1.0)).xyz - uC, d = uD; ${basis}
          gl_Position = vec4(dot(w, u) / uR, dot(w, v) / uR, -dot(w, d) / uR, 1.0);
        }`,
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      side: THREE.DoubleSide,
    });
    const aoMat = new THREE.ShaderMaterial({
      defines: { NDIR: N, COLS: COLS.toFixed(1), ROWS: ROWS.toFixed(1) },
      uniforms: { uDepth: { value: null }, uDirs: { value: dirs }, uC: { value: new THREE.Vector3() }, uR: { value: 1 },
        uOff: { value: 0 }, uBias: { value: 0 }, uW: { value: OW }, uH: { value: 1 } },
      vertexShader: `uniform highp sampler2D uDepth; uniform vec3 uDirs[NDIR], uC; uniform float uR, uOff, uBias, uW, uH;
        varying float vAO;
        void main() {
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz - uC + n * uOff;
          float s = 0.0, t = 0.0;
          for (int k = 0; k < NDIR; k++) {
            vec3 d = uDirs[k];
            float c = dot(n, d);
            if (c <= 0.0) continue;
            ${basis}
            vec2 xy = clamp(vec2(dot(p, u), dot(p, v)) / uR * 0.5 + 0.5, 0.0, 1.0);
            vec2 uv = (vec2(mod(float(k), COLS), floor(float(k) / COLS)) + xy) / vec2(COLS, ROWS);
            float z = 0.5 - 0.5 * dot(p, d) / uR;
            float bias = uBias * (1.0 + 1.5 * sqrt(1.0 - c * c) / max(c, 0.25));
            s += c * step(z, texture2D(uDepth, uv).r + bias); t += c;
          }
          vAO = t > 0.0 ? s / t : 1.0;
          float id = float(gl_VertexID);
          gl_Position = vec4((vec2(mod(id, uW), floor(id / uW)) + 0.5) / vec2(uW, uH) * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: 'varying float vAO; void main() { gl_FragColor = vec4(vAO, vAO, vAO, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    const cam = new THREE.Camera(), pg = new THREE.BufferGeometry(), pts = new THREE.Points(pg, aoMat), ps = new THREE.Scene();
    pts.frustumCulled = false; pts.matrixAutoUpdate = false; ps.add(pts);

    return function bake(meshes) {
      const t0 = performance.now();
      const box = new THREE.Box3(); meshes.forEach((m) => box.expandByObject(m));
      const C = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2 * 1.02, texel = 2 * R / TILE;
      const rt = new THREE.WebGLRenderTarget(COLS * TILE, ROWS * TILE, { depthBuffer: true, stencilBuffer: false });
      rt.depthTexture = new THREE.DepthTexture(COLS * TILE, ROWS * TILE); rt.depthTexture.type = THREE.UnsignedIntType;
      const ds = new THREE.Scene();
      for (const m of meshes) {
        const c = new THREE.Mesh(m.geometry, depthMat);
        c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.frustumCulled = false; ds.add(c);
      }
      const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt); renderer.clear(true, true, false);
      depthMat.uniforms.uC.value.copy(C); depthMat.uniforms.uR.value = R;
      for (let k = 0; k < N; k++) {                                     // каждое направление — своя клетка атласа
        rt.viewport.set((k % COLS) * TILE, Math.floor(k / COLS) * TILE, TILE, TILE);
        renderer.setRenderTarget(rt);
        depthMat.uniforms.uD.value.copy(dirs[k]);
        renderer.render(ds, cam);
      }
      const U = aoMat.uniforms;
      U.uDepth.value = rt.depthTexture; U.uC.value.copy(C); U.uR.value = R;
      U.uOff.value = 1.2 * texel; U.uBias.value = 1.0 / TILE;          // отступ по нормали и допуск — около клетки карты
      let verts = 0;
      for (const m of meshes) {
        const g = m.geometry, n = g.attributes.position.count, H = Math.ceil(n / OW);
        const out = new THREE.WebGLRenderTarget(OW, H, { depthBuffer: false, stencilBuffer: false });
        pg.setAttribute('position', g.attributes.position); pg.setAttribute('normal', g.attributes.normal);
        pts.matrix.copy(m.matrixWorld); pts.matrixWorld.copy(m.matrixWorld); U.uH.value = H;
        renderer.setRenderTarget(out); renderer.clear(true, false, false); renderer.render(ps, cam);
        const buf = new Uint8Array(OW * H * 4); renderer.readRenderTargetPixels(out, 0, 0, OW, H, buf);
        const ao = new Uint8Array(n); for (let i = 0; i < n; i++) ao[i] = buf[i * 4];
        g.setAttribute('ao', new THREE.BufferAttribute(ao, 1, true));
        out.dispose(); verts += n;
      }
      renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto;
      rt.dispose();
      console.log(`[studio] затенение: ${verts} вершин, ${N} направлений, ${(performance.now() - t0).toFixed(0)} мс`);
    };
  }

  // переключатель сцены (студия, кабинет, интерьер) — в правом верхнем углу окна 3D (на узком экране — внизу справа, над подсказкой)
  function makeToggle(canvas, onPick) {
    const host = canvas.parentElement;
    const css = document.createElement('style');
    css.textContent = `.scene-mode { position: absolute; right: 12px; top: 12px; z-index: 3; display: flex; gap: 2px; padding: 3px; border-radius: 999px;
  background: rgba(20, 16, 12, .6); border: 1px solid rgba(233, 220, 194, .2); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.scene-mode button { font: inherit; font-size: 12px; letter-spacing: .04em; color: #d9ccb2; background: transparent; border: 0; border-radius: 999px; padding: 6px 12px; cursor: pointer; }
.scene-mode button[aria-pressed="true"] { background: #d1ad66; color: #17120d; font-weight: 600; }
.scene-mode button:focus-visible { outline: 2px solid #d1ad66; outline-offset: 2px; }
.scene-mode.wait { pointer-events: none; }
.scene-mode.wait button[aria-pressed="true"] { animation: scene-wait 0.9s ease-in-out infinite alternate; }
@keyframes scene-wait { to { opacity: .45; } }
@media (max-width: 560px) { .scene-mode { top: auto; bottom: 34px; right: 10px; } .scene-mode button { padding: 6px 10px; } }
.stage .tag, .stage .sub, .stage .hint { text-shadow: 0 1px 2px rgba(0, 0, 0, .6), 0 0 14px rgba(0, 0, 0, .5); }
.scene-scrim { position: absolute; left: 0; right: 0; pointer-events: none; transition: opacity .4s; }
.scene-scrim.top { top: 0; height: 120px; background: linear-gradient(rgba(12, 9, 7, .62), rgba(12, 9, 7, 0)); }
.scene-scrim.bot { bottom: 0; height: 64px; background: linear-gradient(rgba(12, 9, 7, 0), rgba(12, 9, 7, .55)); }`;
    document.head.appendChild(css);
    const ui = document.createElement('div');
    ui.className = 'scene-mode'; ui.setAttribute('role', 'group'); ui.setAttribute('aria-label', 'Сцена');
    ui.innerHTML = '<button type="button" data-m="studio">Студия</button><button type="button" data-m="cabinet">Кабинет</button>'
      + '<button type="button" data-m="interior">Интерьер</button>';
    ui.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) onPick(b.dataset.m); });
    host.appendChild(ui);
    // затемнение у подписей — только в интерьере (светлый потолок); сразу за холстом, под подписями
    const scrims = ['top', 'bot'].map((k) => { const d = document.createElement('div'); d.className = 'scene-scrim ' + k; d.style.opacity = '0'; return d; });
    canvas.after(...scrims);
    return {
      pressed: (m) => {
        ui.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
        scrims.forEach((d) => { d.style.opacity = m === 'studio' ? '0' : '1'; });
      },
      wait: (on) => ui.classList.toggle('wait', on),
    };
  }

  function init({ renderer, scene, camera, controls, pmrem, matte }) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;                              // свет и люстра неподвижны: тени считаем раз на сборку

    const studioTex = pmrem.fromScene(studioEnv(), 0.02).texture, backTex = backdrop();
    scene.background = backTex; scene.environment = studioTex; renderer.toneMappingExposure = 1.05;   // до первой сборки — студия
    const key = new THREE.DirectionalLight(0xfff0dc, 1.0);
    key.castShadow = !weak; key.shadow.mapSize.set(2048, 2048);
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1c140c, 0.22);
    scene.add(key, key.target, hemi);

    // латунь: полированная (CELL, ЛЕПЕСТОК) или шлифованная с патиной (ОРБИТА)
    const brass = new THREE.MeshPhysicalMaterial({
      color: matte ? 0xc0914c : 0xd9a64e, metalness: 1, roughness: matte ? 0.42 : 0.22,
      clearcoat: matte ? 0 : 0.2, clearcoatRoughness: 0.25, envMapIntensity: 1.15, side: THREE.DoubleSide,
    });
    const brassAO = withAO(brass);                                     // затенение между деталями — из запекания
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xffd7a0, emissiveIntensity: 2.2, roughness: 0.3 });
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc98a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7, toneMapped: false });
    let bake = null;
    try { bake = makeBaker(renderer); } catch (e) { console.warn('[studio] затенение недоступно:', e); }

    // медленное вращение, пока никто не трогает; тронул — стоп, отпустил — через 7 с снова
    controls.autoRotate = !calm; controls.autoRotateSpeed = 0.7;
    let idle = 0;
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idle); });
    controls.addEventListener('end', () => { clearTimeout(idle); if (!calm) idle = setTimeout(() => { controls.autoRotate = true; }, 7000); });

    // ── режим сцены ──
    const EXP_IN = 0.028;                                              // выдержка интерьера: свет в физических единицах (кд, лк)
    const KEY = 0.115;                                                 // средняя яркость кадра после выдержки (подобрано по ОРБИТЕ)
    const MODES = ['studio', 'cabinet', 'interior'], saved = store.get('brass-scene');
    let mode = MODES.includes(saved) ? saved : 'studio';
    let last = null, lights = [], sprites = [], roomEnv = null, roomBox = null, studioView = null;
    const rooms = {};                                                  // комнаты строим при первом заходе
    const toggle = makeToggle(renderer.domElement, (m) => {
      if (m === mode) return;
      mode = m; store.set('brass-scene', m); toggle.pressed(mode); toggle.wait(true);
      requestAnimationFrame(() => setTimeout(() => { try { apply(); } finally { toggle.wait(false); } }, 0));   // сначала показать нажатие
    });
    toggle.pressed(mode);

    // в комнате камера не выходит за стены
    controls.addEventListener('change', () => {
      if (mode === 'studio' || !roomBox) return;
      const p = camera.position, q = p.clone().clamp(roomBox.min, roomBox.max);
      if (!q.equals(p)) { p.copy(q); camera.lookAt(controls.target); }
    });

    const allMaterials = () => {
      const s = new Set([brass, brassAO, bulbMat]);
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => s.add(m)); });
      return s;
    };
    function lightMode(physical) {                                      // студия — привычные единицы, интерьер — физические
      if (renderer.physicallyCorrectLights === physical) return;
      renderer.physicallyCorrectLights = physical;
      allMaterials().forEach((m) => { m.needsUpdate = true; });
    }
    const addLight = (L) => { scene.add(L); lights.push(L); return L; };

    function apply() {
      toggle.pressed(mode);
      lights.forEach((L) => { if (L.parent) L.parent.remove(L); L.dispose(); }); lights = [];   // с картами теней — иначе копятся в памяти
      if (!last) return;
      const { group, lamps, box, top, bottom } = last;
      const inside = mode !== 'studio';
      lightMode(inside);
      key.visible = hemi.visible = !inside;
      Object.values(rooms).forEach((r) => { r.visible = false; });
      bulbMat.emissiveIntensity = inside ? 2.2 * 1.05 / EXP_IN : 2.2;
      renderer.toneMappingExposure = inside ? EXP_IN : 1.05;

      if (!inside) {
        scene.background = backTex; scene.environment = studioTex;
        // свет от ламп: на телефоне — не больше 4 источников (ореол — у каждой)
        const maxL = weak ? 4 : 12, step = Math.max(1, Math.ceil(lamps.length / maxL));
        lamps.forEach((L, i) => { if (i % step === 0) addLight(new THREE.PointLight(0xffc27a, 0.32 * Math.sqrt(step), 1.2, 2)).position.copy(L.c); });
        camera.fov = 35; camera.updateProjectionMatrix();
        controls.minDistance = 0; controls.maxDistance = Infinity;
        controls.target.copy(studioView.target); camera.position.copy(studioView.pos);
        renderer.shadowMap.needsUpdate = true;
        return;
      }

      // ── комната: «Кабинет» или «Интерьер» ──
      if (!rooms[mode]) { rooms[mode] = mode === 'cabinet' ? buildCabinet() : buildModern(); scene.add(rooms[mode]); }
      const room = rooms[mode], C = room.userData.cfg;
      room.visible = true;
      const H = Math.max(C.h, top - bottom + 0.77 + 0.75);               // до стола — не меньше 0.75 м
      const floorY = top - H;
      room.position.set(0, floorY, 0);
      room.userData.ceil.position.y = H + 0.0005;
      room.userData.tall.forEach((o) => { o.scale.y = H / C.h; });       // рёбра и стекло — от пола до потолка
      room.userData.glass.emissiveIntensity = 0.9 / EXP_IN;              // сумерки: яркость окна в единицах сцены
      roomBox = new THREE.Box3(new THREE.Vector3(-C.w / 2 + 0.45, floorY + 0.35, -C.d / 2 + 0.45), new THREE.Vector3(C.w / 2 - 0.45, top - 0.25, C.d / 2 - 0.45));
      scene.background = null;

      // лампы: E14 ~ 470 лм ≈ 37 кд. На компьютере — несколько ламп с тенями (узор решётки на потолке и стенах)
      // несут почти весь свет, у каждой колбы — слабый ближний источник для бликов на латуни
      const cd = 37, n = lamps.length;
      if (n) {
        const S = Math.min(4, n), share = weak ? 1 : 0.85, shadows = weak ? (tiny ? 0 : 1) : S;   // телефон — одна лампа с тенью
        for (let s = 0; s < S; s++) {
          const L = addLight(new THREE.PointLight(0xffc98f, cd * n * share / S, 0, 2));
          L.position.copy(lamps[Math.floor(s * n / S)].c);
          if (s < shadows) {
            L.castShadow = true; L.shadow.mapSize.set(512, 512); L.shadow.radius = 3;
            L.shadow.camera.near = 0.03; L.shadow.camera.far = 14; L.shadow.bias = -0.003; L.shadow.normalBias = 0.004;
          }
        }
        if (!weak) {
          const step = Math.max(1, Math.ceil(n / 10));
          lamps.forEach((L, i) => { if (i % step === 0) addLight(new THREE.PointLight(0xffc98f, cd * (1 - share) * step, 0.7, 2)).position.copy(L.c); });
        }
      }
      addLight(new THREE.HemisphereLight(lin('#fff1dd'), lin('#3a2c20'), 8));   // немного рассеянного — чтобы тени и углы не были чёрными

      // кадр как у интерьерного фотографа: камера на уровне глаз и почти ровно, люстра — вверху кадра, стол — внизу;
      // отходим ровно настолько, чтобы влезли оба, угол комнаты — не по центру
      camera.fov = 42; camera.updateProjectionMatrix();
      const bodyTop = box.max.y, tableTop = floorY + 0.775, az = 36 * Math.PI / 180;
      const dist = Math.min(3.1, Math.min(C.w, C.d) / 2 - 0.5, Math.max(2.0, ((bodyTop - tableTop) / 2 + 0.3) / Math.tan(21 * Math.PI / 180)));
      controls.target.set(0, (bodyTop + tableTop) / 2 + 0.1, 0);
      camera.position.set(dist * Math.cos(az), floorY + C.eye, dist * Math.sin(az)); camera.lookAt(controls.target);
      controls.minDistance = 0.7; controls.maxDistance = 3.3;

      // сначала тени (с люстрой), потом снимки комнаты без люстры: первый — прямой свет, второй — с отскоком от первого.
      // Ими латунь отражает комнату, а стены и потолок в тени получают отражённый свет
      scene.environment = null;
      renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      group.visible = false; sprites.forEach((s) => { s.visible = false; });
      const env1 = pmrem.fromScene(scene, 0, 0.05, 30);
      scene.environment = env1.texture;
      const env = pmrem.fromScene(scene, 0, 0.05, 30);
      env1.dispose();
      if (roomEnv) roomEnv.dispose();
      roomEnv = env; scene.environment = env.texture;

      // экспозиция как у фотоаппарата: средняя яркость комнаты → выдержка (12 открытых ламп ЛЕПЕСТКА и 5 в шаре CELL — одинаково
      // читаемо). Меряем, пока люстра скрыта: в кадре она мала, а лишние варианты шейдеров для неё дороги
      let exp = EXP_IN;
      const L = meter();
      group.visible = true; sprites.forEach((s) => { s.visible = true; });
      if (L) exp = Math.min(0.12, Math.max(0.004, KEY / L));
      renderer.toneMappingExposure = exp; bulbMat.emissiveIntensity = 2.2 * 1.05 / exp;
      console.log(`[studio] интерьер: средняя яркость ${L ? L.toFixed(2) : '—'}, выдержка ${exp.toFixed(4)}`);
    }

    // замер яркости: кадр в маленькую float-текстуру без тонирования, среднее геометрическое яркости пикселей
    let meterRT = null;
    function meter() {
      try {
        if (!renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) return null;
        if (!meterRT) meterRT = new THREE.WebGLRenderTarget(48, 48, { type: THREE.FloatType });
        const prev = renderer.getRenderTarget(), tm = renderer.toneMapping;
        renderer.toneMapping = THREE.NoToneMapping;                      // в этой версии three тонирование действует и на текстуры
        renderer.setRenderTarget(meterRT); renderer.clear(); renderer.render(scene, camera); renderer.setRenderTarget(prev);
        renderer.toneMapping = tm;
        const b = new Float32Array(48 * 48 * 4); renderer.readRenderTargetPixels(meterRT, 0, 0, 48, 48, b);
        let s = 0;
        for (let i = 0; i < b.length; i += 4) s += Math.log(1e-3 + Math.max(0, 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]));
        const L = Math.exp(s / (b.length / 4));
        return isFinite(L) && L > 0 ? L : null;
      } catch (e) { return null; }
    }

    // после каждой сборки: затенение, тени, свет и ореол у каждой лампы, сцена — по выбранному режиму.
    // body — меши, которые затеняют друг друга (сама люстра); штанга и чаша — без затенения
    function attach(group, body) {
      sprites.forEach((s) => s.parent && s.parent.remove(s)); sprites = [];
      group.updateMatrixWorld(true);
      const lamps = [];
      group.traverseVisible((o) => {
        if (!o.isMesh) return;
        const glowing = o.material.emissive && o.material.emissive.getHex() !== 0;
        o.castShadow = o.receiveShadow = !glowing;
        if (o.material === bulbMat) lamps.push(...lampsOf(o));
      });
      if (bake && body && body.length) {
        try { bake(body); body.forEach((m) => { if (m.geometry.attributes.ao && m.material === brass) m.material = brassAO; }); }
        catch (e) { console.warn('[studio] затенение не получилось:', e); }
      }
      lamps.forEach((L) => {
        const s = new THREE.Sprite(glowMat); s.position.copy(L.c); s.scale.setScalar(Math.min(0.14, Math.max(0.04, L.size * 1.1)));
        scene.add(s); sprites.push(s);
      });
      // ключевой свет студии и его тень — по габариту люстры
      const box = new THREE.Box3(); (body && body.length ? body : [group]).forEach((m) => box.expandByObject(m));
      const whole = new THREE.Box3().setFromObject(group);
      const ctr = box.getCenter(new THREE.Vector3()), r = Math.max(0.2, box.getSize(new THREE.Vector3()).length() / 2);
      key.target.position.copy(ctr);
      key.position.copy(ctr).add(new THREE.Vector3(1.1, 2.4, 1.7).normalize().multiplyScalar(r * 3));
      const sc = key.shadow.camera, texel = 2 * r / key.shadow.mapSize.x;
      sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.near = r * 0.5; sc.far = r * 6; sc.updateProjectionMatrix();
      key.shadow.normalBias = 1.5 * texel; key.shadow.bias = -texel / (sc.far - sc.near);
      // страница кадрирует под текущий угол обзора — приводим кадр к студийным 35°
      const f = Math.sin(camera.fov * Math.PI / 360) / Math.sin(35 * Math.PI / 360);
      studioView = { target: controls.target.clone(), pos: controls.target.clone().add(camera.position.clone().sub(controls.target).multiplyScalar(f)) };
      last = { group, lamps, box, top: whole.max.y, bottom: Math.min(box.min.y, whole.min.y) };
      apply();
    }
    return { brass, bulbMat, attach, weak };
  }
  return { init, weak };
})();
