// Hopscape: a 3D obstacle-course platformer.
import * as THREE from '../../vendor/three.module.js';
import { COURSES, buildCourse } from './courses.js';

const SAVE_KEY = 'hopscape_v1';
const GRAVITY = 42;
const JUMP_V = 14.5; // apex about 2.5 m
const SPEED = 8.5;
const HW = 0.42; // player half width
const PH = 2.0; // player height
const COLORS = ['#ff5d5d', '#ff9f1c', '#ffd23f', '#3bceac', '#3a86ff', '#8338ec', '#ff70a6', '#f5f5f5'];

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (s) => {
  if (s == null) return '--:--';
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
};

// ------------------------------------------------------------------ save data
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.courses) return s;
  } catch { /* ignore */ }
  return { color: COLORS[4], courses: {} };
}
const SAVE = loadSave();
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch { /* storage blocked */ }
}
const courseSave = (id) => (SAVE.courses[id] ||= { cp: 0, time: 0, deaths: 0, best: null, bestDeaths: null, done: false });

// ------------------------------------------------------------------ sound
const sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, dur, type = 'sine', vol = 0.12, slide = 1, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  jump() { this.tone(380, 0.12, 'square', 0.05, 1.8); },
  boing() { this.tone(180, 0.35, 'sine', 0.18, 4); },
  checkpoint() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.1, 1, i * 0.08)); },
  death() { this.tone(300, 0.35, 'sawtooth', 0.1, 0.3); },
  finish() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, 1, i * 0.11)); },
};

// ------------------------------------------------------------------ renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.id = 'view';
document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 600);
let scene = null;

function panelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 232 + Math.random() * 23;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 124, 124);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f3a';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffd23f';
  g.beginPath();
  g.moveTo(8, 44); g.lineTo(32, 16); g.lineTo(56, 44); g.lineTo(46, 44); g.lineTo(32, 28); g.lineTo(18, 44);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function gridTexture(bg, line) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = line;
  g.lineWidth = 3;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function lavaTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8300b';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = Math.random() < 0.5 ? '#ff7a1a' : '#ffc23d';
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 256, 6 + Math.random() * 22, 4 + Math.random() * 12, Math.random() * 3, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Box with UVs scaled so the texture tiles every 2 m on all faces.
function worldBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, (uv.getX(i) * dims[f][0]) / 2, (uv.getY(i) * dims[f][1]) / 2);
  }
  return geo;
}

// ------------------------------------------------------------------ state
const G = {
  mode: 'menu', course: null, def: null, parts: [], cpMeshes: [], keys: new Set(), locked: false,
  yaw: Math.PI, pitch: 0.38, dist: 10, sens: 0.0025, touch: { x: 0, y: 0 }, isTouch: matchMedia('(pointer: coarse)').matches,
  time: 0, deaths: 0, cp: 0, startedAt: 0, killMat: null, conveyorTex: null, floorTex: null, snow: null, sun: null, trophy: null,
  confetti: [],
};
const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: false, ground: null, coyote: 0, jumpBuf: 0, jumpHeld: false, cut: false,
  facing: 0, walk: 0, deadUntil: 0, mesh: null, limbs: null,
};

// ------------------------------------------------------------------ avatar
function buildAvatar(color) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 });
  const body = mat(color), skin = mat(0xffd9b3), dark = mat(0x2b2f3a), shoe = mat(0x1e2230);
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legL = pivot(-0.2, 0.9), legR = pivot(0.2, 0.9);
  legL.add(box(0.34, 0.8, 0.38, dark, 0, -0.4, 0), box(0.36, 0.14, 0.44, shoe, 0, -0.84, 0.03));
  legR.add(box(0.34, 0.8, 0.38, dark, 0, -0.4, 0), box(0.36, 0.14, 0.44, shoe, 0, -0.84, 0.03));
  g.add(box(0.82, 0.78, 0.46, body, 0, 1.28, 0));
  const armL = pivot(-0.56, 1.6), armR = pivot(0.56, 1.6);
  armL.add(box(0.26, 0.74, 0.3, body, 0, -0.34, 0), box(0.24, 0.16, 0.28, skin, 0, -0.76, 0));
  armR.add(box(0.26, 0.74, 0.3, body, 0, -0.34, 0), box(0.24, 0.16, 0.28, skin, 0, -0.76, 0));
  const head = box(0.6, 0.56, 0.56, skin, 0, 1.97, 0);
  g.add(head);
  const eye = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  g.add(box(0.09, 0.12, 0.02, eye, -0.13, 2.0, 0.29), box(0.09, 0.12, 0.02, eye, 0.13, 2.0, 0.29));
  g.add(box(0.2, 0.04, 0.02, eye, 0, 1.86, 0.29));
  P.limbs = { legL, legR, armL, armR };
  return g;
}

// ------------------------------------------------------------------ course loading
function loadCourse(def) {
  const C = buildCourse(def);
  G.course = C;
  G.def = def;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(def.sky);
  scene.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);
  scene.add(new THREE.HemisphereLight(0xffffff, def.floor === 'lava' ? 0x5a2010 : 0x667788, def.floor === 'grid' ? 0.9 : 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, def.floor === 'grid' ? 0.9 : 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30;
  sc.right = sc.top = 30;
  sc.near = 1;
  sc.far = 120;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  G.sun = sun;

  const tex = panelTexture();
  G.killMat = new THREE.MeshStandardMaterial({ color: def.kill, emissive: def.kill, emissiveIntensity: 0.8, roughness: 0.4 });
  G.conveyorTex = stripeTexture();
  const glow = def.glow;
  let glowI = 0;
  G.parts = C.parts.map((p) => {
    const part = { ...p, bx: p.x, by: p.y, bz: p.z, prev: new THREE.Vector3(p.x, p.y, p.z), cur: new THREE.Vector3(p.x, p.y, p.z), touchedAt: 0, gone: false, active: true };
    let mesh;
    if (p.kind === 'spin') {
      mesh = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(p.len, p.thick, p.thick), G.killMat);
      bar.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16), new THREE.MeshStandardMaterial({ color: 0x444a55, metalness: 0.4, roughness: 0.4 }));
      hub.position.y = -0.2;
      mesh.add(bar, hub);
    } else {
      let mat;
      if (p.kind === 'kill' || p.kill) mat = G.killMat;
      else if (p.kind === 'conveyor') {
        const t = G.conveyorTex.clone();
        t.needsUpdate = true;
        t.repeat.set(p.w / 1.5, p.d / 1.5);
        if (p.dir[0] !== 0) { t.rotation = p.dir[0] > 0 ? -Math.PI / 2 : Math.PI / 2; t.center.set(0.5, 0.5); }
        mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
        part.tex = t;
      } else if (p.kind === 'ice') {
        mat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.85 });
      } else if (p.kind === 'pad') {
        mat = new THREE.MeshStandardMaterial({ color: 0x39ff88, emissive: 0x20c060, emissiveIntensity: 0.9 });
      } else {
        mat = new THREE.MeshStandardMaterial({ color: p.color ?? 0xdddddd, map: tex, roughness: 0.75, transparent: p.kind === 'vanish' || p.kind === 'blink', opacity: 1 });
      }
      mesh = new THREE.Mesh(worldBox(p.w, p.h, p.d), mat);
      mesh.castShadow = p.h < 5;
      mesh.receiveShadow = true;
      if (glow && (p.kind === 'solid' || p.kind === 'checkpoint' || p.kind === 'move' && !p.kill)) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: glow[glowI++ % glow.length] }));
        mesh.add(edges);
      }
      if (p.kind === 'vanish') part.baseColor = mat.color.clone();
    }
    mesh.position.set(p.x, p.y, p.z);
    scene.add(mesh);
    part.mesh = mesh;
    if (p.kind === 'checkpoint' || p.kind === 'finish') decorateCheckpoint(part);
    return part;
  });
  // floor
  const size = 900;
  let floorMat;
  if (def.floor === 'lava') {
    G.floorTex = lavaTexture();
    G.floorTex.repeat.set(40, 40);
    floorMat = new THREE.MeshBasicMaterial({ map: G.floorTex });
  } else if (def.floor === 'grid') {
    G.floorTex = gridTexture('#0b0a1f', '#ff3df0');
    G.floorTex.repeat.set(150, 150);
    floorMat = new THREE.MeshBasicMaterial({ map: G.floorTex });
  } else {
    G.floorTex = null;
    floorMat = new THREE.MeshLambertMaterial({ color: def.floor === 'mist' ? 0xf2f7fb : 0xffffff });
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, C.floorY, C.length / 2);
  scene.add(floor);
  if (def.floor === 'clouds' || def.floor === 'mist') {
    const puff = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (let i = 0; i < 70; i++) {
      const cl = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 3, 12, 8), puff);
        s.position.set(k * 2.4 - 3.6, Math.random() * 1.2, Math.random() * 2);
        cl.add(s);
      }
      cl.position.set((Math.random() - 0.5) * 160, C.floorY + Math.random() * 4, -40 + Math.random() * (C.length + 80));
      scene.add(cl);
    }
  }
  if (def.snow) {
    const n = 2000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 40;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    G.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.9 }));
    scene.add(G.snow);
  } else G.snow = null;
  // player
  P.mesh = buildAvatar(SAVE.color);
  scene.add(P.mesh);
  scene.add(camera);
}

function decorateCheckpoint(part) {
  const top = part.y + part.h / 2;
  if (part.kind === 'finish') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0x996600, emissiveIntensity: 0.4, metalness: 0.5, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), gold);
      pillar.position.set(part.x + s * 4, top + 2.5, part.z + 3.5);
      pillar.castShadow = true;
      scene.add(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.7, 0.7), gold);
    beam.position.set(part.x, top + 5.2, part.z + 3.5);
    scene.add(beam);
    const trophy = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 1.0, 20), gold);
    cup.position.y = 1.4;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10), gold);
    stem.position.y = 0.6;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.9), gold);
    base.position.y = 0.15;
    trophy.add(cup, stem, base);
    trophy.position.set(part.x, top, part.z);
    scene.add(trophy);
    G.trophy = trophy;
    return;
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5 }));
  pole.position.set(part.x + 2.3, top + 1.6, part.z + 2.3);
  const flagMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, side: THREE.DoubleSide, emissive: 0x000000 });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8), flagMat);
  flag.position.set(part.x + 2.3 - 0.67, top + 2.75, part.z + 2.3);
  scene.add(pole, flag);
  part.flag = flagMat;
  part.flagMesh = flag;
}

// ------------------------------------------------------------------ part simulation
function updateParts(t, dt) {
  for (const p of G.parts) {
    p.prev.copy(p.cur);
    if (p.kind === 'move') {
      const off = Math.sin(t * p.speed + p.phase) * p.amp;
      p.cur.set(p.bx + (p.axis === 'x' ? off : 0), p.by + (p.axis === 'y' ? off : 0), p.bz + (p.axis === 'z' ? off : 0));
      p.mesh.position.copy(p.cur);
    } else if (p.kind === 'spin') {
      p.angle = t * p.speed + p.phase;
      p.mesh.rotation.y = p.angle;
    } else if (p.kind === 'vanish') {
      if (p.touchedAt) {
        const since = t - p.touchedAt;
        if (since < p.delay) {
          p.mesh.position.set(p.bx + Math.sin(t * 60) * 0.06, p.by, p.bz + Math.cos(t * 55) * 0.06);
          p.mesh.material.color.copy(p.baseColor).lerp(new THREE.Color(0xff4040), since / p.delay);
        } else if (since < p.delay + p.back) {
          p.gone = true;
          const k = (since - p.delay) / 0.6;
          p.mesh.position.set(p.bx, p.by - k * k * 6, p.bz);
          p.mesh.material.opacity = Math.max(0, 1 - k);
          p.mesh.visible = k < 1;
        } else {
          p.touchedAt = 0;
          p.gone = false;
          p.mesh.visible = true;
          p.mesh.material.opacity = 1;
          p.mesh.material.color.copy(p.baseColor);
          p.mesh.position.set(p.bx, p.by, p.bz);
        }
      }
    } else if (p.kind === 'blink') {
      const frac = ((t / p.period + p.phase) % 1 + 1) % 1;
      p.active = frac < p.on;
      const warn = p.active && frac > p.on - 0.14;
      p.mesh.material.opacity = p.active ? (warn && Math.floor(t * 14) % 2 ? 0.45 : 1) : 0.12;
    } else if (p.kind === 'conveyor') {
      if (p.dir[1] !== 0) p.tex.offset.y -= p.dir[1] * p.speed * dt / 1.5 * -1;
      else p.tex.offset.y += p.speed * dt / 1.5;
    } else if (p.kind === 'pad') {
      const k = Math.max(0, 1 - (t - (p.bounceAt || -9)) * 4);
      p.mesh.scale.y = 1 + k * 1.5;
    }
  }
  if (G.killMat) G.killMat.emissiveIntensity = 0.6 + Math.sin(t * 5) * 0.3;
  if (G.floorTex && G.def.floor === 'lava') { G.floorTex.offset.x += dt * 0.01; G.floorTex.offset.y += dt * 0.006; }
  if (G.trophy) G.trophy.rotation.y += dt * 1.5;
}

const isSolid = (p) =>
  (p.kind === 'solid' || p.kind === 'checkpoint' || p.kind === 'finish' || p.kind === 'pad' || p.kind === 'conveyor' || p.kind === 'ice'
    || (p.kind === 'move' && !p.kill) || (p.kind === 'vanish' && !p.gone) || (p.kind === 'blink' && p.active));
const box = (p) => ({
  minX: p.cur.x - p.w / 2, maxX: p.cur.x + p.w / 2, minY: p.cur.y - p.h / 2, maxY: p.cur.y + p.h / 2, minZ: p.cur.z - p.d / 2, maxZ: p.cur.z + p.d / 2,
});
function overlaps(b, shrink = 0) {
  const q = P.pos;
  return q.x + HW - shrink > b.minX && q.x - HW + shrink < b.maxX && q.z + HW - shrink > b.minZ && q.z - HW + shrink < b.maxZ
    && q.y + PH - shrink > b.minY && q.y + shrink < b.maxY;
}

// ------------------------------------------------------------------ player
function moveInput() {
  let x = 0, z = 0;
  const k = G.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) z += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  x += G.touch.x;
  z -= G.touch.y;
  const l = Math.hypot(x, z);
  if (l > 1) { x /= l; z /= l; }
  return [x, z];
}

function updatePlayer(dt, t) {
  if (t < P.deadUntil) return;
  const [ix, iz] = moveInput();
  const fx = -Math.sin(G.yaw), fz = -Math.cos(G.yaw);
  const rx = Math.cos(G.yaw), rz = -Math.sin(G.yaw);
  let wx = (fx * iz + rx * ix) * SPEED, wz = (fz * iz + rz * ix) * SPEED;
  const g = P.onGround ? P.ground : null;
  const ice = g && g.kind === 'ice';
  const accel = ice ? 9 : P.onGround ? 70 : 32;
  const dvx = wx - P.vel.x, dvz = wz - P.vel.z, dl = Math.hypot(dvx, dvz), maxDv = accel * dt;
  if (dl > maxDv) { P.vel.x += (dvx / dl) * maxDv; P.vel.z += (dvz / dl) * maxDv; } else { P.vel.x = wx; P.vel.z = wz; }
  if (Math.hypot(wx, wz) > 0.1) P.facing = Math.atan2(wx, wz);

  // carried by the ground
  if (g) {
    if (g.kind === 'move') P.pos.add(new THREE.Vector3().subVectors(g.cur, g.prev));
    if (g.kind === 'conveyor') { P.pos.x += g.dir[0] * g.speed * dt; P.pos.z += g.dir[1] * g.speed * dt; }
  }
  // jumping with coyote time and a jump buffer
  P.coyote = P.onGround ? 0.1 : Math.max(0, P.coyote - dt);
  P.jumpBuf = Math.max(0, P.jumpBuf - dt);
  if (P.jumpBuf > 0 && (P.onGround || P.coyote > 0)) {
    P.vel.y = JUMP_V;
    P.onGround = false;
    P.coyote = 0;
    P.jumpBuf = 0;
    P.cut = false;
    sfx.jump();
  }
  if (!P.jumpHeld && P.vel.y > 4 && !P.cut && !P.padBoost) {
    P.vel.y *= 0.55; // short hop when you let go early
    P.cut = true;
  }
  P.vel.y = Math.max(-45, P.vel.y - GRAVITY * dt);

  const solids = G.parts.filter((p) => isSolid(p));
  const boxes = solids.map((p) => [p, box(p)]);
  const step = (axis, delta) => {
    if (!delta) return null;
    P.pos[axis] += delta;
    let hit = null;
    for (const [p, b] of boxes) {
      if (!overlaps(b)) continue;
      hit = p;
      if (axis === 'y') {
        if (delta < 0) P.pos.y = b.maxY;
        else P.pos.y = b.minY - PH - 1e-4;
        P.vel.y = 0;
      } else if (axis === 'x') {
        P.pos.x = delta > 0 ? b.minX - HW - 1e-4 : b.maxX + HW + 1e-4;
        P.vel.x = 0;
      } else {
        P.pos.z = delta > 0 ? b.minZ - HW - 1e-4 : b.maxZ + HW + 1e-4;
        P.vel.z = 0;
      }
    }
    return hit;
  };
  const subs = Math.max(1, Math.ceil((Math.abs(P.vel.y) + Math.hypot(P.vel.x, P.vel.z)) * dt / 0.4));
  let landed = null;
  for (let i = 0; i < subs; i++) {
    step('x', (P.vel.x * dt) / subs);
    step('z', (P.vel.z * dt) / subs);
    const vy = P.vel.y;
    const h = step('y', (vy * dt) / subs);
    if (h && vy <= 0) landed = h;
  }
  // anything that moved into us pushes us out along the shallowest side
  for (const [, b] of boxes) {
    if (!overlaps(b, 0.02)) continue;
    const pens = [
      ['x', b.maxX - (P.pos.x - HW), 1], ['x', (P.pos.x + HW) - b.minX, -1],
      ['z', b.maxZ - (P.pos.z - HW), 1], ['z', (P.pos.z + HW) - b.minZ, -1],
      ['y', b.maxY - P.pos.y, 1],
    ].sort((a, c) => a[1] - c[1])[0];
    P.pos[pens[0]] += pens[1] * pens[2];
  }
  P.onGround = !!landed;
  P.ground = landed;
  if (landed) {
    P.padBoost = false;
    if (landed.kind === 'pad') {
      P.vel.y = landed.power;
      P.onGround = false;
      P.padBoost = true;
      landed.bounceAt = G.time; // parts animate on the course clock
      sfx.boing();
    } else if (landed.kind === 'vanish' && !landed.touchedAt) {
      landed.touchedAt = G.time;
    } else if ((landed.kind === 'checkpoint' || landed.kind === 'finish') && landed.index > G.cp) {
      reachCheckpoint(landed);
    }
  }
  // hazards
  for (const p of G.parts) {
    if (p.kind === 'kill' || (p.kind === 'move' && p.kill)) {
      if (overlaps(box(p), 0.08)) return die();
    } else if (p.kind === 'spin') {
      const dx = P.pos.x - p.cur.x, dz = P.pos.z - p.cur.z, a = p.angle;
      const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
      if (Math.abs(lx) < p.len / 2 + HW * 0.6 && Math.abs(lz) < p.thick / 2 + HW * 0.6 && P.pos.y < p.cur.y + p.thick / 2 && P.pos.y + PH > p.cur.y - p.thick / 2) return die();
    }
  }
  if (P.pos.y < G.course.floorY + 0.4) return die();
  // walking animation
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1;
  if (moving && P.onGround) P.walk += dt * 11;
  const swing = P.onGround ? Math.sin(P.walk) * (moving ? 0.7 : 0) : 0;
  const L = P.limbs;
  L.legL.rotation.x = P.onGround ? swing : -0.5;
  L.legR.rotation.x = P.onGround ? -swing : 0.3;
  L.armL.rotation.x = P.onGround ? -swing : -2.6;
  L.armR.rotation.x = P.onGround ? swing : -2.6;
  P.mesh.position.copy(P.pos);
  const dy = angleLerp(P.mesh.rotation.y, P.facing, 1 - Math.exp(-14 * dt));
  P.mesh.rotation.y = dy;
}
function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function reachCheckpoint(part) {
  G.cp = part.index;
  const S = courseSave(G.def.id);
  if (part.kind === 'finish') return finishCourse();
  S.cp = G.cp;
  S.time = G.time;
  S.deaths = G.deaths;
  persist();
  if (part.flag) {
    part.flag.color.set(0x39d98a);
    part.flag.emissive.set(0x0f5a33);
  }
  sfx.checkpoint();
  toast(`Checkpoint! Stage ${G.cp + 1} of ${G.def.stages.length}`);
  burst(P.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0x39d98a, 30);
}
function die() {
  if (now() < P.deadUntil) return;
  G.deaths++;
  P.deadUntil = now() + 0.55;
  sfx.death();
  burst(P.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xff4d4d, 24);
  P.mesh.visible = false;
  $('flash').classList.remove('on');
  void $('flash').offsetWidth;
  $('flash').classList.add('on');
  setTimeout(respawn, 550);
}
function respawn() {
  const cp = G.course.checkpoints[G.cp];
  P.pos.set(cp.x, cp.y + 0.01, cp.z);
  P.vel.set(0, 0, 0);
  P.onGround = false;
  P.ground = null;
  P.mesh.visible = true;
  P.mesh.position.copy(P.pos);
  // reset platforms that fell
  for (const p of G.parts) {
    if (p.kind === 'vanish' && p.touchedAt) {
      p.touchedAt = 0;
      p.gone = false;
      p.mesh.visible = true;
      p.mesh.material.opacity = 1;
      p.mesh.material.color.copy(p.baseColor);
      p.mesh.position.set(p.bx, p.by, p.bz);
    }
  }
}

// ------------------------------------------------------------------ effects
function burst(pos, color, n) {
  const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    scene.add(m);
    G.confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 8 + 2, (Math.random() - 0.5) * 9), life: 0.9 + Math.random() * 0.6 });
  }
}
function confettiShower(pos) {
  const colors = [0xff5d5d, 0xffd23f, 0x3bceac, 0x3a86ff, 0xff70a6, 0x8338ec];
  for (let i = 0; i < 6; i++) burst(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6)), colors[i], 22);
}
function updateConfetti(dt) {
  G.confetti = G.confetti.filter((c) => {
    c.life -= dt;
    if (c.life <= 0) { scene.remove(c.m); return false; }
    c.v.y -= 18 * dt;
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += dt * 8;
    c.m.rotation.y += dt * 6;
    return true;
  });
}

// ------------------------------------------------------------------ camera
function updateCamera(dt) {
  const target = P.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
  const cp = Math.cos(G.pitch);
  const want = target.clone().add(new THREE.Vector3(Math.sin(G.yaw) * cp * G.dist, Math.sin(G.pitch) * G.dist, Math.cos(G.yaw) * cp * G.dist));
  camera.position.lerp(want, 1 - Math.exp(-14 * dt));
  camera.lookAt(target);
  if (G.sun) {
    G.sun.position.set(P.pos.x + 20, P.pos.y + 40, P.pos.z + 10);
    G.sun.target.position.copy(P.pos);
  }
  if (G.snow) {
    G.snow.position.set(P.pos.x, P.pos.y - 15, P.pos.z);
    const a = G.snow.geometry.attributes.position.array;
    for (let i = 1; i < a.length; i += 3) { a[i] -= dt * 3; if (a[i] < 0) a[i] = 40; }
    G.snow.geometry.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ flow
function startCourse(def, fresh) {
  sfx.ensure();
  loadCourse(def);
  const S = courseSave(def.id);
  if (fresh || S.done) { S.cp = 0; S.time = 0; S.deaths = 0; S.done = false; }
  G.cp = Math.min(S.cp, def.stages.length - 1);
  G.time = S.time;
  G.deaths = S.deaths;
  // mark reached checkpoints
  for (const p of G.parts) if (p.kind === 'checkpoint' && p.index <= G.cp && p.flag) { p.flag.color.set(0x39d98a); p.flag.emissive.set(0x0f5a33); }
  G.yaw = Math.PI;
  G.pitch = 0.38;
  respawn();
  camera.position.copy(P.pos).add(new THREE.Vector3(0, 6, -10));
  G.mode = 'play';
  $('menu').hidden = true;
  $('finish').hidden = true;
  $('hud').hidden = false;
  $('hud-course').textContent = def.name;
  if (G.isTouch) { $('touch').hidden = false; $('pause').hidden = true; }
  else showPause(true);
  persist();
}
function finishCourse() {
  G.mode = 'finished';
  const S = courseSave(G.def.id);
  const time = G.time;
  const newBest = S.best == null || time < S.best;
  if (newBest) { S.best = time; S.bestDeaths = G.deaths; }
  S.done = true;
  S.cp = 0;
  S.time = 0;
  S.deaths = 0;
  persist();
  sfx.finish();
  confettiShower(P.pos.clone());
  if (document.pointerLockElement) document.exitPointerLock();
  $('touch').hidden = true;
  $('pause').hidden = true;
  $('fin-time').textContent = fmtTime(time);
  $('fin-deaths').textContent = G.deaths;
  $('fin-best').textContent = newBest ? 'New personal best!' : `Your best: ${fmtTime(S.best)}`;
  const idx = COURSES.indexOf(G.def);
  const next = COURSES[idx + 1];
  $('fin-next').hidden = !next;
  if (next) $('fin-next').textContent = `Next: ${next.name}`;
  setTimeout(() => { $('finish').hidden = false; }, 900);
}
function quitToMenu() {
  if (G.mode === 'play' && G.def) {
    const S = courseSave(G.def.id);
    S.time = G.time;
    S.deaths = G.deaths;
    S.cp = G.cp;
    persist();
  }
  G.mode = 'menu';
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').hidden = true;
  $('touch').hidden = true;
  $('pause').hidden = true;
  $('finish').hidden = true;
  showMenu();
}
function showPause(first) {
  $('pause').hidden = false;
  $('pause-title').textContent = first ? G.def.name : 'Paused';
  $('pause-sub').textContent = first
    ? `${G.def.diff} · ${G.def.stages.length} stages. Reach every checkpoint flag. Red blocks and falling send you back.`
    : `Stage ${G.cp + 1} of ${G.def.stages.length} · ${fmtTime(G.time)}`;
  $('pause-go').textContent = first ? 'Click to start' : 'Resume';
}

let toastT;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 1800);
}

// ------------------------------------------------------------------ menu
function showMenu() {
  $('menu').hidden = false;
  const grid = $('course-grid');
  grid.innerHTML = '';
  COURSES.forEach((def) => {
    const S = courseSave(def.id);
    const card = document.createElement('div');
    card.className = 'course';
    const sky = '#' + def.sky.toString(16).padStart(6, '0');
    const col = def.palette.map((c) => '#' + c.toString(16).padStart(6, '0'));
    const inProgress = S.cp > 0 && !S.done;
    card.innerHTML = `
      <div class="course-art" style="background: linear-gradient(180deg, ${sky}, ${'#' + def.fog.toString(16).padStart(6, '0')})">
        ${col.slice(0, 4).map((c, i) => `<span style="background:${c}; left:${12 + i * 20}%; bottom:${18 + (i % 2) * 22 + i * 6}%;"></span>`).join('')}
      </div>
      <div class="course-body">
        <div class="course-top"><h3>${def.name}</h3><span class="diff diff-${def.diff.toLowerCase()}">${def.diff}</span></div>
        <p>${def.blurb}</p>
        <div class="course-stats"><span>${def.stages.length} stages</span><span>Best ${fmtTime(S.best)}</span>${inProgress ? `<span>Saved at stage ${S.cp + 1}</span>` : ''}</div>
        <div class="course-btns">
          <button class="btn btn-go" data-play="${def.id}">${inProgress ? 'Continue' : 'Play'}</button>
          ${inProgress ? `<button class="btn" data-restart="${def.id}">Start over</button>` : ''}
        </div>
      </div>`;
    grid.appendChild(card);
  });
  for (const b of grid.querySelectorAll('[data-play]')) b.addEventListener('click', () => startCourse(COURSES.find((c) => c.id === b.dataset.play), false));
  for (const b of grid.querySelectorAll('[data-restart]')) b.addEventListener('click', () => startCourse(COURSES.find((c) => c.id === b.dataset.restart), true));
  const sw = $('swatches');
  sw.innerHTML = '';
  for (const c of COLORS) {
    const s = document.createElement('button');
    s.className = 'swatch' + (SAVE.color === c ? ' on' : '');
    s.style.background = c;
    s.setAttribute('aria-label', 'Avatar color ' + c);
    s.addEventListener('click', () => { SAVE.color = c; persist(); showMenu(); drawPreview(); });
    sw.appendChild(s);
  }
  drawPreview();
}

// little spinning avatar on the menu
const pv = { renderer: null, scene: null, cam: null, mesh: null };
function drawPreview() {
  const holder = $('avatar-preview');
  if (!pv.renderer) {
    pv.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    pv.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    pv.renderer.setSize(120, 140);
    pv.renderer.outputColorSpace = THREE.SRGBColorSpace;
    holder.appendChild(pv.renderer.domElement);
    pv.scene = new THREE.Scene();
    pv.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.5);
    d.position.set(2, 4, 5);
    pv.scene.add(d);
    pv.cam = new THREE.PerspectiveCamera(32, 120 / 140, 0.1, 50);
    pv.cam.position.set(0, 1.4, 6);
    pv.cam.lookAt(0, 1.1, 0);
  }
  if (pv.mesh) pv.scene.remove(pv.mesh);
  const saveLimbs = P.limbs;
  pv.mesh = buildAvatar(SAVE.color);
  P.limbs = saveLimbs;
  pv.scene.add(pv.mesh);
}

// ------------------------------------------------------------------ input
const canvas = renderer.domElement;
window.addEventListener('keydown', (e) => {
  if (G.mode !== 'play') return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { P.jumpBuf = 0.12; } P.jumpHeld = true; }
  if (e.code === 'KeyR') die();
  G.keys.add(e.code);
});
window.addEventListener('keyup', (e) => {
  G.keys.delete(e.code);
  if (e.code === 'Space') P.jumpHeld = false;
});
window.addEventListener('blur', () => { G.keys.clear(); P.jumpHeld = false; });
canvas.addEventListener('click', () => {
  if (G.mode === 'play' && !G.locked && !G.isTouch) canvas.requestPointerLock?.();
});
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === canvas;
  if (G.mode !== 'play' || G.isTouch) return;
  if (G.locked) $('pause').hidden = true;
  else showPause(false);
});
document.addEventListener('mousemove', (e) => {
  if (!G.locked) return;
  G.yaw -= e.movementX * G.sens;
  G.pitch = clamp(G.pitch + e.movementY * G.sens, -0.25, 1.35);
});
canvas.addEventListener('wheel', (e) => { G.dist = clamp(G.dist + Math.sign(e.deltaY) * 1.2, 4.5, 18); }, { passive: true });
$('pause-go').addEventListener('click', () => { sfx.ensure(); canvas.requestPointerLock?.(); });
$('pause-retry').addEventListener('click', () => { die(); canvas.requestPointerLock?.(); });
$('pause-menu').addEventListener('click', quitToMenu);
$('fin-again').addEventListener('click', () => startCourse(G.def, true));
$('fin-next').addEventListener('click', () => startCourse(COURSES[COURSES.indexOf(G.def) + 1], true));
$('fin-menu').addEventListener('click', quitToMenu);

function setupTouch() {
  if (!G.isTouch) return;
  const stick = $('stick'), knob = $('knob'), look = $('look');
  let sid = null, so = null, lid = null, ll = null;
  stick.addEventListener('pointerdown', (e) => {
    sfx.ensure();
    sid = e.pointerId;
    const r = stick.getBoundingClientRect();
    so = [r.left + r.width / 2, r.top + r.height / 2];
    try { stick.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - so[0], dy = e.clientY - so[1];
    const l = Math.hypot(dx, dy), max = 50;
    if (l > max) { dx *= max / l; dy *= max / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    G.touch.x = dx / max;
    G.touch.y = dy / max;
  });
  const endS = (e) => { if (e.pointerId !== sid) return; sid = null; knob.style.transform = ''; G.touch.x = G.touch.y = 0; };
  stick.addEventListener('pointerup', endS);
  stick.addEventListener('pointercancel', endS);
  look.addEventListener('pointerdown', (e) => { lid = e.pointerId; ll = [e.clientX, e.clientY]; try { look.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lid) return;
    G.yaw -= (e.clientX - ll[0]) * 0.008;
    G.pitch = clamp(G.pitch + (e.clientY - ll[1]) * 0.006, -0.25, 1.35);
    ll = [e.clientX, e.clientY];
  });
  const endL = (e) => { if (e.pointerId === lid) lid = null; };
  look.addEventListener('pointerup', endL);
  look.addEventListener('pointercancel', endL);
  const jump = $('t-jump');
  jump.addEventListener('pointerdown', (e) => { e.preventDefault(); sfx.ensure(); P.jumpBuf = 0.12; P.jumpHeld = true; });
  const up = () => { P.jumpHeld = false; };
  jump.addEventListener('pointerup', up);
  jump.addEventListener('pointercancel', up);
  jump.addEventListener('pointerleave', up);
  $('t-menu').addEventListener('click', () => { if (G.mode === 'play') { showPause(false); $('pause').hidden = false; } });
  $('pause-go').addEventListener('click', () => { if (G.isTouch) $('pause').hidden = true; });
}

// ------------------------------------------------------------------ loop
let last = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now();
  const raw = t - last;
  const dt = Math.min(0.033, raw);
  last = t;
  if (pv.renderer && !$('menu').hidden) {
    pv.mesh.rotation.y += raw * 1.2;
    pv.renderer.render(pv.scene, pv.cam);
  }
  if (!scene) return;
  const paused = G.mode === 'play' && !G.isTouch && !G.locked;
  const touchPaused = G.mode === 'play' && G.isTouch && !$('pause').hidden;
  if (G.mode === 'play' && !paused && !touchPaused) {
    G.time += raw;
    updateParts(G.time, dt);
    updatePlayer(dt, t);
  } else if (G.mode === 'finished') {
    updateParts(G.time, dt);
  }
  updateConfetti(dt);
  updateCamera(dt);
  if (G.mode === 'play' || G.mode === 'finished') {
    $('hud-stage').textContent = `Stage ${Math.min(G.cp + 1, G.def.stages.length)} / ${G.def.stages.length}`;
    $('hud-time').textContent = fmtTime(G.time);
    $('hud-deaths').textContent = G.deaths;
    const prog = clamp((P.pos.z + 10) / (G.course.length + 10), 0, 1);
    $('progress-fill').style.width = (prog * 100).toFixed(1) + '%';
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('beforeunload', () => { if (G.mode === 'play') quitToMenu(); });

setupTouch();
showMenu();
requestAnimationFrame(frame);
window.hopscape = { G, P, COURSES, startCourse, buildCourse, updateParts, updatePlayer };
