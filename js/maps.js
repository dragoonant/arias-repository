// Map definitions. Each map builds a list of solid boxes (collision + visuals),
// optional decoration boxes (visual only, e.g. neon strips) and a lighting theme.
//
// Box format: { x, z, w, d, h, y = 0, c: color, emissive?, opacity? }
// (x, z) is the box center on the ground plane, y is its bottom.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

function perimeter(boxes, size, color, h = 6) {
  const t = 2;
  boxes.push({ x: 0, z: -size - t / 2, w: size * 2 + t * 2, d: t, h, c: color });
  boxes.push({ x: 0, z: size + t / 2, w: size * 2 + t * 2, d: t, h, c: color });
  boxes.push({ x: -size - t / 2, z: 0, w: t, d: size * 2, h, c: color });
  boxes.push({ x: size + t / 2, z: 0, w: t, d: size * 2, h, c: color });
}

// Stairs made of solid columns, each 0.5 m taller than the last.
// dir: 'x+', 'x-', 'z+', 'z-' is the direction you walk to climb.
function stairs(boxes, x, z, dir, steps, width, color) {
  for (let i = 0; i < steps; i++) {
    const h = (i + 1) * 0.5;
    const off = i * 1.0;
    let bx = x, bz = z, w = 1.0, d = width;
    if (dir === 'x+') bx = x + off;
    if (dir === 'x-') bx = x - off;
    if (dir === 'z+') { bz = z + off; w = width; d = 1.0; }
    if (dir === 'z-') { bz = z - off; w = width; d = 1.0; }
    boxes.push({ x: bx, z: bz, w, d, h, c: color });
  }
}

function clearOf(x, z, keepOut) {
  return keepOut.every((k) => Math.hypot(x - k.x, z - k.z) > k.r);
}

export const MAPS = {
  rustyard: {
    id: 'rustyard',
    name: 'Rust Yard',
    desc: 'A sunbaked cargo port full of shipping containers. Tight lanes and a central crane tower.',
    size: 44,
    // Spawn points. `team` spots are team bases in Team battle; all spots are used in Free-for-all.
    spawnZones: [
      { name: 'West Gate', x: -39, z: 0, team: 'red' },
      { name: 'Northwest Lot', x: -39, z: -38, team: 'red' },
      { name: 'Southwest Lot', x: -39, z: 38, team: 'red' },
      { name: 'East Gate', x: 39, z: 0, team: 'blue' },
      { name: 'Northeast Lot', x: 39, z: -38, team: 'blue' },
      { name: 'Southeast Lot', x: 39, z: 38, team: 'blue' },
      { name: 'North Docks', x: 0, z: -39 },
      { name: 'South Docks', x: 0, z: 39 },
      { name: 'Crane Platform', x: 2, z: 2, y: 3.9 },
    ],
    preview: ['#8db7d8', '#b5552f', '#2f6fb5', '#6d665c'],
    theme: {
      sky: 0x9fc4e0, fog: 0xb9cfe0, fogNear: 45, fogFar: 150,
      ground: 0x6f685e, groundLine: 0x5c564d,
      sun: 0xfff0d8, sunI: 2.4, hemiSky: 0xd4e6ff, hemiGround: 0x5a4a3a, hemiI: 0.9,
    },
    build() {
      const r = rng(1234);
      const boxes = [];
      const decor = [];
      perimeter(boxes, 44, 0x7c7368);
      const colors = [0xb5552f, 0x2f6fb5, 0x3c8a4a, 0xc9a227, 0x8a3c3c, 0x5d6b78];
      const keepOut = [{ x: 0, z: 0, r: 10 }];
      // Container rows
      for (let gx = -36; gx <= 36; gx += 12) {
        for (let gz = -36; gz <= 36; gz += 9) {
          if (r() < 0.35) continue;
          const x = gx + (r() - 0.5) * 4;
          const z = gz + (r() - 0.5) * 3;
          if (!clearOf(x, z, keepOut)) continue;
          const turned = r() < 0.4;
          const c = pick(r, colors);
          const w = turned ? 2.5 : 6, d = turned ? 6 : 2.5;
          boxes.push({ x, z, w, d, h: 2.6, c });
          if (r() < 0.3) boxes.push({ x, z, w, d, h: 2.6, y: 2.6, c: pick(r, colors) });
          // crates next to containers make climbing spots
          if (r() < 0.45) {
            const cx = x + (turned ? 2.2 : 0) * (r() < 0.5 ? 1 : -1);
            const cz = z + (turned ? 0 : 2.0) * (r() < 0.5 ? 1 : -1);
            boxes.push({ x: cx, z: cz, w: 1.2, d: 1.2, h: 1.2, c: 0x9c7a4b });
          }
        }
      }
      // Crate clusters
      for (let i = 0; i < 18; i++) {
        const x = (r() - 0.5) * 80, z = (r() - 0.5) * 80;
        if (!clearOf(x, z, keepOut)) continue;
        const n = 1 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          boxes.push({ x: x + k * 1.25, z: z + (r() - 0.5) * 0.4, w: 1.2, d: 1.2, h: 1.2, c: 0x9c7a4b });
        }
        if (n > 1 && r() < 0.5) boxes.push({ x: x + 0.6, z, w: 1.2, d: 1.2, h: 1.2, y: 1.2, c: 0xa8875a });
      }
      // Central crane tower: platform on legs with two staircases
      const legC = 0xc9a227;
      for (const [lx, lz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) {
        boxes.push({ x: lx, z: lz, w: 0.8, d: 0.8, h: 3.5, c: legC });
      }
      boxes.push({ x: 0, z: 0, w: 8, d: 8, h: 0.4, y: 3.5, c: 0x5d6b78 });
      boxes.push({ x: 0, z: 0, w: 1, d: 1, h: 9, y: 3.9, c: legC });
      decor.push({ x: 4, z: 0, w: 14, d: 0.8, h: 0.8, y: 12.5, c: legC });
      stairs(boxes, -2.5, -10.5, 'z+', 7, 2, 0x5d6b78);
      stairs(boxes, 2.5, 10.5, 'z-', 7, 2, 0x5d6b78);
      return { boxes, decor };
    },
  },

  dune: {
    id: 'dune',
    name: 'Dune Outpost',
    desc: 'Crumbling sandstone ruins around a desert fort. Long sightlines for snipers, cover for everyone else.',
    size: 48,
    spawnZones: [
      { name: 'West Camp', x: -43, z: 0, team: 'red' },
      { name: 'Northwest Dunes', x: -42, z: -32, team: 'red' },
      { name: 'Southwest Dunes', x: -42, z: 32, team: 'red' },
      { name: 'East Camp', x: 43, z: 0, team: 'blue' },
      { name: 'Northeast Dunes', x: 42, z: -32, team: 'blue' },
      { name: 'Southeast Dunes', x: 42, z: 32, team: 'blue' },
      { name: 'Fort Courtyard', x: -5, z: 4 },
      { name: 'North Ruins', x: 0, z: -43 },
      { name: 'South Ruins', x: 0, z: 43 },
    ],
    preview: ['#efcf9f', '#c8a273', '#a8784a', '#d2b17a'],
    theme: {
      sky: 0xf0d2a6, fog: 0xead0a8, fogNear: 50, fogFar: 170,
      ground: 0xd2b17a, groundLine: 0xc4a26c,
      sun: 0xffe2b0, sunI: 2.8, hemiSky: 0xfff0d0, hemiGround: 0x8a6a40, hemiI: 0.8,
    },
    build() {
      const r = rng(777);
      const boxes = [];
      const decor = [];
      const stone = [0xc8a273, 0xbf9766, 0xd4b07f, 0xb38a5c];
      perimeter(boxes, 48, 0xa8784a, 7);
      // Central fort: walls with doorways in the middle of every side
      const fw = 0xb38a5c, half = 10, gap = 2.2, th = 1, wh = 3.2;
      const seg = half - gap;
      for (const s of [-1, 1]) {
        boxes.push({ x: -(gap + seg / 2), z: s * half, w: seg, d: th, h: wh, c: fw });
        boxes.push({ x: gap + seg / 2, z: s * half, w: seg, d: th, h: wh, c: fw });
        boxes.push({ x: s * half, z: -(gap + seg / 2), w: th, d: seg, h: wh, c: fw });
        boxes.push({ x: s * half, z: gap + seg / 2, w: th, d: seg, h: wh, c: fw });
      }
      // Watchtower inside the fort
      boxes.push({ x: 4, z: 4, w: 5, d: 5, h: 3.5, c: 0xa8784a });
      stairs(boxes, 4, -5, 'z+', 7, 1.8, 0xbf9766);
      boxes.push({ x: 2, z: 6.2, w: 1, d: 0.6, h: 1, y: 3.5, c: 0xa8784a });
      boxes.push({ x: 6.2, z: 2, w: 0.6, d: 1, h: 1, y: 3.5, c: 0xa8784a });
      boxes.push({ x: -5, z: -5, w: 2.4, d: 1.2, h: 1, c: 0x9a7a52 });
      // Ruined wall segments
      const keepOut = [{ x: 0, z: 0, r: 15 }];
      for (let i = 0; i < 34; i++) {
        const x = (r() - 0.5) * 88, z = (r() - 0.5) * 88;
        if (!clearOf(x, z, keepOut)) continue;
        const len = 3 + r() * 7;
        const h = 1.2 + r() * 2.6;
        const along = r() < 0.5;
        boxes.push({ x, z, w: along ? len : 0.9, d: along ? 0.9 : len, h, c: pick(r, stone) });
        if (r() < 0.35) {
          boxes.push({ x: x + (along ? len / 2 : 0.9), z: z + (along ? 0.9 : len / 2), w: 0.9, d: 0.9, h: h * 0.6, c: pick(r, stone) });
        }
      }
      // Pillars
      for (let i = 0; i < 14; i++) {
        const x = (r() - 0.5) * 86, z = (r() - 0.5) * 86;
        if (!clearOf(x, z, keepOut)) continue;
        boxes.push({ x, z, w: 1.1, d: 1.1, h: 3 + r() * 3, c: pick(r, stone) });
      }
      // Low sandbag cover
      for (let i = 0; i < 16; i++) {
        const x = (r() - 0.5) * 86, z = (r() - 0.5) * 86;
        if (!clearOf(x, z, keepOut)) continue;
        boxes.push({ x, z, w: 2.6, d: 1, h: 1, c: 0x9a7a52 });
      }
      return { boxes, decor };
    },
  },

  neon: {
    id: 'neon',
    name: 'Neon District',
    desc: 'A rain-slick city block at night. Glowing towers, narrow streets and rooftop ambushes.',
    size: 40,
    spawnZones: [
      { name: 'West Avenue', x: -37, z: 0, team: 'red' },
      { name: 'Northwest Alley', x: -37, z: -18, team: 'red' },
      { name: 'Southwest Alley', x: -37, z: 18, team: 'red' },
      { name: 'East Avenue', x: 37, z: 0, team: 'blue' },
      { name: 'Northeast Alley', x: 37, z: -18, team: 'blue' },
      { name: 'Southeast Alley', x: 37, z: 18, team: 'blue' },
      { name: 'Central Plaza', x: 6, z: 6 },
      { name: 'North Street', x: 0, z: -37 },
      { name: 'South Street', x: 0, z: 37 },
    ],
    preview: ['#0b0f22', '#ff3df0', '#3dfcff', '#23263a'],
    theme: {
      sky: 0x0b0f22, fog: 0x151b3a, fogNear: 18, fogFar: 95,
      ground: 0x2e3350, groundLine: 0x3d4466,
      sun: 0xa8b6ff, sunI: 1.3, hemiSky: 0x8f97e0, hemiGround: 0x3a2850, hemiI: 1.6,
      night: true,
    },
    build() {
      const r = rng(4242);
      const boxes = [];
      const decor = [];
      const neon = [0xff3df0, 0x3dfcff, 0xffe53d, 0x7d5cff, 0xff5a5a];
      perimeter(boxes, 40, 0x1c1f30, 10);
      const grid = [-27, -9, 9, 27];
      for (const gx of grid) {
        for (const gz of grid) {
          const isCenter = Math.abs(gx) < 10 && Math.abs(gz) < 10;
          if (isCenter) continue; // central plaza
          const w = 9 + r() * 3, d = 9 + r() * 3;
          const lowRoof = gx === -9 && gz === 27;
          const h = lowRoof ? 3 : 6 + r() * 14;
          boxes.push({ x: gx, z: gz, w, d, h, c: pick(r, [0x3a4060, 0x44365a, 0x34465a]) });
          const col = pick(r, neon);
          // glowing roof rim
          decor.push({ x: gx, z: gz - d / 2, w: w + 0.1, d: 0.12, h: 0.18, y: h - 0.3, c: col, emissive: true });
          decor.push({ x: gx, z: gz + d / 2, w: w + 0.1, d: 0.12, h: 0.18, y: h - 0.3, c: col, emissive: true });
          decor.push({ x: gx - w / 2, z: gz, w: 0.12, d: d + 0.1, h: 0.18, y: h - 0.3, c: col, emissive: true });
          decor.push({ x: gx + w / 2, z: gz, w: 0.12, d: d + 0.1, h: 0.18, y: h - 0.3, c: col, emissive: true });
          // vertical strip and a sign
          decor.push({ x: gx - w / 2 - 0.02, z: gz - d / 2 - 0.02, w: 0.14, d: 0.14, h: h - 0.4, y: 0.2, c: col, emissive: true });
          if (h > 8) {
            decor.push({ x: gx + (r() - 0.5) * 3, z: gz + d / 2 + 0.06, w: 3, d: 0.1, h: 1.2, y: 3 + r() * (h - 6), c: pick(r, neon), emissive: true });
          }
          if (lowRoof) stairs(boxes, gx + w / 2 + 4.5, gz - 2, 'x-', 5, 2, 0x3a3f5a);
        }
      }
      // Street cover: parked cars and barriers
      const streets = [-18, 0, 18];
      for (let i = 0; i < 22; i++) {
        const along = r() < 0.5;
        const lane = pick(r, streets);
        const pos = (r() - 0.5) * 72;
        const x = along ? pos : lane + (r() - 0.5) * 3;
        const z = along ? lane + (r() - 0.5) * 3 : pos;
        if (Math.abs(x) < 4 && Math.abs(z) < 4) continue;
        if (r() < 0.6) {
          const c = pick(r, [0x8a2a3a, 0x2a4a8a, 0xd0d0d8, 0x1b1b22]);
          boxes.push({ x, z, w: along ? 4 : 1.9, d: along ? 1.9 : 4, h: 0.9, c });
          boxes.push({ x, z, w: along ? 2.2 : 1.7, d: along ? 1.7 : 2.2, h: 0.6, y: 0.9, c: 0x3a4660 });
        } else {
          boxes.push({ x, z, w: along ? 2.5 : 0.6, d: along ? 0.6 : 2.5, h: 1.1, c: 0x6b6f80 });
          decor.push({ x, z, w: along ? 2.5 : 0.62, d: along ? 0.62 : 2.5, h: 0.12, y: 0.8, c: 0xffa23d, emissive: true });
        }
      }
      // Plaza fountain block
      boxes.push({ x: 0, z: 0, w: 4, d: 4, h: 1, c: 0x3a3f5a });
      decor.push({ x: 0, z: 0, w: 1.2, d: 1.2, h: 2.5, y: 1, c: 0x3dfcff, emissive: true, opacity: 0.6 });
      return { boxes, decor };
    },
  },

  frost: {
    id: 'frost',
    name: 'Frost Peak',
    desc: 'An icy mountain basin with two high plateaus and a ring of ice pillars. Watch the snowfall hide enemies.',
    size: 44,
    spawnZones: [
      { name: 'West Plateau', x: -33, z: 0, y: 3.5, team: 'red' },
      { name: 'Northwest Rocks', x: -31, z: -33, team: 'red' },
      { name: 'Southwest Rocks', x: -31, z: 33, team: 'red' },
      { name: 'East Plateau', x: 33, z: 0, y: 3.5, team: 'blue' },
      { name: 'Northeast Rocks', x: 31, z: -33, team: 'blue' },
      { name: 'Southeast Rocks', x: 31, z: 33, team: 'blue' },
      { name: 'Ice Ring', x: 0, z: 5 },
      { name: 'North Pass', x: 0, z: -39 },
      { name: 'South Pass', x: 0, z: 39 },
    ],
    preview: ['#d5e2ec', '#9fd3f0', '#6f7c88', '#eef3f7'],
    theme: {
      sky: 0xc9d8e6, fog: 0xdfe8f0, fogNear: 22, fogFar: 115,
      ground: 0xe9eff4, groundLine: 0xd8e2ea,
      sun: 0xf4f8ff, sunI: 2.0, hemiSky: 0xe6f0ff, hemiGround: 0x8899aa, hemiI: 1.0,
      snow: true,
    },
    build() {
      const r = rng(9001);
      const boxes = [];
      const decor = [];
      perimeter(boxes, 44, 0x6f7c88, 8);
      const ice = 0x9fd3f0, rock = [0x6f7c88, 0x7d8a96, 0x5f6b77];
      // Ring of ice pillars
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        boxes.push({ x: Math.cos(a) * 10, z: Math.sin(a) * 10, w: 1.6, d: 1.6, h: 5, c: ice, opacity: 0.85 });
      }
      boxes.push({ x: 0, z: 0, w: 3, d: 3, h: 1.2, c: ice, opacity: 0.85 });
      // Two plateaus (team bases) with stairs
      for (const s of [-1, 1]) {
        boxes.push({ x: s * 32, z: 0, w: 12, d: 16, h: 3.5, c: pick(r, rock) });
        stairs(boxes, s * 19.5, -5, s > 0 ? 'x+' : 'x-', 7, 2.2, 0x8a96a2);
        stairs(boxes, s * 19.5, 5, s > 0 ? 'x+' : 'x-', 7, 2.2, 0x8a96a2);
        boxes.push({ x: s * 27, z: 0, w: 0.8, d: 3, h: 1.1, y: 3.5, c: ice, opacity: 0.85 });
      }
      const keepOut = [{ x: 0, z: 0, r: 12 }, { x: 32, z: 0, r: 12 }, { x: -32, z: 0, r: 12 }];
      // Rocks
      for (let i = 0; i < 26; i++) {
        const x = (r() - 0.5) * 82, z = (r() - 0.5) * 82;
        if (!clearOf(x, z, keepOut)) continue;
        const s = 1.5 + r() * 3;
        boxes.push({ x, z, w: s, d: s * (0.7 + r() * 0.6), h: 1.2 + r() * 3, c: pick(r, rock) });
      }
      // Snow drifts and ice blocks
      for (let i = 0; i < 20; i++) {
        const x = (r() - 0.5) * 82, z = (r() - 0.5) * 82;
        if (!clearOf(x, z, keepOut)) continue;
        if (r() < 0.5) boxes.push({ x, z, w: 3 + r() * 4, d: 2 + r() * 3, h: 0.5 + r() * 0.5, c: 0xf6f9fb });
        else boxes.push({ x, z, w: 1.4, d: 1.4, h: 1.4, c: ice, opacity: 0.85 });
      }
      return { boxes, decor };
    },
  },
};

export const MAP_ORDER = ['rustyard', 'dune', 'neon', 'frost'];
