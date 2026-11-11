// Emberwood maps. The village is laid out by hand; the wilds are generated from fixed seeds
// so every player gets the same world, with carved paths that always connect the key spots.

export const T = {
  GRASS: 0, FLOWERS: 1, PATH: 2, WATER: 3, TREE: 4, ROCK: 5, WALL: 6, FENCE: 7,
  CAVE: 8, CAVE_WALL: 9, LAVA: 10, BRIDGE: 11, BUSH: 12, MUSHROOM: 13, WELL: 14, DOOR: 15,
};

const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.FENCE, T.CAVE_WALL, T.BUSH, T.WELL, T.DOOR]);

export function isSolidTile(t) {
  return SOLID.has(t);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

class Grid {
  constructor(w, h, fill) {
    this.w = w;
    this.h = h;
    this.t = new Uint8Array(w * h).fill(fill);
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.TREE;
    return this.t[y * this.w + x];
  }
  set(x, y, v) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.t[y * this.w + x] = v;
  }
  rect(x0, y0, w, h, v) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, v);
  }
  disk(cx, cy, r, v, onlyIf) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && (!onlyIf || onlyIf(this.get(x, y)))) this.set(x, y, v);
      }
    }
  }
  // Wobbly tunnel between two points.
  carve(a, b, r, v, rand, wobble = 1.5) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const phase = rand() * 10, freq = 0.15 + rand() * 0.2;
    for (let d = 0; d <= len; d += 0.4) {
      const k = d / len;
      const off = Math.sin(d * freq + phase) * wobble * Math.sin(k * Math.PI);
      this.disk(a[0] + (b[0] - a[0]) * k + nx * off, a[1] + (b[1] - a[1]) * k + ny * off, r, v);
    }
  }
  border(thick, v) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (x < thick || y < thick || x >= this.w - thick || y >= this.h - thick) this.set(x, y, v);
      }
    }
  }
}

function freeSpots(grid, rand, count, avoid, minDist, allowed = [T.GRASS, T.FLOWERS, T.PATH, T.CAVE, T.MUSHROOM]) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < 5000) {
    const x = Math.floor(rand() * grid.w), y = Math.floor(rand() * grid.h);
    if (!allowed.includes(grid.get(x, y))) continue;
    // keep a clear tile on every side so nothing spawns wedged into a wall
    let ok = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isSolidTile(grid.get(x + dx, y + dy))) ok = false;
    if (!ok) continue;
    if (avoid.some((p) => Math.hypot(p[0] - x, p[1] - y) < minDist)) continue;
    if (out.some((p) => Math.hypot(p[0] - x, p[1] - y) < 2)) continue;
    out.push([x + 0.5, y + 0.5]);
  }
  return out;
}

// ------------------------------------------------------------------ village
function buildVillage() {
  const g = new Grid(40, 30, T.GRASS);
  const r = rng(11);
  g.border(2, T.TREE);
  // roads
  g.rect(2, 14, 38, 3, T.PATH); // east-west, opens to the meadow
  g.rect(19, 0, 3, 15, T.PATH); // north road to the woods
  g.rect(38, 14, 2, 3, T.PATH);
  g.rect(19, 0, 3, 2, T.PATH);
  // flowers
  for (let i = 0; i < 70; i++) {
    const x = 2 + Math.floor(r() * 36), y = 2 + Math.floor(r() * 26);
    if (g.get(x, y) === T.GRASS) g.set(x, y, T.FLOWERS);
  }
  const houses = [];
  const house = (x, y, w, h, roof, label, doorTop = false) => {
    g.rect(x, y, w, h, T.WALL);
    const dx = x + Math.floor(w / 2);
    const dy = doorTop ? y : y + h - 1;
    g.set(dx, dy, T.DOOR);
    houses.push({ x, y, w, h, roof, label, door: [dx, dy], doorTop });
  };
  house(23, 4, 7, 5, '#7d3c98', 'Elder\'s Hall');
  house(4, 5, 7, 5, '#5d6d7e', 'Smithy');
  house(29, 19, 7, 5, '#16a085', 'Herbalist', true);
  house(4, 19, 9, 6, '#c0392b', 'The Sleepy Ember Inn', true);
  house(15, 20, 5, 4, '#b9770e', 'Mira\'s Cottage', true);
  // smithy anvil + well + fences + pond
  g.set(12, 10, T.ROCK);
  g.set(24, 18, T.WELL);
  for (let x = 22; x <= 27; x++) { g.set(x, 21, T.FENCE); g.set(x, 25, T.FENCE); }
  for (let y = 21; y <= 25; y++) { g.set(22, y, T.FENCE); g.set(27, y, T.FENCE); }
  for (let y = 22; y <= 24; y++) for (let x = 23; x <= 26; x++) g.set(x, y, T.FLOWERS);
  g.set(24, 21, T.GRASS); // garden gate
  g.disk(34, 9, 2.6, T.WATER);
  g.rect(31, 6, 1, 1, T.BUSH);
  g.set(14, 27, T.BUSH);
  g.set(30, 27, T.BUSH);

  return {
    id: 'village',
    name: 'Emberwood Village',
    music: 'village',
    grid: g,
    houses,
    safe: true,
    npcs: [
      { id: 'elder', x: 26.5, y: 10.4 },
      { id: 'bran', x: 7.5, y: 11.2 },
      { id: 'ivy', x: 32.5, y: 17.9 },
      { id: 'rosa', x: 8.5, y: 17.9 },
      { id: 'mira', x: 17.5, y: 18.6 },
      { id: 'tom', x: 35.5, y: 12.6 },
      { id: 'garrick', x: 17.6, y: 2.6 },
      { id: 'pip', x: 25.5, y: 17.2, wander: true },
    ],
    exits: [
      { x: 39, y: 14, w: 1, h: 3, to: 'meadow', tx: 2.5, ty: 18.5 },
      { x: 19, y: 0, w: 3, h: 1, to: 'woods', tx: 23.5, ty: 41.5, requires: 'slimes', msg: 'Garrick blocks the road: "Nobody goes north until the Elder says so."' },
    ],
    spawns: [],
    chests: [],
    start: [20.5, 18.5],
    innSpot: [8.5, 16.8],
  };
}

// ------------------------------------------------------------------ meadow
function buildMeadow() {
  const g = new Grid(50, 36, T.GRASS);
  const r = rng(202);
  g.border(2, T.TREE);
  // tree clumps, rocks, bushes, flowers
  for (let i = 0; i < 16; i++) g.disk(5 + r() * 40, 4 + r() * 28, 0.8 + r() * 1.6, T.TREE);
  for (let i = 0; i < 18; i++) g.set(3 + Math.floor(r() * 44), 3 + Math.floor(r() * 30), r() < 0.5 ? T.ROCK : T.BUSH);
  for (let i = 0; i < 160; i++) {
    const x = Math.floor(r() * 50), y = Math.floor(r() * 36);
    if (g.get(x, y) === T.GRASS) g.set(x, y, T.FLOWERS);
  }
  g.disk(37, 25, 4, T.WATER);
  g.disk(40, 27, 3, T.WATER);
  // the road in from the village, then a winding trail through the meadow
  g.carve([0, 18.5], [12, 17], 1.3, T.PATH, r, 1);
  g.carve([12, 17], [26, 12], 1.2, T.PATH, r, 2);
  g.carve([26, 12], [44, 9], 1.1, T.PATH, r, 2);
  g.carve([12, 17], [20, 29], 1.1, T.PATH, r, 2);
  g.carve([26, 12], [30, 24], 1.0, T.PATH, r, 1.5);
  g.rect(0, 17, 3, 3, T.PATH);
  // a little bridge where the trail meets the pond
  const entry = [[2, 18]];
  const slimes = freeSpots(g, r, 10, entry, 8).map(([x, y]) => ({ type: 'slime', x, y }));
  const bees = freeSpots(g, r, 5, entry, 10).map(([x, y]) => ({ type: 'bee', x, y }));
  return {
    id: 'meadow',
    name: 'Sunfield Meadow',
    grid: g,
    houses: [],
    npcs: [],
    exits: [{ x: 0, y: 17, w: 1, h: 3, to: 'village', tx: 37.5, ty: 15.5 }],
    spawns: [...slimes, ...bees],
    chests: [{ id: 'meadow_chest', x: 44.5, y: 6.5, items: ['potion_hp', 'potion_mp'], gold: 40 }],
  };
}

// ------------------------------------------------------------------ woods
function buildWoods() {
  const g = new Grid(46, 44, T.TREE);
  const r = rng(3033);
  const P = { entry: [23, 43], a: [23, 34], b: [11, 27], c: [34, 25], d: [12, 12], e: [33, 9], cave: [34, 1] };
  const carve = (p, q, w = 1.4) => g.carve(p, q, w, T.GRASS, r, 2.5);
  carve(P.entry, P.a, 1.5);
  carve(P.a, P.b);
  carve(P.a, P.c);
  carve(P.b, P.d);
  carve(P.c, P.e);
  carve(P.d, P.e, 1.2);
  carve(P.e, P.cave, 1.3);
  carve(P.b, [5, 36], 1.1);
  for (const [k, p] of Object.entries(P)) {
    if (k === 'entry' || k === 'cave') continue;
    g.disk(p[0], p[1], 3.6 + r() * 1.2, T.GRASS);
  }
  // forest-floor decorations
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== T.GRASS) continue;
      const v = r();
      if (v < 0.07) g.set(x, y, T.MUSHROOM);
      else if (v < 0.13) g.set(x, y, T.FLOWERS);
    }
  }
  // a stream through clearing B with a bridge
  g.carve([2, 22], [18, 31], 0.8, T.WATER, r, 1);
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) {
    if (g.get(x, y) === T.WATER && Math.hypot(x - P.b[0], y - P.b[1]) > 7) g.set(x, y, T.TREE);
  }
  g.carve(P.a, P.b, 1.0, T.BRIDGE, r, 0); // the path over the stream becomes a bridge
  for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) {
    if (g.get(x, y) === T.BRIDGE) {
      // only keep bridge planks where there was water around; elsewhere it's plain grass
      let nearWater = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.get(x + dx, y + dy) === T.WATER) nearWater = true;
      if (!nearWater) g.set(x, y, T.GRASS);
    }
  }
  // the cave mouth
  g.rect(31, 0, 7, 3, T.CAVE_WALL);
  g.rect(33, 0, 3, 3, T.CAVE);
  g.rect(22, 42, 3, 2, T.PATH);
  const entry = [P.entry, P.a];
  const wolves = freeSpots(g, r, 8, entry, 9).map(([x, y]) => ({ type: 'wolf', x, y }));
  const shrooms = freeSpots(g, r, 6, entry, 9).map(([x, y]) => ({ type: 'shroom', x, y }));
  return {
    id: 'woods',
    name: 'Whispering Woods',
    grid: g,
    houses: [],
    npcs: [],
    exits: [
      { x: 22, y: 43, w: 3, h: 1, to: 'village', tx: 20.5, ty: 2.6 },
      { x: 33, y: 0, w: 3, h: 1, to: 'cave', tx: 22.5, ty: 37.5, requires: 'wolves', msg: 'Hot ash pours out of the cave. Hunter Tom said to deal with the wolves before going any deeper.' },
    ],
    spawns: [...wolves, ...shrooms],
    chests: [
      { id: 'amulet_chest', x: P.d[0] + 0.5, y: P.d[1] + 0.5, items: ['amulet'], gold: 20, quest: 'amulet' },
      { id: 'woods_chest', x: 5.5, y: 36.5, items: ['potion_hp', 'potion_hp'], gold: 35 },
    ],
  };
}

// ------------------------------------------------------------------ cave
function buildCave() {
  const g = new Grid(44, 40, T.CAVE_WALL);
  const r = rng(40404);
  const P = { entry: [22, 39], r1: [22, 32], r2: [9, 26], r3: [35, 26], r4: [11, 14], r5: [33, 14], boss: [22, 7] };
  const carve = (p, q, w = 1.4) => g.carve(p, q, w, T.CAVE, r, 2.5);
  carve(P.entry, P.r1, 1.5);
  carve(P.r1, P.r2);
  carve(P.r1, P.r3);
  carve(P.r2, P.r4);
  carve(P.r3, P.r5);
  carve(P.r4, P.boss, 1.3);
  carve(P.r5, P.boss, 1.3);
  for (const k of ['r1', 'r2', 'r3', 'r4', 'r5']) g.disk(P[k][0], P[k][1], 3.4 + r() * 1.4, T.CAVE);
  g.disk(P.boss[0], P.boss[1], 6.5, T.CAVE);
  // lava pools off to the sides of rooms, never on the main line
  for (const [x, y, rad] of [[6, 24, 1.6], [37, 29, 1.5], [14, 11, 1.3], [30, 11, 1.4], [17, 5, 1.2], [27, 4, 1.2], [22, 23, 1.1]]) {
    g.disk(x, y, rad, T.LAVA, (t) => t === T.CAVE);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(r() * g.w), y = Math.floor(r() * g.h);
    if (g.get(x, y) === T.CAVE && Math.hypot(x - P.boss[0], y - P.boss[1]) > 7) g.set(x, y, T.ROCK);
  }
  g.rect(21, 38, 3, 2, T.CAVE);
  const entry = [P.entry, P.r1, P.boss];
  const bats = freeSpots(g, r, 7, entry, 7).map(([x, y]) => ({ type: 'bat', x, y }));
  const skels = freeSpots(g, r, 6, entry, 7).map(([x, y]) => ({ type: 'skeleton', x, y }));
  return {
    id: 'cave',
    name: 'Ashen Cave',
    grid: g,
    houses: [],
    npcs: [],
    dark: true,
    exits: [{ x: 21, y: 39, w: 3, h: 1, to: 'woods', tx: 34.5, ty: 3.6 }],
    spawns: [...bats, ...skels, { type: 'warden', x: P.boss[0] + 0.5, y: P.boss[1] + 0.5, boss: true }],
    chests: [{ id: 'cave_chest', x: 7.5, y: 27.5, items: ['potion_hp', 'potion_mp', 'potion_hp'], gold: 80 }],
  };
}

export function buildWorld() {
  const maps = { village: buildVillage(), meadow: buildMeadow(), woods: buildWoods(), cave: buildCave() };
  // Make sure chests sit on open ground (they block movement themselves).
  for (const m of Object.values(maps)) {
    for (const c of m.chests) m.grid.disk(c.x, c.y, 1.2, m.dark ? T.CAVE : T.GRASS, (t) => t !== T.WATER && t !== T.LAVA);
  }
  return maps;
}
