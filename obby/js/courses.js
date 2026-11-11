// Hopscape courses. Each course is a string of stages; every stage starts on a checkpoint.
// Stages are built from obstacle "segments" laid end to end along +z, with a difficulty 0-3.
//
// Part kinds:
//   solid       static platform
//   kill        touching it sends you back to your checkpoint
//   move        oscillates along an axis (add kill: true for a moving hazard)
//   spin        kill bar rotating around the y axis
//   vanish      falls away shortly after you step on it, then comes back
//   blink       turns solid / not solid on a timer
//   pad         jump pad
//   conveyor    pushes you along `dir`
//   ice         slippery
//   checkpoint  saves your progress
//   finish      ends the course

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

class Builder {
  constructor(theme, r) {
    this.parts = [];
    this.checkpoints = [];
    this.theme = theme;
    this.r = r;
    this.x = 0; // center x of the last platform
    this.y = 0; // top surface of the last platform
    this.z = 0; // far edge of the last platform
    this.ci = 0;
  }
  color() {
    const p = this.theme.palette;
    return p[this.ci++ % p.length];
  }
  // A platform whose near edge is `gap` beyond the cursor.
  next(gap, dx, dy, w, d, o = {}) {
    const top = this.y + dy, z0 = this.z + gap, x = this.x + dx;
    const part = this.place(x, top, z0, w, d, o);
    this.x = x;
    this.y = top;
    this.z = z0 + d;
    return part;
  }
  place(x, top, z0, w, d, o = {}) {
    const h = o.h || 1;
    const part = { kind: 'solid', color: this.color(), x, y: top - h / 2, z: z0 + d / 2, w, h, d, ...o };
    if (part.h !== h) part.y = top - part.h / 2;
    this.parts.push(part);
    return part;
  }
  add(p) {
    this.parts.push(p);
    return p;
  }
}

const L = (d, arr) => arr[Math.min(d, arr.length - 1)];

export const SEGMENTS = {
  gaps(B, d) {
    const n = 4 + d, s = L(d, [3.2, 2.7, 2.2, 1.8]), g = L(d, [2.2, 2.7, 3.1, 3.4]);
    for (let i = 0; i < n; i++) {
      const dx = (B.r() - 0.5) * L(d, [2, 2.6, 3, 3]);
      const dy = B.r() < 0.5 ? 0.6 : -0.5;
      B.next(g + B.r() * 0.3, dx, dy, s, s);
    }
  },
  beam(B, d) {
    const w = L(d, [1.6, 1.25, 0.95, 0.75]);
    B.next(2.4, 0, 0, w, 8 + d);
    B.next(2.0, (B.r() < 0.5 ? -1 : 1) * 2, 0.4, w, 7 + d);
    B.next(2.0, (B.r() < 0.5 ? -1 : 1) * 1.5, 0, 3, 3);
  },
  stripes(B, d) {
    const len = 18, top = B.y;
    const base = B.next(2.4, 0, 0, 6, len);
    const z0 = B.z - len, kh = L(d, [0.5, 0.6, 0.8, 0.9]);
    for (let z = z0 + 3.2, i = 0; z < B.z - 2.5; z += 3.4, i++) {
      if (d >= 1 && i % 2 === 1) {
        const side = B.r() < 0.5 ? -1 : 1;
        B.add({ kind: 'kill', x: base.x + side * 1.2, y: top + kh / 2, z, w: 3.6, h: kh, d: 0.7 });
      } else {
        B.add({ kind: 'kill', x: base.x, y: top + kh / 2, z, w: 6, h: kh, d: 0.7 });
      }
    }
  },
  movers(B, d) {
    const n = d >= 2 ? 3 : 2, s = L(d, [3.4, 3.0, 2.6, 2.2]), amp = L(d, [2.5, 3, 3.5, 4]), sp = L(d, [0.9, 1.2, 1.5, 1.8]);
    for (let i = 0; i < n; i++) {
      B.next(2.4, 0, 0, s, s, { kind: 'move', axis: 'x', amp, speed: sp, phase: B.r() * 6 });
    }
    B.next(2.4, 0, 0, 4, 4);
  },
  spinner(B, d) {
    const p = B.next(2.4, 0, 0, 11, 11);
    const sp = L(d, [1.2, 1.7, 2.2, 2.7]);
    const top = B.y;
    B.add({ kind: 'spin', x: p.x, y: top + 0.5, z: p.z, len: 10.6, thick: 0.5, speed: sp, phase: 0 });
    if (d >= 2) B.add({ kind: 'spin', x: p.x, y: top + 0.5, z: p.z, len: 10.6, thick: 0.5, speed: sp, phase: Math.PI / 2 });
  },
  vanish(B, d) {
    const n = 4 + d, delay = L(d, [0.9, 0.7, 0.5, 0.4]);
    for (let i = 0; i < n; i++) B.next(2.4, (B.r() - 0.5) * 2, 0, 3, 3, { kind: 'vanish', delay, back: 2.5 });
    B.next(2.4, 0, 0, 4, 4);
  },
  pads(B, d) {
    const p = B.next(2.4, 0, 0, 5, 5);
    B.add({ kind: 'pad', x: p.x, y: B.y + 0.15, z: p.z, w: 2, h: 0.3, d: 2, power: 25 });
    B.next(3.0 + d * 0.4, (B.r() - 0.5) * 3, 6.5, L(d, [5, 4.5, 4, 3.5]), L(d, [5, 4.5, 4, 3.5]));
  },
  stairs(B, d) {
    const n = 5 + d, s = L(d, [3, 2.6, 2.2, 1.8]);
    let side = 1;
    for (let i = 0; i < n; i++) {
      B.next(1.7 + d * 0.2, side * 1.6, 1.1, s, s);
      side = -side;
    }
  },
  blink(B, d) {
    const period = L(d, [3.2, 2.8, 2.4, 2.0]);
    for (let i = 0; i < 5; i++) B.next(2.4, (B.r() - 0.5) * 1.5, 0, 3, 3, { kind: 'blink', period, phase: (i % 2) * 0.5, on: 0.6 });
    B.next(2.4, 0, 0, 4, 4);
  },
  conveyor(B, d) {
    const sideways = d >= 2;
    const w = sideways ? 3.6 : 4.5, sp = L(d, [2.5, 3.5, 4.0, 4.5]);
    const dir = sideways ? [B.r() < 0.5 ? -1 : 1, 0] : [0, -1];
    B.next(2.4, 0, 0, w, 16, { kind: 'conveyor', dir, speed: sp });
  },
  ice(B, d) {
    const n = 3 + d, s = L(d, [3.6, 3.2, 2.8, 2.5]);
    for (let i = 0; i < n; i++) B.next(2.6, (B.r() - 0.5) * 2.4, B.r() < 0.5 ? 0.4 : -0.3, s, s + 1, { kind: 'ice' });
    B.next(2.4, 0, 0, 4, 4);
  },
  pillars(B, d) {
    const n = 5 + d, s = L(d, [1.8, 1.5, 1.25, 1.05]), g = L(d, [2.0, 2.3, 2.6, 2.8]);
    for (let i = 0; i < n; i++) B.next(g, (B.r() - 0.5) * 2.4, (B.r() - 0.5) * 1.2, s, s, { h: 10 });
  },
  sweepers(B, d) {
    const len = 18, top = B.y;
    const base = B.next(2.4, 0, 0, 4.5, len);
    const sp = L(d, [1.4, 1.9, 2.4, 2.9]);
    for (let z = B.z - len + 3.5; z < B.z - 2.5; z += 3.6) {
      B.add({ kind: 'move', kill: true, axis: 'x', amp: 2.4, speed: sp, phase: B.r() * 6, x: base.x, y: top + 0.8, z, w: 1.2, h: 1.6, d: 1.2 });
    }
  },
  elevator(B, d) {
    const sp = L(d, [0.8, 1.0, 1.2, 1.4]);
    const top = B.y;
    // the elevator platform's top surface travels between top and top + 7
    B.next(2.2, 0, 3.5, 3.6, 3.6, { kind: 'move', axis: 'y', amp: 3.5, speed: sp, phase: -Math.PI / 2 });
    B.y = top + 7;
    B.next(2.2, 0, 0, 4.5, 4.5);
  },
};

export const COURSES = [
  {
    id: 'sunny', name: 'Sunny Steps', diff: 'Easy', seed: 101,
    blurb: 'Bright skies and friendly jumps. Learn the ropes.',
    sky: 0x8fd3ff, fog: 0xc9ebff, fogNear: 80, fogFar: 260, floor: 'clouds',
    palette: [0xffd166, 0x06d6a0, 0x4cc9f0, 0xff8fab, 0xb8f2a6], kill: 0xff3b3b,
    stages: [['gaps', 0], ['stairs', 0], ['beam', 0], ['stripes', 0], ['movers', 0], ['pads', 0], ['vanish', 0], ['blink', 0], ['spinner', 0], ['gaps', 1]],
  },
  {
    id: 'lava', name: 'Lava Leap', diff: 'Medium', seed: 202,
    blurb: 'Stone islands over a sea of lava. Don\'t look down.',
    sky: 0x3a1a14, fog: 0x7a2e12, fogNear: 50, fogFar: 200, floor: 'lava',
    palette: [0x8d6e63, 0x6d4c41, 0xa1887f, 0x795548, 0xbcaaa4], kill: 0xff5a1f,
    stages: [['gaps', 1], ['stripes', 1], ['sweepers', 1], ['movers', 1], ['pillars', 1], ['spinner', 1], ['vanish', 1], ['pads', 1], ['elevator', 1], ['conveyor', 1], ['blink', 1], ['gaps', 2]],
  },
  {
    id: 'neon', name: 'Neon Tower', diff: 'Hard', seed: 303,
    blurb: 'A glowing climb through the night. Timing is everything.',
    sky: 0x0b0a1f, fog: 0x15123a, fogNear: 40, fogFar: 170, floor: 'grid',
    palette: [0x2b2d6e, 0x3a1f5d, 0x1f3b6e, 0x262a55], kill: 0xff2e88, glow: [0x3dfcff, 0xff3df0, 0xffe53d, 0x7dff8a],
    stages: [['stairs', 2], ['pillars', 2], ['blink', 2], ['spinner', 2], ['pads', 2], ['sweepers', 2], ['elevator', 2], ['vanish', 2], ['beam', 2], ['conveyor', 2], ['movers', 2], ['stripes', 2], ['gaps', 3]],
  },
  {
    id: 'frost', name: 'Frost Summit', diff: 'Expert', seed: 404,
    blurb: 'Slippery ice, tiny pillars and a long way down. For legends only.',
    sky: 0xb9d4ea, fog: 0xe3eef7, fogNear: 40, fogFar: 180, floor: 'mist', snow: true,
    palette: [0xe8f1f8, 0xc5d8e8, 0xa9c3d9, 0xdbe7f1], kill: 0x2f7dff,
    stages: [['ice', 2], ['pillars', 3], ['spinner', 3], ['ice', 3], ['vanish', 3], ['sweepers', 3], ['blink', 3], ['pads', 3], ['conveyor', 3], ['elevator', 3], ['beam', 3], ['movers', 3], ['stripes', 3], ['gaps', 3]],
  },
];

export function buildCourse(def) {
  const B = new Builder(def, rng(def.seed));
  // start pad + first checkpoint
  B.place(0, 0, -10, 10, 10, { kind: 'solid', color: 0xffffff });
  B.x = 0;
  B.y = 0;
  B.z = 0;
  B.checkpoints.push({ x: 0, y: 0, z: -5 });
  def.stages.forEach(([seg, d], i) => {
    SEGMENTS[seg](B, d);
    const last = i === def.stages.length - 1;
    const cp = B.next(2.6, 0, 0, last ? 10 : 6, last ? 10 : 6, { kind: last ? 'finish' : 'checkpoint', color: last ? 0xffd34d : 0xffffff, index: i + 1 });
    B.checkpoints.push({ x: cp.x, y: B.y, z: cp.z });
  });
  let minTop = Infinity;
  for (const p of B.parts) if (p.kind !== 'spin') minTop = Math.min(minTop, p.y + p.h / 2 - (p.kind === 'move' && p.axis === 'y' ? p.amp : 0));
  return { def, parts: B.parts, checkpoints: B.checkpoints, floorY: minTop - 12, length: B.z };
}
