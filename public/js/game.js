// StrikeZone Arena game engine: world, characters, bots, combat, HUD and netcode.
//
// Networking model (kept simple for playing with friends):
// - Every browser simulates its own player and sends its position ~15x per second.
// - The room host simulates the bots and keeps the scoreboard.
// - The shooter decides what they hit; the victim's owner applies the damage.

import * as THREE from '../vendor/three.module.js';
import { ROLES, ROLE_ORDER } from './roles.js';
import { MAPS } from './maps.js';
import { MELEE, THROWING, GRENADE, MEDKIT, COINS } from './weapons.js';

const EYE = 1.6;
const HEIGHT = 1.85;
const RADIUS = 0.4;
const GRAVITY = 24;
const JUMP_V = 8.6;
const STEP = 0.55;
const RESPAWN_TIME = 3.5;
const NET_RATE = 1 / 15;
const SYNC_RATE = 2;

const BOT_NAMES = ['Viper', 'Nova', 'Ghost', 'Rook', 'Blaze', 'Echo', 'Onyx', 'Talon', 'Jinx', 'Raptor', 'Sable', 'Hex'];
const DIFFICULTY = {
  easy: { spread: 0.085, react: 0.8, turn: 3.2, view: 45 },
  normal: { spread: 0.05, react: 0.45, turn: 6, view: 60 },
  hard: { spread: 0.026, react: 0.24, turn: 10, view: 80 },
};
const PREFERRED_RANGE = { heavy: 7, scout: 10, assault: 16, medic: 13, sniper: 30 };
const TEAM_COLORS = { red: 0xe0453a, blue: 0x3a8be0 };
const SLOT_CODES = { g: 'gun', m: 'melee', t: 'throw' };
const CROWN_SVG = '<svg class="crown-ico" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 13 L3.5 3 L8.5 8.5 L12 1.5 L15.5 8.5 L20.5 3 L22 13 Z"/><rect x="2" y="13.5" width="20" height="2.5" rx="1"/></svg>';
const SLOT_ORDER = ['gun', 'melee', 'throw'];

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function rayAABB(o, d, b) {
  let tmin = 0, tmax = Infinity;
  for (const [oa, da, mn, mx] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < mn || oa > mx) return Infinity;
    } else {
      let t1 = (mn - oa) / da, t2 = (mx - oa) / da;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

function forwardFrom(yaw, pitch) {
  const cp = Math.cos(pitch);
  return new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// ---------------------------------------------------------------- audio
class Sfx {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.volume = 0.5;
  }
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        const len = this.ctx.sampleRate * 0.5;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  shot(role, vol = 1) {
    if (!this.ctx || vol < 0.02) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cfg = {
      assault: [2400, 0.09], scout: [3200, 0.06], heavy: [1100, 0.22], sniper: [1600, 0.35], medic: [3800, 0.08],
    }[role] || [2000, 0.1];
    filter.frequency.setValueAtTime(cfg[0], t);
    filter.frequency.exponentialRampToValueAtTime(200, t + cfg[1]);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 * vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + cfg[1]);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + cfg[1] + 0.02);
  }
  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  noiseBurst(freq, dur, vol, type = 'lowpass', endFreq = 200) {
    if (!this.ctx || vol < 0.02) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
  swoosh(vol = 1) { this.noiseBurst(900, 0.18, 0.35 * vol, 'bandpass', 3500); }
  slice() { this.noiseBurst(4000, 0.08, 0.3, 'highpass', 1500); this.tone(220, 0.08, 'square', 0.12); }
  boom(vol = 1) { this.noiseBurst(1200, 0.9, 0.9 * vol, 'lowpass', 40); this.tone(70, 0.5, 'sine', 0.5 * vol, 0.5); }
  clink() { this.tone(2400, 0.05, 'triangle', 0.12); }
  coin() { this.tone(1320, 0.07, 'square', 0.1); setTimeout(() => this.tone(1760, 0.12, 'square', 0.1), 70); }
  hit(head) { this.tone(head ? 1600 : 1100, 0.06, 'square', 0.12); }
  kill() { this.tone(660, 0.1, 'triangle', 0.3); setTimeout(() => this.tone(990, 0.16, 'triangle', 0.3), 90); }
  hurt() { this.tone(140, 0.15, 'sawtooth', 0.18, 0.6); }
  ability() { this.tone(440, 0.25, 'sine', 0.25, 2); }
  reload() { this.tone(300, 0.05, 'square', 0.1); setTimeout(() => this.tone(420, 0.05, 'square', 0.1), 120); }
}

// ---------------------------------------------------------------- textures
function panelTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 225 + Math.random() * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  g.strokeStyle = 'rgba(0,0,0,0.1)';
  g.lineWidth = 2;
  for (let x = 32; x < 128; x += 32) {
    g.beginPath();
    g.moveTo(x, 4);
    g.lineTo(x, 124);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function groundTexture(base, line) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#' + base.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#' + line.toString(16).padStart(6, '0');
  g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Scale box UVs so one texture tile covers 2 meters on every face.
function worldUVBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / 2, uv.getY(i) * dims[f][1] / 2);
    }
  }
  return geo;
}

function nameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px "Chakra Petch", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32);
  g.fillStyle = color;
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.6, 0.4, 1);
  return s;
}

// ---------------------------------------------------------------- game
export class Game {
  constructor(opts) {
    this.opts = opts;
    this.container = opts.container;
    this.map = MAPS[opts.mapId] || MAPS.rustyard;
    this.mode = opts.mode === 'tdm' ? 'tdm' : 'ffa';
    this.settings = opts.settings;
    this.diff = DIFFICULTY[opts.settings.difficulty] || DIFFICULTY.normal;
    this.net = opts.net && opts.net.connected ? opts.net : null;
    this.myId = String(opts.me.id);
    this.hostId = String(opts.hostId ?? this.myId);
    this.sensitivity = opts.sensitivity || 0.0022;
    this.sfx = new Sfx();
    this.chars = new Map();
    this.scores = {};
    this.knownNames = {};
    this.effects = [];
    this.keys = new Set();
    this.mouseDown = false;
    this.firedSincePress = false;
    this.zoom = false;
    this.endAt = null;
    this.ended = false;
    this.netTimer = 0;
    this.syncTimer = SYNC_RATE; // host sends bot list + scores on the first frame
    this.listeners = [];
    this.recentShooters = new Map();
    this.touch = { move: { x: 0, y: 0 }, active: false };
    this.killStreak = 0;
    this.wallet = opts.wallet || null; // shared with the menu; holds coins, unlocks and supplies
    this.onWalletChange = opts.onWalletChange || (() => {});
    this.projectiles = [];
    this.coinsEarned = 0;
    this.shake = 0;

    this.setupRenderer();
    this.buildWorld();
    this.setupViewModel();
    this.setupHUD();
    this.setupInput();

    // Local player
    const me = this.makeChar({ ...opts.me, id: this.myId, isLocal: true });
    this.me = me;
    this.applyLoadout();
    this.respawn(me);

    for (const p of opts.roster || []) this.addRemotePlayer(p);

    if (this.isHost) {
      this.endAt = now() + this.settings.timeLimit * 60;
      this.spawnBots(this.settings.bots);
    }
    this.ensureScore(this.myId);
    this.updateScoreHUD();

    this.clock = now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.toast(`${this.map.name} · ${this.mode === 'tdm' ? 'Team Deathmatch' : 'Free-for-all'} · First to ${this.settings.killLimit}`);
  }

  get isHost() {
    return !this.net || this.hostId === this.myId;
  }

  // ------------------------------------------------------------ setup
  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'game-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.baseFov = 75;

    this.on(window, 'resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  buildWorld() {
    const map = this.map;
    const theme = map.theme;
    const { boxes, decor } = map.build();
    this.size = map.size;
    this.scene.background = new THREE.Color(theme.sky);
    this.scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);

    this.scene.add(new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiI));
    const sun = new THREE.DirectionalLight(theme.sun, theme.sunI);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -this.size - 5;
    sc.right = sc.top = this.size + 5;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const gtex = groundTexture(theme.ground, theme.groundLine);
    gtex.repeat.set(this.size / 2, this.size / 2);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.size * 2 + 8, this.size * 2 + 8),
      new THREE.MeshStandardMaterial({ map: gtex, roughness: theme.night ? 0.35 : 0.95, metalness: theme.night ? 0.3 : 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const tex = panelTexture();
    const matCache = new Map();
    const getMat = (c, opacity) => {
      const key = c + ':' + (opacity || 1);
      if (!matCache.has(key)) {
        matCache.set(key, new THREE.MeshStandardMaterial({
          color: c, map: tex, roughness: 0.85, metalness: 0.05,
          transparent: !!opacity && opacity < 1, opacity: opacity || 1,
        }));
      }
      return matCache.get(key);
    };

    this.solids = [];
    for (const b of boxes) {
      const y = b.y || 0;
      this.solids.push({
        minX: b.x - b.w / 2, maxX: b.x + b.w / 2,
        minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2,
        minY: y, maxY: y + b.h,
      });
      const mesh = new THREE.Mesh(worldUVBox(b.w, b.h, b.d), getMat(b.c, b.opacity));
      mesh.position.set(b.x, y + b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
    for (const b of decor || []) {
      const mat = b.emissive
        ? new THREE.MeshBasicMaterial({ color: b.c, transparent: !!b.opacity, opacity: b.opacity || 1 })
        : getMat(b.c, b.opacity);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
      mesh.position.set(b.x, (b.y || 0) + b.h / 2, b.z);
      if (!b.emissive) mesh.castShadow = true;
      this.scene.add(mesh);
    }

    if (theme.snow) {
      const n = 1800;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rand(-this.size, this.size);
        pos[i * 3 + 1] = rand(0, 25);
        pos[i * 3 + 2] = rand(-this.size, this.size);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 }));
      this.scene.add(this.snow);
    }

    // shared effect resources
    this.tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.85 });
    this.sparkGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    this.healGeo = new THREE.RingGeometry(0.6, 0.9, 32);
    this.healMat = new THREE.MeshBasicMaterial({ color: 0x5cff9a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });

    this.generateSpawns();
    this.drawMinimapBase();
  }

  isFree(x, z, r = 0.9) {
    if (Math.abs(x) > this.size - 2 || Math.abs(z) > this.size - 2) return false;
    for (const b of this.solids) {
      if (b.minY > 2) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
    }
    return true;
  }

  generateSpawns() {
    this.spawns = { all: [], red: [], blue: [] };
    let tries = 0;
    while (this.spawns.all.length < 60 && tries++ < 5000) {
      const x = rand(-this.size + 3, this.size - 3);
      const z = rand(-this.size + 3, this.size - 3);
      if (!this.isFree(x, z, 1.1)) continue;
      const p = new THREE.Vector3(x, 0, z);
      this.spawns.all.push(p);
      if (x < -this.size * 0.4) this.spawns.red.push(p);
      if (x > this.size * 0.4) this.spawns.blue.push(p);
    }

    // Named spawn spots from the map. Each gets a handful of clear points within a few meters.
    this.zones = [];
    (this.map.spawnZones || []).forEach((z, index) => {
      const points = [];
      for (let k = 0; k < 60 && points.length < 10; k++) {
        const a = Math.random() * Math.PI * 2, d = k === 0 ? 0 : Math.sqrt(Math.random()) * 3.2;
        const p = this.spawnPointAt(z.x + Math.cos(a) * d, z.z + Math.sin(a) * d, z.y || 0);
        if (p) points.push(p);
      }
      // Nothing clear right there: use the nearest clear ground nearby.
      for (let rr = 1; rr <= 16 && !points.length; rr++) {
        for (let a = 0; a < Math.PI * 2 && !points.length; a += Math.PI / 8) {
          const p = this.spawnPointAt(z.x + Math.cos(a) * rr, z.z + Math.sin(a) * rr, 0);
          if (p) points.push(p);
        }
      }
      if (points.length) this.zones.push({ ...z, index, points, center: points[0] });
    });
    this.spawnChoice = null; // null = automatic (safest)
    this.buildSpawnPads();
  }

  // A clear standing spot at (x, z) on whatever surface is at height ~y, or null.
  spawnPointAt(x, z, y) {
    const r = 0.9;
    if (Math.abs(x) > this.size - 2 || Math.abs(z) > this.size - 2) return null;
    const probe = new THREE.Vector3(x, 0, z);
    const ground = this.groundAt(probe, 0.3, y + 0.05);
    if (Math.abs(ground - y) > 0.6) return null;
    for (const b of this.solids) {
      if (b.maxY <= ground + 0.05 || b.minY >= ground + HEIGHT) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return null;
    }
    probe.y = ground;
    return probe;
  }

  // Zones this character may spawn in: their team's bases in Team battle, every spot in Free-for-all.
  allowedZones(c) {
    if (this.mode !== 'tdm') return this.zones;
    const mine = this.zones.filter((z) => z.team === c.team);
    return mine.length ? mine : this.zones;
  }

  safestZone(c, zones) {
    const enemies = [...this.chars.values()].filter((o) => o.alive && o !== c && this.isEnemy(c, o));
    let best = zones[0], bestScore = -Infinity;
    for (const z of zones) {
      let minD = 60;
      for (const e of enemies) minD = Math.min(minD, e.pos.distanceTo(z.center));
      const score = minD + rand(0, 10); // a little variety so you don't always land in the same spot
      if (score > bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  buildSpawnPads() {
    this.pads = [];
    const ringGeo = new THREE.RingGeometry(2.7, 3.1, 48);
    const discGeo = new THREE.CircleGeometry(2.7, 48);
    for (const z of this.zones) {
      if (this.mode === 'tdm' && !z.team) continue; // shared spots aren't used in team battles
      const color = this.mode === 'tdm' ? TEAM_COLORS[z.team] : 0xffb020;
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
      const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const disc = new THREE.Mesh(discGeo, discMat);
      for (const m of [ring, disc]) {
        m.rotation.x = -Math.PI / 2;
        m.position.set(z.center.x, z.center.y + 0.04, z.center.z);
        m.renderOrder = 1;
        this.scene.add(m);
      }
      this.pads.push({ ring, disc, zone: z });
    }
  }

  pickSpawn(c) {
    const zones = this.allowedZones(c);
    if (zones.length) {
      let zone = null;
      if (c.isLocal && this.spawnChoice !== null) zone = zones.find((z) => z.index === this.spawnChoice);
      if (!zone) zone = this.safestZone(c, zones);
      c.lastZone = zone;
      // Within the zone, take the point farthest from anyone already standing there.
      const others = [...this.chars.values()].filter((o) => o.alive && o !== c);
      let best = zone.points[0], bestD = -1;
      for (let i = 0; i < 5; i++) {
        const p = zone.points[Math.floor(Math.random() * zone.points.length)];
        let d = 99;
        for (const o of others) d = Math.min(d, o.pos.distanceTo(p));
        if (d > bestD) { bestD = d; best = p; }
      }
      return best.clone();
    }
    let list = this.spawns.all;
    if (this.mode === 'tdm' && this.spawns[c.team]?.length) list = this.spawns[c.team];
    const enemies = [...this.chars.values()].filter((o) => o.alive && o !== c && this.isEnemy(c, o));
    let best = list[Math.floor(Math.random() * list.length)];
    let bestScore = -1;
    for (let i = 0; i < 10; i++) {
      const p = list[Math.floor(Math.random() * list.length)];
      let minD = 999;
      for (const e of enemies) minD = Math.min(minD, e.pos.distanceTo(p));
      if (minD > bestScore) {
        bestScore = minD;
        best = p;
      }
    }
    return best.clone();
  }

  drawMinimapBase() {
    const S = 160;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,14,24,0.7)';
    g.fillRect(0, 0, S, S);
    const k = S / (this.size * 2);
    for (const b of this.solids) {
      const h = b.maxY;
      g.fillStyle = h > 3 ? 'rgba(220,226,240,0.55)' : 'rgba(220,226,240,0.28)';
      g.fillRect((b.minX + this.size) * k, (b.minZ + this.size) * k, (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    }
    this.minimapBase = c;
    this.minimapScale = k;
  }

  setupViewModel() {
    this.vm = new THREE.Group();
    this.camera.add(this.vm);
    this.vmBase = new THREE.Vector3(0.2, -0.19, -0.42);
    this.vm.position.copy(this.vmBase);
    this.vm.scale.setScalar(0.7);
    this.muzzleLight = new THREE.PointLight(0xffc870, 0, 6);
    this.camera.add(this.muzzleLight);
    this.muzzleLight.position.set(0.26, -0.15, -1);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.flash.visible = false;
    this.vmMelee = new THREE.Group();
    this.vmThrow = new THREE.Group();
    this.camera.add(this.vmMelee, this.vmThrow);
    this.vmMelee.visible = this.vmThrow.visible = false;
    this.buildBlade(this.vmThrow, MELEE.knife.blade, 0.1);
    this.vmThrow.rotation.set(0.3, 0.2, -0.2);
  }

  // A blade + guard + handle pointing down -Z, added to `group`.
  buildBlade(group, blade, handleLen = 0.16) {
    while (group.children.length) group.remove(group.children[0]);
    const steel = new THREE.MeshStandardMaterial({
      color: blade.color, roughness: 0.25, metalness: 0.3,
      emissive: blade.glow ? blade.color : 0x222222, emissiveIntensity: blade.glow || 0.25,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.8 });
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, handleLen), dark);
    handle.position.z = -handleLen / 2;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.03), dark);
    guard.position.z = -handleLen;
    const b = new THREE.Mesh(new THREE.BoxGeometry(blade.width * 0.35, blade.width, blade.length), steel);
    b.position.z = -handleLen - blade.length / 2;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(blade.width * 0.3, blade.width * 0.6, 0.06), steel);
    tip.position.set(0, blade.width * 0.2, -handleLen - blade.length - 0.02);
    group.add(handle, guard, b, tip);
    return steel;
  }

  buildMeleeViewModel(id) {
    const M = MELEE[id] || MELEE.knife;
    this.vmMeleeMat = this.buildBlade(this.vmMelee, M.blade, id === 'knife' ? 0.12 : 0.24);
  }

  buildViewModel(role) {
    while (this.vm.children.length) this.vm.remove(this.vm.children[0]);
    const R = ROLES[role];
    const m = R.weapon.model;
    const gunMat = new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.55, metalness: 0.15, emissive: m.color, emissiveIntensity: 0.25 });
    const accentMat = new THREE.MeshStandardMaterial({ color: R.color, roughness: 0.5 });
    this.vmMats = [gunMat, accentMat];
    const body = new THREE.Mesh(new THREE.BoxGeometry(m.thick, m.thick * 1.5, m.length * 0.6), gunMat);
    body.position.z = -m.length * 0.1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(m.thick * 0.22, m.thick * 0.22, m.length * 0.55, 8), gunMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, m.thick * 0.3, -m.length * 0.55);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(m.thick * 1.05, m.thick * 0.3, m.length * 0.3), accentMat);
    stripe.position.set(0, m.thick * 0.4, -m.length * 0.1);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(m.thick * 0.8, m.thick * 2, m.thick * 0.9), gunMat);
    grip.position.set(0, -m.thick * 1.2, m.length * 0.08);
    grip.rotation.x = 0.25;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.2), new THREE.MeshStandardMaterial({ color: R.color }));
    hand.position.set(0, -m.thick * 1.6, m.length * 0.15);
    this.vm.add(body, barrel, stripe, grip, hand);
    if (role === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 10), gunMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, m.thick * 1.3, -m.length * 0.15);
      this.vm.add(scope);
    }
    if (role === 'heavy') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(m.thick * 0.9, m.thick * 0.7, m.length * 0.25), accentMat);
      pump.position.set(0, -m.thick * 0.2, -m.length * 0.45);
      this.vm.add(pump);
    }
    this.flash.position.set(0, m.thick * 0.3, -m.length * 0.85);
    this.vm.add(this.flash);
    this.vmMuzzleZ = -m.length * 0.85;
  }

  setupHUD() {
    this.hud = {
      root: $('hud'),
      hpFill: $('hp-fill'), hpText: $('hp-text'),
      ammo: $('ammo-text'), weapon: $('weapon-name'), reload: $('reload-bar'),
      abilityName: $('ability-name'), abilityFill: $('ability-fill'), abilityState: $('ability-state'),
      timer: $('timer'), score: $('score-line'),
      killfeed: $('killfeed'), minimap: $('minimap'),
      vignette: $('damage-vignette'), scope: $('scope-overlay'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      death: $('death-screen'), deathText: $('death-text'), deathTimer: $('death-timer'), spawnPicker: $('spawn-picker'),
      scoreboard: $('scoreboard'), pause: $('pause-overlay'),
      toast: $('toast'), banner: $('kill-banner'), status: $('status-effects'),
      touch: $('touch-controls'),
      slots: $('slots'), leaderboard: $('leaderboard'), coins: $('coins-amount'), coinPopup: $('coin-popup'),
    };
    this.hud.root.hidden = false;
    this.hud.killfeed.innerHTML = '';
    this.hud.death.hidden = true;
    this.hud.scoreboard.hidden = true;
    this.mmCtx = this.hud.minimap.getContext('2d');
  }

  on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    this.listeners.push([target, ev, fn, opts]);
  }

  setupInput() {
    const canvas = this.renderer.domElement;
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    this.on(window, 'keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      const shop = document.getElementById('shop');
      if (shop && !shop.hidden) return;
      this.keys.add(e.code);
      if (e.code === 'Tab') {
        e.preventDefault();
        this.renderScoreboard();
        this.hud.scoreboard.hidden = false;
      }
      if (e.code === 'KeyR' && this.me.slot === 'gun') this.startReload(this.me);
      if (this.me.alive) {
        if (e.code === 'Digit1') this.setSlot('gun');
        if (e.code === 'Digit2') this.setSlot('melee');
        if (e.code === 'Digit3') this.setSlot('throw');
        if (e.code === 'KeyV') { this.setSlot('melee'); this.meleeAttack(this.me); }
        if (e.code === 'KeyG') this.throwGrenade(this.me);
        if (e.code === 'KeyH') this.useMedkit();
      }
      if (e.code === 'KeyB' && this.opts.onOpenShop) this.opts.onOpenShop();
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.useAbility(this.me);
      if (!this.me.alive && /^(Digit|Numpad)[0-9]$/.test(e.code)) {
        const n = Number(e.code.slice(-1));
        const zones = this.allowedZones(this.me);
        if (n === 0) this.chooseSpawn(null);
        else if (zones[n - 1]) this.chooseSpawn(zones[n - 1].index);
      }
      if (e.code === 'Space') e.preventDefault();
    });
    this.on(window, 'keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.hud.scoreboard.hidden = true;
    });
    this.on(canvas, 'mousedown', (e) => {
      this.sfx.ensure();
      if (!this.locked && !this.isTouch) {
        canvas.requestPointerLock?.();
        return;
      }
      if (e.button === 0) {
        this.mouseDown = true;
        this.firedSincePress = false;
      }
      if (e.button === 2) this.zoom = true;
    });
    this.on(window, 'mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.zoom = false;
    });
    this.on(canvas, 'contextmenu', (e) => e.preventDefault());
    this.on(window, 'wheel', (e) => {
      if (this.locked && this.me.alive) this.cycleSlot(e.deltaY > 0 ? 1 : -1);
    });
    this.on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.isTouch) this.hud.pause.hidden = this.locked || this.ended;
      if (!this.locked) {
        this.mouseDown = false;
        this.zoom = false;
        this.keys.clear();
      }
    });
    this.on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const z = this.camera.fov / this.baseFov;
      this.me.yaw -= e.movementX * this.sensitivity * z;
      this.me.pitch -= e.movementY * this.sensitivity * z;
      this.me.pitch = Math.max(-1.45, Math.min(1.45, this.me.pitch));
    });
    this.on($('resume-btn'), 'click', () => {
      this.sfx.ensure();
      canvas.requestPointerLock?.();
    });

    if (this.isTouch) {
      this.hud.pause.hidden = true;
      this.hud.touch.hidden = false;
      this.setupTouch();
    } else {
      this.hud.touch.hidden = true;
      this.hud.pause.hidden = false;
    }
  }

  setupTouch() {
    const stick = $('touch-stick'), knob = $('touch-knob'), look = $('touch-look');
    let stickId = null, stickOrigin = null, lookId = null, lookLast = null;
    this.on(stick, 'pointerdown', (e) => {
      this.sfx.ensure();
      stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick.setPointerCapture(e.pointerId);
    });
    this.on(stick, 'pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
      const len = Math.hypot(dx, dy), max = 50;
      if (len > max) { dx *= max / len; dy *= max / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.move.x = dx / max;
      this.touch.move.y = dy / max;
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      this.touch.move.x = this.touch.move.y = 0;
    };
    this.on(stick, 'pointerup', endStick);
    this.on(stick, 'pointercancel', endStick);
    this.on(look, 'pointerdown', (e) => {
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
      look.setPointerCapture(e.pointerId);
    });
    this.on(look, 'pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      const z = this.camera.fov / this.baseFov;
      this.me.yaw -= (e.clientX - lookLast.x) * 0.006 * z;
      this.me.pitch -= (e.clientY - lookLast.y) * 0.006 * z;
      this.me.pitch = Math.max(-1.45, Math.min(1.45, this.me.pitch));
      lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    this.on(look, 'pointerup', endLook);
    this.on(look, 'pointercancel', endLook);
    const hold = (id, down, up) => {
      const el = $(id);
      this.on(el, 'pointerdown', (e) => { e.preventDefault(); this.sfx.ensure(); down(); });
      this.on(el, 'pointerup', () => up && up());
      this.on(el, 'pointercancel', () => up && up());
      this.on(el, 'pointerleave', () => up && up());
    };
    hold('touch-fire', () => { this.mouseDown = true; this.firedSincePress = false; }, () => { this.mouseDown = false; });
    hold('touch-jump', () => this.keys.add('Space'), () => this.keys.delete('Space'));
    hold('touch-zoom', () => { this.zoom = !this.zoom; });
    hold('touch-reload', () => this.startReload(this.me));
    hold('touch-ability', () => this.useAbility(this.me));
    hold('touch-swap', () => this.cycleSlot(1));
    hold('touch-nade', () => this.throwGrenade(this.me));
    hold('touch-med', () => this.useMedkit());
  }

  // ------------------------------------------------------------ characters
  makeChar({ id, name, role, team, isBot = false, isLocal = false }) {
    id = String(id);
    role = ROLES[role] ? role : 'assault';
    const R = ROLES[role];
    const c = {
      id, name, role, team: this.mode === 'tdm' ? team || 'red' : null, isBot, isLocal, R,
      pos: new THREE.Vector3(), netPos: new THREE.Vector3(), hv: new THREE.Vector3(),
      vy: 0, onGround: true, yaw: 0, pitch: 0, netYaw: 0, netPitch: 0,
      hp: R.hp, maxHp: R.hp, alive: true, respawnAt: 0, deadAt: 0,
      mag: R.weapon.mag, reloadUntil: 0, nextFire: 0, abilityReadyAt: 0, abilityUntil: 0,
      dashUntil: 0, dashDir: new THREE.Vector3(), lastDamageAt: -99, moving: false, walkPhase: 0,
      scale: role === 'heavy' ? 1.12 : role === 'scout' ? 0.95 : 1,
      cloaked: false, fortified: false,
      slot: 'gun', meleeId: 'knife', nextMelee: 0, swingAt: -9, throwLeft: 0, nextThrow: 0, nextGrenade: 0,
      hasThrowing: false, dashSpeed: 26, mods: { dmg: 1, mag: 1, reload: 1, speed: 1 },
    };
    this.knownNames[id] = name;
    if (!isLocal) this.buildCharModel(c);
    else this.buildViewModel(role);
    this.chars.set(id, c);
    this.ensureScore(id);
    return c;
  }

  buildCharModel(c) {
    const R = c.R;
    const g = new THREE.Group();
    const accent = c.team ? TEAM_COLORS[c.team] : 0x1e2129;
    const mk = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, transparent: true, ...extra });
    const bodyMat = mk(R.color), darkMat = mk(0x2a2d33), accentMat = mk(accent);
    const visorMat = mk(0x111111, { emissive: c.team ? accent : 0x66e0ff, emissiveIntensity: 0.9 });
    c.mats = [bodyMat, darkMat, accentMat, visorMat];
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    const legPivot = (x) => {
      const p = new THREE.Group();
      p.position.set(x, 0.85, 0);
      p.add(box(0.22, 0.85, 0.26, darkMat, 0, -0.42, 0));
      return p;
    };
    c.legL = legPivot(-0.15);
    c.legR = legPivot(0.15);
    g.add(c.legL, c.legR);
    g.add(box(0.62, 0.68, 0.36, bodyMat, 0, 1.18, 0));
    g.add(box(0.64, 0.12, 0.38, accentMat, 0, 1.4, 0));
    const head = new THREE.Group();
    head.position.y = 1.68;
    head.add(box(0.38, 0.38, 0.38, bodyMat, 0, 0, 0));
    head.add(box(0.3, 0.1, 0.04, visorMat, 0, 0.03, -0.2));
    g.add(head);
    c.head = head;
    const arms = new THREE.Group();
    arms.position.y = 1.32;
    arms.add(box(0.14, 0.14, 0.5, bodyMat, 0.28, 0, -0.18));
    arms.add(box(0.14, 0.14, 0.45, bodyMat, -0.16, 0, -0.3));
    const m = R.weapon.model;
    c.gunMesh = box(m.thick * 1.2, m.thick * 1.6, m.length, mk(m.color), 0.1, 0.04, -0.45 - m.length / 3);
    arms.add(c.gunMesh);
    const bladeMat = mk(0xd6dce6, { emissive: 0x333333 });
    c.mats.push(bladeMat);
    c.bladeMat = bladeMat;
    c.blade = box(0.035, 0.07, 1, bladeMat, 0.1, 0.06, -0.8);
    c.blade.visible = false;
    arms.add(c.blade);
    g.add(arms);
    c.arms = arms;
    g.scale.setScalar(c.scale);
    const tag = nameTag(c.name + (c.isBot ? ' [BOT]' : ''), c.team === 'red' ? '#ff8a80' : c.team === 'blue' ? '#8ac4ff' : '#f2f2f2');
    tag.position.y = 2.25 / c.scale;
    const friendly = this.mode === 'tdm' && c.team === this.opts.me.team;
    tag.material.depthTest = !friendly;
    g.add(tag);
    c.tag = tag;
    c.group = g;
    this.scene.add(g);
  }

  removeChar(id) {
    const c = this.chars.get(id);
    if (!c) return;
    if (c.group) {
      this.scene.remove(c.group);
      c.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    this.chars.delete(id);
  }

  addRemotePlayer(p) {
    const id = String(p.id);
    if (id === this.myId || this.chars.has(id)) return;
    this.syncTimer = SYNC_RATE; // bring the newcomer up to date right away
    const c = this.makeChar({ id, name: p.name, role: p.role, team: p.team });
    c.alive = false; // until we receive their first state
    c.group.visible = false;
    c.netSeen = false;
  }

  updateRoster(players, hostId) {
    const ids = new Set(players.map((p) => String(p.id)));
    for (const p of players) {
      const id = String(p.id);
      const existing = this.chars.get(id);
      if (existing && !existing.isLocal && (existing.role !== p.role || existing.team !== (this.mode === 'tdm' ? p.team : null))) {
        this.removeChar(id);
      }
      this.addRemotePlayer(p);
    }
    for (const [id, c] of this.chars) {
      if (!c.isLocal && !c.isBot && !ids.has(id)) this.removeChar(id);
    }
    if (hostId !== undefined) this.setHost(hostId);
    this.updateScoreHUD();
  }

  setHost(hostId) {
    const wasHost = this.isHost;
    this.hostId = String(hostId);
    if (!wasHost && this.isHost) {
      // We just took over bots and the scoreboard.
      for (const c of this.chars.values()) if (c.isBot) this.initBotAI(c);
      if (!this.endAt) this.endAt = now() + this.settings.timeLimit * 60;
      this.toast('You are now the host');
    }
  }

  spawnBots(count) {
    const teamCount = { red: 0, blue: 0 };
    if (this.mode === 'tdm') {
      for (const c of this.chars.values()) if (c.team) teamCount[c.team]++;
    }
    for (let i = 0; i < count; i++) {
      let team = null;
      if (this.mode === 'tdm') {
        team = teamCount.red <= teamCount.blue ? 'red' : 'blue';
        teamCount[team]++;
      }
      const b = this.makeChar({
        id: 'b' + i,
        name: BOT_NAMES[i % BOT_NAMES.length],
        role: ROLE_ORDER[Math.floor(Math.random() * ROLE_ORDER.length)],
        team, isBot: true,
      });
      b.meleeId = Math.random() < 0.35 ? 'katana' : 'knife';
      this.initBotAI(b);
      this.respawn(b);
    }
  }

  initBotAI(b) {
    b.ai = {
      target: null, think: 0, reactAt: 0, wp: null, strafe: 1, strafeAt: 0,
      lastPos: b.pos.clone(), stuckCheck: now() + 1.5, lastSeen: null, lastSeenAt: -99,
    };
  }

  respawn(c) {
    const p = this.pickSpawn(c);
    c.pos.copy(p);
    c.netPos.copy(p);
    c.vy = 0;
    c.hv.set(0, 0, 0);
    c.hp = c.maxHp;
    c.alive = true;
    c.mag = this.magOf(c);
    c.reloadUntil = 0;
    c.throwLeft = c.hasThrowing ? THROWING.count : 0;
    if (c.slot === 'throw' && !c.throwLeft) c.slot = 'gun';
    c.yaw = Math.atan2(p.x, p.z); // face the middle of the map
    c.netYaw = c.yaw;
    c.pitch = 0;
    c.abilityUntil = 0;
    c.spawnProtectUntil = now() + 1.5;
    if (c.group) {
      c.group.visible = true;
      c.group.rotation.x = 0;
    }
    if (c.isLocal) {
      this.updateSlotHUD();
      this.hud.death.hidden = true;
      if (c.lastZone) this.toast(`Deployed at ${c.lastZone.name}`, 1600);
    }
  }

  isEnemy(a, b) {
    if (a === b || a.id === b.id) return false;
    return this.mode === 'ffa' || a.team !== b.team;
  }

  ensureScore(id) {
    if (!this.scores[id]) this.scores[id] = { k: 0, d: 0 };
  }

  nameOf(id) {
    return this.knownNames[id] || this.chars.get(id)?.name || 'Unknown';
  }

  // ------------------------------------------------------------ physics
  moveChar(c, dx, dz, dt) {
    const p = c.pos, r = RADIUS * c.scale;
    let blocked = false;
    // Sub-step fast movement so we never tunnel through thin walls.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.3));
    for (let s = 0; s < steps; s++) {
      p.x += dx / steps;
      if (this.resolveAxis(p, r, 'x', dx)) blocked = true;
      p.z += dz / steps;
      if (this.resolveAxis(p, r, 'z', dz)) blocked = true;
    }
    c.vy -= GRAVITY * dt;
    let ny = p.y + c.vy * dt;
    if (c.vy > 0) {
      for (const b of this.solids) {
        if (b.minY >= p.y + HEIGHT - 0.01 && b.minY < ny + HEIGHT && this.overlapXZ(p, r, b)) {
          ny = b.minY - HEIGHT;
          c.vy = 0;
        }
      }
    }
    const ground = this.groundAt(p, r, p.y);
    if (ny <= ground) {
      ny = ground;
      c.vy = 0;
      c.onGround = true;
    } else {
      c.onGround = false;
    }
    p.y = ny;
    return blocked;
  }

  overlapXZ(p, r, b) {
    return p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ;
  }

  groundAt(p, r, y) {
    let g = 0;
    const rr = r * 0.8;
    for (const b of this.solids) {
      if (b.maxY > g && b.maxY <= y + STEP && p.x + rr > b.minX && p.x - rr < b.maxX && p.z + rr > b.minZ && p.z - rr < b.maxZ) {
        g = b.maxY;
      }
    }
    return g;
  }

  resolveAxis(p, r, axis, delta) {
    let hit = false;
    for (const b of this.solids) {
      if (b.maxY <= p.y + STEP || b.minY >= p.y + HEIGHT) continue;
      if (!this.overlapXZ(p, r, b)) continue;
      hit = true;
      if (axis === 'x') {
        if (delta > 0) p.x = b.minX - r - 1e-4;
        else if (delta < 0) p.x = b.maxX + r + 1e-4;
        else p.x = p.x < (b.minX + b.maxX) / 2 ? b.minX - r : b.maxX + r;
      } else {
        if (delta > 0) p.z = b.minZ - r - 1e-4;
        else if (delta < 0) p.z = b.maxZ + r + 1e-4;
        else p.z = p.z < (b.minZ + b.maxZ) / 2 ? b.minZ - r : b.maxZ + r;
      }
    }
    return hit;
  }

  // ------------------------------------------------------------ combat
  traceWorld(o, d, maxDist) {
    let t = maxDist;
    if (d.y < 0) t = Math.min(t, -o.y / d.y);
    for (const b of this.solids) {
      const bt = rayAABB(o, d, b);
      if (bt < t) t = bt;
    }
    return t;
  }

  hitboxes(c) {
    const s = c.scale, p = c.pos;
    return {
      body: { minX: p.x - 0.36 * s, maxX: p.x + 0.36 * s, minZ: p.z - 0.36 * s, maxZ: p.z + 0.36 * s, minY: p.y, maxY: p.y + 1.48 * s },
      head: { minX: p.x - 0.22 * s, maxX: p.x + 0.22 * s, minZ: p.z - 0.22 * s, maxZ: p.z + 0.22 * s, minY: p.y + 1.48 * s, maxY: p.y + 1.9 * s },
    };
  }

  traceShot(o, d, range, shooter) {
    let t = this.traceWorld(o, d, range);
    let hitChar = null, head = false;
    for (const c of this.chars.values()) {
      if (!c.alive || c === shooter || !this.isEnemy(shooter, c)) continue;
      if (c.netSeen === false) continue;
      const hb = this.hitboxes(c);
      const th = rayAABB(o, d, hb.head);
      if (th < t) { t = th; hitChar = c; head = true; }
      const tb = rayAABB(o, d, hb.body);
      if (tb < t) { t = tb; hitChar = c; head = false; }
    }
    return { t, hitChar, head };
  }

  eyeOf(c) {
    return new THREE.Vector3(c.pos.x, c.pos.y + EYE * c.scale, c.pos.z);
  }

  muzzleOf(c) {
    if (c.isLocal) {
      const v = new THREE.Vector3(0, 0, this.vmMuzzleZ || -0.6);
      this.vm.localToWorld(v);
      return v;
    }
    const f = forwardFrom(c.yaw, c.pitch);
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    return this.eyeOf(c).addScaledVector(f, 0.8).addScaledVector(right, 0.12).add(new THREE.Vector3(0, -0.28, 0));
  }

  fire(c) {
    const t = now();
    const W = c.R.weapon;
    if (!c.alive || t < c.nextFire || t < c.reloadUntil) return;
    if (c.mag <= 0) {
      this.startReload(c);
      return;
    }
    c.mag--;
    const adrenaline = c.role === 'assault' && t < c.abilityUntil;
    c.nextFire = t + W.fireDelay * (adrenaline ? 0.66 : 1) * (c.isBot && c.role === 'sniper' ? 1.4 : 1);
    if (c.cloaked) c.abilityUntil = 0; // shooting breaks cloak

    const origin = c.isLocal ? this.camera.getWorldPosition(new THREE.Vector3()) : this.eyeOf(c);
    const base = forwardFrom(c.yaw, c.pitch);
    let spread;
    if (c.isBot) spread = W.spread + this.diff.spread;
    else {
      const scoped = this.zoom && W.scopedSpread !== undefined;
      spread = scoped ? W.scopedSpread : this.zoom ? W.spread * 0.6 : W.spread;
      if (!c.onGround) spread += 0.03;
      else if (c.moving && !scoped) spread *= 1.4;
    }
    const muzzle = this.muzzleOf(c);
    const ends = [];
    const hits = new Map();
    for (let i = 0; i < W.pellets; i++) {
      const d = base.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spread)).normalize();
      const res = this.traceShot(origin, d, W.range, c);
      const end = origin.clone().addScaledVector(d, Math.min(res.t, W.range));
      ends.push(end);
      if (res.hitChar) {
        const dmg = W.damage * (c.mods?.dmg || 1) * (res.head ? (c.role === 'sniper' ? 2.5 : 1.8) : 1);
        const h = hits.get(res.hitChar) || { dmg: 0, head: false };
        h.dmg += dmg;
        h.head = h.head || res.head;
        hits.set(res.hitChar, h);
      } else if (res.t < W.range) {
        this.spawnSpark(end);
      }
    }
    for (const [victim, h] of hits) this.dealDamage(c, victim, Math.round(h.dmg), h.head);
    for (const e of ends) this.spawnTracer(muzzle, e);

    if (c.isLocal) {
      this.sfx.shot(c.role, 1);
      this.kick = Math.min(1, (this.kick || 0) + (c.role === 'sniper' || c.role === 'heavy' ? 1 : 0.35));
      this.me.pitch = Math.min(1.45, this.me.pitch + (c.role === 'sniper' ? 0.03 : c.role === 'heavy' ? 0.04 : 0.006));
      this.flash.visible = true;
      this.flash.rotation.z = Math.random() * Math.PI;
      this.muzzleLight.intensity = 3;
      this.flashUntil = t + 0.05;
    } else {
      this.playDistantShot(c, muzzle);
    }
    this.recentShooters.set(c.id, t);
    if (this.net && (c.isLocal || (c.isBot && this.isHost))) {
      const r2 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
      this.net.relay({ k: 'shot', id: c.id, o: r2(muzzle), e: ends.map(r2) });
    }
    if (c.mag <= 0) this.startReload(c);
  }

  playDistantShot(c, pos) {
    const d = this.camera.position.distanceTo(pos);
    this.sfx.shot(c.role, Math.max(0, 1 - d / 70) * 0.8);
  }

  startReload(c) {
    const t = now();
    if (!c.alive || t < c.reloadUntil || c.mag >= this.magOf(c)) return;
    c.reloadUntil = t + this.reloadOf(c);
    c.reloading = true;
    if (c.isLocal) this.sfx.reload();
  }

  dealDamage(attacker, victim, dmg, head, kind = 'gun') {
    if (!this.isEnemy(attacker, victim)) return;
    if (attacker.isLocal) {
      this.showHitmarker(head);
      this.sfx.hit(head);
    }
    if (victim.isLocal || (victim.isBot && this.isHost)) {
      this.applyDamage(victim, dmg, attacker.id, head, kind);
    } else if (this.net) {
      if (victim.isBot) this.net.relay({ k: 'hitBot', id: victim.id, dmg, head, kind, by: attacker.id, team: attacker.team }, 'host');
      else this.net.relay({ k: 'hit', dmg, head, kind, by: attacker.id }, Number(victim.id));
    }
  }

  applyDamage(victim, dmg, byId, head, kind = 'gun') {
    const t = now();
    if (!victim.alive) return;
    if (victim.spawnProtectUntil && t < victim.spawnProtectUntil) return;
    if (victim.role === 'heavy' && t < victim.abilityUntil) dmg *= 0.4;
    victim.hp -= dmg;
    victim.lastDamageAt = t;
    if (victim.isLocal) {
      this.sfx.hurt();
      this.hud.vignette.style.opacity = Math.min(0.9, 0.35 + dmg / 80);
      this.vignetteFade = t;
      this.lastAttacker = byId;
    }
    if (victim.isBot && victim.ai) {
      const attacker = this.chars.get(byId);
      if (attacker && attacker.alive && !victim.ai.target) {
        victim.ai.target = attacker;
        victim.ai.reactAt = t + this.diff.react;
      }
    }
    if (victim.hp <= 0) this.killChar(victim, byId, head, kind);
  }

  killChar(victim, byId, head, kind = 'gun') {
    victim.alive = false;
    victim.hp = 0;
    victim.deadAt = now();
    victim.respawnAt = now() + RESPAWN_TIME;
    if (victim.isLocal) {
      this.zoom = false;
      this.hud.death.hidden = false;
      this.hud.deathText.textContent = byId === victim.id ? 'You were eliminated' : `Eliminated by ${this.nameOf(byId)}`;
      this.renderSpawnPicker();
      this.killStreak = 0;
    }
    if (this.isHost) this.recordKill(byId, victim.id, head, kind);
    else if (this.net) this.net.relay({ k: 'died', victim: victim.id, by: byId, head, kind }, 'host');
  }

  // Host only: scoreboard is authoritative here.
  recordKill(by, victim, head, kind = 'gun') {
    this.ensureScore(by);
    this.ensureScore(victim);
    if (by !== victim) this.scores[by].k++;
    this.scores[victim].d++;
    const msg = { k: 'kill', by, victim, head, kind, scores: this.scores, names: { [by]: this.nameOf(by), [victim]: this.nameOf(victim) } };
    if (this.net) this.net.relay(msg);
    this.onKill(msg);
    this.checkWin();
  }

  onKill(msg) {
    this.scores = msg.scores;
    for (const [id, n] of Object.entries(msg.names || {})) if (n !== 'Unknown') this.knownNames[id] = n;
    const el = document.createElement('div');
    el.className = 'kf-row';
    const byC = this.chars.get(msg.by), vC = this.chars.get(msg.victim);
    const cls = (c, id) => (id === this.myId ? 'kf-me' : c?.team ? 'kf-' + c.team : '');
    const icon = { melee: '⟋', backstab: '⟋⟋', throw: '➶', grenade: '✹' }[msg.kind] || (msg.head ? '◎' : '✕');
    el.innerHTML = `<span class="${cls(byC, msg.by)}"></span><span class="kf-icon">${icon}</span><span class="${cls(vC, msg.victim)}"></span>`;
    el.children[0].textContent = this.nameOf(msg.by);
    el.children[2].textContent = this.nameOf(msg.victim);
    this.hud.killfeed.prepend(el);
    while (this.hud.killfeed.children.length > 5) this.hud.killfeed.lastChild.remove();
    setTimeout(() => el.remove(), 6000);
    if (msg.by === this.myId && msg.victim !== this.myId) {
      this.sfx.kill();
      this.killStreak++;
      const streak = this.killStreak >= 5 ? ' · UNSTOPPABLE' : this.killStreak >= 3 ? ' · ON A STREAK' : '';
      const how = { melee: 'SLICED · ', backstab: 'BACKSTAB · ', throw: 'KNIFE THROW · ', grenade: 'BLOWN UP · ' }[msg.kind] || (msg.head ? 'HEADSHOT · ' : '');
      this.showBanner(`${how}Eliminated ${this.nameOf(msg.victim)}${streak}`);
      this.showHitmarker(true, true);
      this.awardCoins(msg, vC);
    }
    this.updateScoreHUD();
  }

  teamScores() {
    const t = { red: 0, blue: 0 };
    for (const [id, s] of Object.entries(this.scores)) {
      const c = this.chars.get(id);
      if (c?.team) t[c.team] += s.k;
    }
    return t;
  }

  checkWin() {
    if (this.ended || !this.isHost) return;
    const limit = this.settings.killLimit;
    let done = false;
    if (this.mode === 'tdm') {
      const t = this.teamScores();
      done = t.red >= limit || t.blue >= limit;
    } else {
      done = Object.values(this.scores).some((s) => s.k >= limit);
    }
    if (done || (this.endAt && now() >= this.endAt)) this.finish();
  }

  results() {
    const rows = Object.entries(this.scores)
      .filter(([id]) => this.chars.has(id))
      .map(([id, s]) => {
        const c = this.chars.get(id);
        return { id, name: this.nameOf(id), role: c?.role, team: c?.team, bot: !!c?.isBot, k: s.k, d: s.d };
      })
      .sort((a, b) => b.k - a.k || a.d - b.d);
    let winner = rows[0] ? rows[0].name : '—';
    let teamScores = null;
    if (this.mode === 'tdm') {
      teamScores = this.teamScores();
      winner = teamScores.red === teamScores.blue ? 'Draw' : teamScores.red > teamScores.blue ? 'Red Team' : 'Blue Team';
    }
    return { mode: this.mode, map: this.map.name, winner, teamScores, rows };
  }

  finish() {
    if (this.ended) return;
    const results = this.results();
    if (this.net) {
      this.net.send({ t: 'end', results });
    } else {
      this.opts.onEnd && this.opts.onEnd(results);
    }
    this.ended = true;
  }

  useAbility(c) {
    const t = now();
    if (!c.alive || t < c.abilityReadyAt) return;
    const A = c.R.ability;
    c.abilityReadyAt = t + A.cooldown;
    c.abilityUntil = t + A.duration;
    if (c.role === 'scout') {
      const dir = c.hv.clone().setY(0);
      if (dir.lengthSq() < 0.01) dir.copy(forwardFrom(c.yaw, 0));
      c.dashDir.copy(dir.normalize());
      c.dashUntil = t + A.duration;
    }
    if (c.role === 'medic') {
      c.hp = Math.min(c.maxHp, c.hp + 60);
      this.spawnHealRing(c.pos);
      for (const o of this.chars.values()) {
        if (o === c || !o.alive || this.isEnemy(c, o) || o.pos.distanceTo(c.pos) > 8) continue;
        if (o.isLocal || (o.isBot && this.isHost)) o.hp = Math.min(o.maxHp, o.hp + 60);
        else if (this.net && !o.isBot) this.net.relay({ k: 'heal', amount: 60 }, Number(o.id));
      }
      if (this.net) this.net.relay({ k: 'fx', type: 'heal', p: [c.pos.x, c.pos.y, c.pos.z] });
    }
    if (c.isLocal) {
      this.sfx.ability();
      this.toast(`${A.name}!`, 1200);
    }
  }

  // ------------------------------------------------------------ loadout, melee, throwables
  magOf(c) {
    return Math.round(c.R.weapon.mag * (c.mods?.mag || 1));
  }

  reloadOf(c) {
    return c.R.weapon.reload * (c.mods?.reload || 1);
  }

  // Apply the shop unlocks in the wallet to the local player. Safe to call mid-match.
  applyLoadout() {
    const c = this.me, w = this.wallet;
    if (!c) return;
    const own = (w && w.owned) || {};
    const oldMax = c.maxHp;
    c.mods = { dmg: own.hollow ? 1.15 : 1, mag: own.mags ? 1.5 : 1, reload: own.quick ? 0.65 : 1, speed: own.boots ? 1.1 : 1 };
    c.maxHp = c.R.hp + (own.kevlar ? 25 : 0);
    if (c.alive && c.maxHp > oldMax) c.hp += c.maxHp - oldMax;
    c.hp = Math.min(c.hp, c.maxHp);
    const want = w && w.melee;
    c.meleeId = MELEE[want] && (want === 'knife' || own[want]) ? want : 'knife';
    const hadThrowing = c.hasThrowing;
    c.hasThrowing = !!own.throwing;
    if (c.hasThrowing && !hadThrowing && c.alive) c.throwLeft = THROWING.count;
    if (!c.hasThrowing && c.slot === 'throw') c.slot = 'gun';
    if (c.mag > this.magOf(c)) c.mag = this.magOf(c);
    this.buildMeleeViewModel(c.meleeId);
    this.updateSlotHUD();
  }

  setSlot(slot) {
    const c = this.me;
    if (!c.alive || slot === c.slot) return;
    if (slot === 'throw') {
      if (!c.hasThrowing) {
        this.toast('Unlock Throwing Knives in the Armory (press B)', 1800);
        return;
      }
      if (c.throwLeft <= 0) {
        this.toast('Out of throwing knives until you respawn', 1500);
        return;
      }
    }
    c.slot = slot;
    this.zoom = false;
    this.slotChangedAt = now();
    this.sfx.clink();
    this.updateSlotHUD();
  }

  cycleSlot(dir) {
    const c = this.me;
    const avail = SLOT_ORDER.filter((s) => s !== 'throw' || (c.hasThrowing && c.throwLeft > 0));
    const i = avail.indexOf(c.slot);
    this.setSlot(avail[(i + dir + avail.length) % avail.length]);
  }

  updateSlotHUD() {
    const el = this.hud?.slots;
    if (!el || !this.me) return;
    const c = this.me, w = this.wallet || {};
    const item = (key, label, active, extra = '', dim = false) =>
      `<div class="slot${active ? ' on' : ''}${dim ? ' dim' : ''}"><kbd>${key}</kbd><span>${label}</span>${extra ? `<b>${extra}</b>` : ''}</div>`;
    el.innerHTML = item('1', c.R.weapon.name, c.slot === 'gun')
      + item('2', (MELEE[c.meleeId] || MELEE.knife).name, c.slot === 'melee')
      + (c.hasThrowing ? item('3', 'Knives', c.slot === 'throw', '×' + c.throwLeft, c.throwLeft <= 0) : '')
      + item('G', 'Grenade', false, '×' + (w.grenade | 0), !(w.grenade > 0))
      + item('H', 'Med Kit', false, '×' + (w.medkit | 0), !(w.medkit > 0))
      + (this.opts.onOpenShop ? item('B', 'Armory', false) : '');
  }

  meleeAttack(c) {
    const t = now();
    const M = MELEE[c.meleeId] || MELEE.knife;
    if (!c.alive || t < c.nextMelee) return;
    c.nextMelee = t + M.delay;
    c.swingAt = t;
    if (c.cloaked) c.abilityUntil = 0;
    const fwd = forwardFrom(c.yaw, 0);
    if (M.lunge && c.onGround) {
      c.dashDir.copy(fwd);
      c.dashSpeed = M.lunge;
      c.dashUntil = t + 0.13;
    }
    const eye = this.eyeOf(c);
    const targets = [];
    for (const o of this.chars.values()) {
      if (!o.alive || !this.isEnemy(c, o) || o.netSeen === false) continue;
      const to = o.pos.clone().sub(c.pos);
      const dy = to.y;
      to.y = 0;
      const dist = to.length() - RADIUS * o.scale;
      if (dist > M.reach || Math.abs(dy) > 1.7) continue;
      to.normalize();
      const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(fwd))));
      if (dist > 0.5 && ang > M.arc) continue;
      const chest = new THREE.Vector3(o.pos.x, o.pos.y + 1.1 * o.scale, o.pos.z);
      const d = chest.clone().sub(eye);
      const dl = d.length();
      d.divideScalar(dl);
      if (this.traceWorld(eye, d, dl) < dl - 0.2) continue;
      targets.push({ o, dist, chest });
    }
    targets.sort((a, b) => a.dist - b.dist);
    const hitList = M.cleave ? targets : targets.slice(0, 1);
    for (const { o, chest } of hitList) {
      // Behind the victim? Their facing direction points away from the attacker.
      const away = o.pos.clone().sub(c.pos).setY(0).normalize();
      const back = forwardFrom(o.yaw, 0).dot(away) > 0.45;
      const dmg = Math.round(M.damage * (back ? M.backstab : 1));
      this.dealDamage(c, o, dmg, back, back ? 'backstab' : 'melee');
      this.spawnSpark(chest);
    }
    const audible = c.isLocal ? 1 : Math.max(0, 1 - this.camera.position.distanceTo(c.pos) / 30);
    this.sfx.swoosh(audible);
    if (hitList.length && c.isLocal) this.sfx.slice();
    if (this.net && (c.isLocal || (c.isBot && this.isHost))) this.net.relay({ k: 'swing', id: c.id });
  }

  throwKnife(c) {
    const t = now();
    if (!c.alive || t < c.nextThrow || c.throwLeft <= 0) return;
    c.throwLeft--;
    c.nextThrow = t + THROWING.delay;
    c.swingAt = t;
    const dir = forwardFrom(c.yaw, c.pitch);
    const o = (c.isLocal ? this.camera.getWorldPosition(new THREE.Vector3()) : this.eyeOf(c)).addScaledVector(dir, 0.5);
    const v = dir.clone().multiplyScalar(THROWING.speed).add(new THREE.Vector3(0, 1.2, 0));
    this.launch('knife', c, o, v);
    this.sfx.swoosh(1);
    if (c.isLocal) this.updateSlotHUD();
  }

  throwGrenade(c) {
    const t = now();
    if (!c.alive || t < c.nextGrenade) return;
    if (!this.wallet || !(this.wallet.grenade > 0)) {
      this.toast('No grenades left · buy more in the Armory (press B)', 1800);
      return;
    }
    c.nextGrenade = t + 0.9;
    this.wallet.grenade--;
    this.onWalletChange();
    const dir = forwardFrom(c.yaw, c.pitch);
    const o = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.5);
    const v = dir.clone().multiplyScalar(GRENADE.speed).add(new THREE.Vector3(0, 4, 0));
    this.launch('grenade', c, o, v);
    this.sfx.swoosh(0.8);
    this.updateSlotHUD();
  }

  useMedkit() {
    const c = this.me;
    if (!c.alive) return;
    if (!this.wallet || !(this.wallet.medkit > 0)) {
      this.toast('No med kits · buy them in the Armory (press B)', 1800);
      return;
    }
    if (c.hp >= c.maxHp) {
      this.toast('Already at full health', 1200);
      return;
    }
    this.wallet.medkit--;
    this.onWalletChange();
    c.hp = Math.min(c.maxHp, c.hp + MEDKIT.heal);
    this.spawnHealRing(c.pos);
    this.sfx.ability();
    this.toast(`+${MEDKIT.heal} health`, 1200);
    this.updateSlotHUD();
  }

  launch(type, owner, o, v) {
    this.spawnProjectile(type, owner, o, v, true);
    if (this.net) {
      const r2 = (x) => [+x.x.toFixed(2), +x.y.toFixed(2), +x.z.toFixed(2)];
      this.net.relay({ k: 'proj', id: owner.id, type, o: r2(o), v: r2(v) });
    }
  }

  // `auth` projectiles belong to this browser and deal damage; the rest are visuals of a friend's throw.
  spawnProjectile(type, owner, o, v, auth) {
    let mesh;
    if (type === 'knife') {
      mesh = new THREE.Group();
      this.buildBlade(mesh, MELEE.knife.blade, 0.1);
    } else {
      mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.7 }));
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.06), new THREE.MeshStandardMaterial({ color: 0x888888 }));
      cap.position.y = 0.12;
      mesh.add(body, cap);
    }
    mesh.position.copy(o);
    this.scene.add(mesh);
    this.projectiles.push({ type, owner, pos: o.clone(), vel: v.clone(), mesh, born: now(), auth, stuck: false });
  }

  updateProjectiles(dt) {
    const t = now();
    this.projectiles = this.projectiles.filter((p) => {
      const remove = () => {
        this.scene.remove(p.mesh);
        return false;
      };
      if (p.type === 'knife') {
        if (p.stuck) return t - p.stuckAt > 4 ? remove() : true;
        if (t - p.born > 5) return remove();
        p.vel.y -= THROWING.gravity * dt;
        const step = p.vel.clone().multiplyScalar(dt);
        const len = step.length();
        const dir = step.clone().divideScalar(len);
        const res = this.traceShot(p.pos, dir, len, p.owner);
        if (res.hitChar) {
          if (p.auth) this.dealDamage(p.owner, res.hitChar, Math.round(THROWING.damage * (res.head ? 2 : 1)), res.head, 'throw');
          return remove();
        }
        const tw = this.traceWorld(p.pos, dir, len);
        if (tw < len) {
          p.pos.addScaledVector(dir, Math.max(0, tw - 0.08));
          p.stuck = true;
          p.stuckAt = t;
          p.mesh.position.copy(p.pos);
          this.spawnSpark(p.pos);
          this.sfx.clink();
          return true;
        }
        p.pos.add(step);
        p.mesh.position.copy(p.pos);
        p.mesh.lookAt(p.pos.clone().add(dir));
        p.mesh.rotateX(-(t - p.born) * 25);
        return true;
      }
      // grenade: bounce around, then explode
      p.vel.y -= 20 * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const pad = 0.14;
      if (Math.abs(step.x) > 1e-5) {
        const dx = new THREE.Vector3(Math.sign(step.x), 0, 0);
        if (this.traceWorld(p.pos, dx, Math.abs(step.x) + pad) < Math.abs(step.x) + pad) { p.vel.x *= -0.45; step.x = 0; }
      }
      if (Math.abs(step.z) > 1e-5) {
        const dz = new THREE.Vector3(0, 0, Math.sign(step.z));
        if (this.traceWorld(p.pos, dz, Math.abs(step.z) + pad) < Math.abs(step.z) + pad) { p.vel.z *= -0.45; step.z = 0; }
      }
      p.pos.x += step.x;
      p.pos.z += step.z;
      const ground = this.groundAt(p.pos, 0.05, p.pos.y - 0.12);
      let ny = p.pos.y + step.y;
      if (ny - 0.12 <= ground && p.vel.y < 0) {
        ny = ground + 0.12;
        if (Math.abs(p.vel.y) > 2) this.sfx.clink();
        p.vel.y = Math.abs(p.vel.y) < 1.5 ? 0 : -p.vel.y * 0.4;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.pos.y = ny;
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 8;
      if (t - p.born >= GRENADE.fuse) {
        this.explode(p);
        return remove();
      }
      return true;
    });
  }

  explode(p) {
    const center = p.pos.clone();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ball.position.copy(center);
    this.scene.add(ball);
    const light = new THREE.PointLight(0xff9a3c, 8, GRENADE.radius * 3);
    light.position.copy(center).add(new THREE.Vector3(0, 0.5, 0));
    this.scene.add(light);
    const start = now();
    this.effects.push({
      obj: ball, until: start + 0.45, extra: light,
      update: (k) => {
        ball.scale.setScalar(0.3 + k * GRENADE.radius * 0.7);
        ball.material.opacity = 0.85 * (1 - k);
        light.intensity = 8 * (1 - k);
      },
    });
    const dist = this.camera.position.distanceTo(center);
    this.sfx.boom(Math.max(0.1, 1 - dist / 60));
    this.shake = Math.max(this.shake, Math.max(0, 1 - dist / (GRENADE.radius * 3)));
    if (!p.auth) return;
    const from = center.clone().add(new THREE.Vector3(0, 0.3, 0));
    for (const o of this.chars.values()) {
      if (!o.alive || o.netSeen === false) continue;
      const chest = new THREE.Vector3(o.pos.x, o.pos.y + 1 * o.scale, o.pos.z);
      const d = chest.distanceTo(center);
      if (d > GRENADE.radius) continue;
      const dir = chest.clone().sub(from);
      const dl = dir.length();
      dir.divideScalar(dl);
      if (this.traceWorld(from, dir, dl) < dl - 0.3) continue;
      const dmg = Math.round(GRENADE.damage * Math.pow(1 - d / GRENADE.radius, 0.7));
      if (dmg < 1) continue;
      if (o === p.owner) {
        if (o.isLocal) this.applyDamage(o, Math.round(dmg * 0.5), o.id, false, 'grenade');
      } else if (this.isEnemy(p.owner, o)) {
        this.dealDamage(p.owner, o, dmg, false, 'grenade');
      }
    }
  }

  // First-person blade / throwing-knife animation.
  animateHeldBlades(c, t, bob) {
    const M = MELEE[c.meleeId] || MELEE.knife;
    this.vmMelee.visible = c.slot === 'melee';
    this.vmThrow.visible = c.slot === 'throw' && c.throwLeft > 0 && t >= c.nextThrow - 0.15;
    const raise = Math.min(1, (t - (this.slotChangedAt || 0)) / 0.18);
    if (this.vmMelee.visible) {
      const sw = (t - c.swingAt) / Math.min(0.32, M.delay * 0.8);
      const k = sw >= 0 && sw < 1 ? sw : -1;
      if (k >= 0) {
        const e = Math.sin(k * Math.PI * 0.5);
        this.vmMelee.position.set(0.32 - e * 0.55, -0.22 + Math.sin(k * Math.PI) * 0.06, -0.42);
        this.vmMelee.rotation.set(0.15 - e * 0.25, 0.9 - e * 2.1, -0.7 + e * 1.4);
      } else {
        this.vmMelee.position.set(0.3, -0.3 + bob * 0.5 - (1 - raise) * 0.3, -0.4);
        this.vmMelee.rotation.set(0.55, 0.35, -0.35);
      }
    }
    if (this.vmThrow.visible) {
      this.vmThrow.position.set(0.28, -0.24 + bob * 0.5 - (1 - raise) * 0.3, -0.38);
    }
  }

  awardCoins(msg, victim) {
    if (!this.wallet) return;
    let amount = COINS.kill;
    if (msg.kind === 'gun' && msg.head) amount += COINS.headshot;
    if (msg.kind === 'melee') amount += COINS.melee;
    if (msg.kind === 'backstab') amount += COINS.backstab;
    if (msg.kind === 'throw') amount += COINS.throw;
    if (msg.kind === 'grenade') amount += COINS.grenade;
    if (this.killStreak >= 3) amount += Math.min(COINS.streakCap, COINS.streakStep * (this.killStreak - 2));
    const mult = victim?.isBot ? COINS.vsBot[this.settings.difficulty] || 1 : COINS.vsPlayer;
    amount = Math.max(5, Math.round((amount * mult) / 5) * 5);
    this.wallet.coins += amount;
    this.coinsEarned += amount;
    this.onWalletChange();
    this.sfx.coin();
    const el = this.hud.coinPopup;
    if (el) {
      el.textContent = `+${amount}`;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
  }

  // ------------------------------------------------------------ effects
  spawnTracer(a, b) {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    m.position.copy(a).lerp(b, 0.5);
    m.scale.set(1, 1, len);
    m.lookAt(b);
    this.scene.add(m);
    this.effects.push({ obj: m, until: now() + 0.06 });
  }

  spawnSpark(p) {
    const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
    m.position.copy(p);
    this.scene.add(m);
    this.effects.push({ obj: m, until: now() + 0.12, grow: true });
  }

  spawnHealRing(p) {
    const m = new THREE.Mesh(this.healGeo, this.healMat);
    m.position.set(p.x, p.y + 0.1, p.z);
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    this.effects.push({ obj: m, until: now() + 0.6, ring: true, start: now() });
  }

  updateEffects() {
    const t = now();
    this.effects = this.effects.filter((e) => {
      if (t >= e.until) {
        this.scene.remove(e.obj);
        if (e.extra) this.scene.remove(e.extra);
        return false;
      }
      if (e.update) e.update(Math.min(1, (t - (e.until - 0.45)) / 0.45));
      if (e.grow) e.obj.scale.multiplyScalar(0.85);
      if (e.ring) e.obj.scale.setScalar(1 + (t - e.start) * 12);
      return true;
    });
  }

  showHitmarker(head, kill) {
    const h = this.hud.hitmarker;
    h.classList.remove('show', 'head', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (head) h.classList.add('head');
    if (kill) h.classList.add('kill');
  }

  showBanner(text) {
    const b = this.hud.banner;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  toast(text, ms = 2600) {
    const el = this.hud.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------ updates
  updateLocal(dt) {
    const c = this.me;
    const t = now();
    if (!c.alive) {
      const left = Math.max(0, c.respawnAt - t);
      const chosen = this.zones.find((z) => z.index === this.spawnChoice);
      this.hud.deathTimer.textContent = `Respawning ${chosen ? 'at ' + chosen.name : 'at the safest spot'} in ${left.toFixed(1)}s`;
      if (this.isTouch) this.hud.touch.hidden = true;
      if (left <= 0 && !this.ended) this.respawn(c);
      this.camera.position.set(c.pos.x, c.pos.y + 0.4 + Math.max(0, 1.2 - (t - c.deadAt) * 3), c.pos.z);
      this.camera.rotation.set(c.pitch, c.yaw, 0.3);
      return;
    }

    if (this.isTouch && this.hud.touch.hidden) this.hud.touch.hidden = false;
    let fx = 0, fz = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    fx += this.touch.move.x;
    fz += this.touch.move.y;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }

    const adrenaline = c.role === 'assault' && t < c.abilityUntil;
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    const meleeOut = c.slot === 'melee' ? (MELEE[c.meleeId] || MELEE.knife).moveBonus : 1;
    const zooming = this.zoom && c.slot === 'gun';
    let speed = c.R.speed * c.mods.speed * meleeOut * (sprint && fz < 0 ? 1.3 : 1) * (adrenaline ? 1.2 : 1) * (zooming ? 0.55 : 1);
    const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
    const want = new THREE.Vector3((fx * cos + fz * sin) * speed, 0, (-fx * sin + fz * cos) * speed);
    const accel = c.onGround ? 14 : 3;
    c.hv.lerp(want, 1 - Math.exp(-accel * dt));
    if (t < c.dashUntil) c.hv.copy(c.dashDir).multiplyScalar(c.dashSpeed || 26);
    if (k.has('Space') && c.onGround) {
      c.vy = JUMP_V;
      c.onGround = false;
    }
    this.moveChar(c, c.hv.x * dt, c.hv.z * dt, dt);
    c.moving = c.hv.lengthSq() > 1;
    if (c.pos.y < -20) this.respawn(c);

    // weapon
    const W = c.R.weapon;
    if (c.reloading && t >= c.reloadUntil) {
      c.reloading = false;
      c.mag = this.magOf(c);
    }
    if (c.slot === 'gun') {
      if (this.mouseDown && (W.auto || !this.firedSincePress)) {
        if (t >= c.nextFire && t >= c.reloadUntil) {
          this.fire(c);
          this.firedSincePress = true;
        }
      }
    } else if (c.slot === 'melee') {
      if (this.mouseDown) this.meleeAttack(c);
    } else if (c.slot === 'throw') {
      if (this.mouseDown && !this.firedSincePress) {
        this.throwKnife(c);
        this.firedSincePress = true;
      }
      if (c.throwLeft <= 0 && t > c.nextThrow) this.setSlot('gun');
    }
    this.regen(c, dt);

    // camera
    if (c.moving && c.onGround) c.walkPhase += dt * c.R.speed * 1.4;
    const bob = c.moving && c.onGround ? Math.sin(c.walkPhase) * 0.04 : 0;
    this.camera.position.set(c.pos.x, c.pos.y + EYE + bob, c.pos.z);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.camera.rotation.set(c.pitch + rand(-1, 1) * this.shake * 0.04, c.yaw + rand(-1, 1) * this.shake * 0.04, 0);
    const targetFov = zooming ? W.zoomFov : this.baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-18 * dt));
    this.camera.updateProjectionMatrix();

    // view model
    this.kick = Math.max(0, (this.kick || 0) - dt * 6);
    const reloadT = t < c.reloadUntil ? Math.sin(((c.reloadUntil - t) / this.reloadOf(c)) * Math.PI) : 0;
    this.vm.position.set(
      this.vmBase.x + Math.cos(c.walkPhase * 0.5) * (c.moving ? 0.012 : 0),
      this.vmBase.y + bob * 0.5 - reloadT * 0.15,
      this.vmBase.z + this.kick * 0.08,
    );
    this.vm.rotation.x = this.kick * 0.15 - reloadT * 0.7;
    const scoped = zooming && c.role === 'sniper' && this.camera.fov < 30;
    this.vm.visible = !scoped && c.slot === 'gun';
    this.animateHeldBlades(c, t, bob);
    this.hud.scope.hidden = !scoped;
    this.hud.crosshair.hidden = scoped;
    if (this.flashUntil && t > this.flashUntil) {
      this.flash.visible = false;
      this.muzzleLight.intensity = 0;
    }
    const cloaked = c.role === 'sniper' && t < c.abilityUntil;
    for (const m of [...(this.vmMats || []), this.vmMeleeMat].filter(Boolean)) {
      m.transparent = cloaked;
      m.opacity = cloaked ? 0.35 : 1;
    }
    c.cloaked = cloaked;
    c.fortified = c.role === 'heavy' && t < c.abilityUntil;
  }

  regen(c, dt) {
    if (c.hp >= c.maxHp) return;
    const t = now();
    const medic = c.role === 'medic';
    const delay = medic ? 2.5 : 6;
    const rate = medic ? c.R.passiveRegen * 2.4 : 6;
    if (t - c.lastDamageAt > delay) c.hp = Math.min(c.maxHp, c.hp + rate * dt);
  }

  updateBot(b, dt) {
    const t = now();
    if (!b.alive) {
      if (t >= b.respawnAt && !this.ended) this.respawn(b);
      return;
    }
    const ai = b.ai;
    const W = b.R.weapon;
    if (b.reloading && t >= b.reloadUntil) {
      b.reloading = false;
      b.mag = this.magOf(b);
    }
    b.cloaked = b.role === 'sniper' && t < b.abilityUntil;
    b.fortified = b.role === 'heavy' && t < b.abilityUntil;

    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = rand(0.15, 0.3);
      const eye = this.eyeOf(b);
      let best = null, bestScore = Infinity;
      for (const o of this.chars.values()) {
        if (!o.alive || !this.isEnemy(b, o) || o.netSeen === false) continue;
        const dist = o.pos.distanceTo(b.pos);
        if (dist > this.diff.view) continue;
        if (o.cloaked && dist > 5) continue;
        const chest = new THREE.Vector3(o.pos.x, o.pos.y + 1.2 * o.scale, o.pos.z);
        const dir = chest.clone().sub(eye);
        const dl = dir.length();
        dir.divideScalar(dl);
        if (this.traceWorld(eye, dir, dl) < dl - 0.3) continue;
        const score = dist - (o === ai.target ? 8 : 0);
        if (score < bestScore) { bestScore = score; best = o; }
      }
      if (best && best !== ai.target) ai.reactAt = t + this.diff.react * rand(0.8, 1.3);
      if (best) {
        ai.lastSeen = best.pos.clone();
        ai.lastSeenAt = t;
      }
      ai.target = best;
      // abilities
      if (t >= b.abilityReadyAt) {
        const r = b.role;
        if ((r === 'medic' && b.hp < b.maxHp * 0.5) || (r === 'heavy' && best && b.hp < b.maxHp * 0.7)
          || (r === 'assault' && best) || (r === 'sniper' && b.hp < b.maxHp * 0.5)
          || (r === 'scout' && Math.random() < 0.08)) {
          this.useAbility(b);
        }
      }
    }

    let fx = 0, fz = 0;
    const tgt = ai.target && ai.target.alive ? ai.target : null;
    if (tgt) {
      const to = tgt.pos.clone().sub(b.pos);
      const dist = Math.hypot(to.x, to.z);
      const desiredYaw = Math.atan2(-to.x, -to.z);
      const eyeY = b.pos.y + EYE * b.scale;
      const desiredPitch = Math.atan2(tgt.pos.y + 1.25 * tgt.scale - eyeY, dist);
      const dy = angleDiff(b.yaw, desiredYaw);
      const maxTurn = this.diff.turn * dt;
      b.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
      b.pitch += (desiredPitch - b.pitch) * Math.min(1, dt * 8);
      const pref = PREFERRED_RANGE[b.role] || 14;
      if (dist > pref + 3) fz = -1;
      else if (dist < pref - 3) fz = 0.7;
      if (t > ai.strafeAt) {
        ai.strafe = Math.random() < 0.5 ? -1 : 1;
        ai.strafeAt = t + rand(0.8, 2.2);
      }
      fx = ai.strafe * 0.8;
      const M = MELEE[b.meleeId] || MELEE.knife;
      if (dist < M.reach + 0.4) {
        // Close enough to cut: pull the blade and swing.
        b.slot = 'melee';
        fz = dist > 1.2 ? -1 : 0;
        fx *= 0.3;
        if (t >= ai.reactAt && Math.abs(dy) < 0.6) this.meleeAttack(b);
      } else {
        b.slot = 'gun';
        if (dist < 6 && b.role !== 'sniper') fz = -1; // rush in for the kill
        if (t >= ai.reactAt && Math.abs(dy) < 0.12 && dist <= W.range) this.fire(b);
      }
    } else {
      if (!ai.wp || b.pos.distanceTo(ai.wp) < 2) {
        if (ai.lastSeen && t - ai.lastSeenAt < 4) {
          ai.wp = ai.lastSeen.clone();
          ai.lastSeen = null;
        } else if (Math.random() < 0.5) {
          const enemies = [...this.chars.values()].filter((o) => o.alive && this.isEnemy(b, o));
          const e = enemies[Math.floor(Math.random() * enemies.length)];
          ai.wp = e ? e.pos.clone().add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8))) : this.spawns.all[Math.floor(Math.random() * this.spawns.all.length)].clone();
        } else {
          ai.wp = this.spawns.all[Math.floor(Math.random() * this.spawns.all.length)].clone();
        }
      }
      const to = ai.wp.clone().sub(b.pos);
      const desiredYaw = Math.atan2(-to.x, -to.z);
      const dy = angleDiff(b.yaw, desiredYaw);
      b.yaw += Math.max(-4 * dt, Math.min(4 * dt, dy));
      b.pitch *= 0.9;
      fz = Math.abs(dy) < 1 ? -1 : -0.2;
      b.slot = 'gun';
      if (b.mag < this.magOf(b) * 0.5 && !b.reloading) this.startReload(b);
    }

    const speed = b.R.speed * 0.85;
    const sin = Math.sin(b.yaw), cos = Math.cos(b.yaw);
    const want = new THREE.Vector3((fx * cos + fz * sin) * speed, 0, (-fx * sin + fz * cos) * speed);
    b.hv.lerp(want, 1 - Math.exp(-10 * dt));
    if (t < b.dashUntil) b.hv.copy(b.dashDir).multiplyScalar(b.dashSpeed || 26);
    const blocked = this.moveChar(b, b.hv.x * dt, b.hv.z * dt, dt);
    b.moving = b.hv.lengthSq() > 1;
    if (blocked && b.onGround && Math.random() < 0.08) b.vy = JUMP_V;
    if (t > ai.stuckCheck) {
      if (ai.lastPos.distanceTo(b.pos) < 0.8 && !tgt) {
        ai.wp = null;
        if (b.onGround) b.vy = JUMP_V;
      }
      ai.lastPos.copy(b.pos);
      ai.stuckCheck = t + 1.5;
    }
    if (b.pos.y < -20) this.respawn(b);
    this.regen(b, dt);
  }

  updateRemote(c, dt) {
    const f = 1 - Math.exp(-14 * dt);
    if (c.pos.distanceTo(c.netPos) > 6) c.pos.copy(c.netPos);
    else c.pos.lerp(c.netPos, f);
    c.yaw += angleDiff(c.yaw, c.netYaw) * f;
    c.pitch += (c.netPitch - c.pitch) * f;
  }

  updateCharVisual(c, dt) {
    const g = c.group;
    if (!g) return;
    const t = now();
    if (c.netSeen === false) {
      g.visible = false;
      return;
    }
    g.position.copy(c.pos);
    g.rotation.y = c.yaw;
    if (!c.alive) {
      if (!c.deadAt) c.deadAt = t;
      const k = Math.min(1, (t - c.deadAt) * 3);
      g.rotation.x = -k * Math.PI / 2;
      g.position.y = c.pos.y + k * 0.25;
      g.visible = t - c.deadAt < 2.5;
      return;
    }
    c.deadAt = 0;
    g.visible = true;
    g.rotation.x = 0;
    if (c.moving) c.walkPhase += dt * c.R.speed * 1.5;
    else c.walkPhase *= 0.9;
    const swing = Math.sin(c.walkPhase) * 0.6 * (c.moving ? 1 : 0);
    c.legL.rotation.x = swing;
    c.legR.rotation.x = -swing;
    c.arms.rotation.x = c.pitch * 0.8;
    const melee = c.slot === 'melee';
    c.gunMesh.visible = !melee;
    c.blade.visible = melee;
    if (melee && c.bladeFor !== c.meleeId) {
      const B = (MELEE[c.meleeId] || MELEE.knife).blade;
      c.blade.scale.z = B.length;
      c.blade.position.z = -0.45 - B.length / 2;
      c.bladeMat.color.setHex(B.color);
      c.bladeMat.emissive.setHex(B.glow ? B.color : 0x333333);
      c.bladeFor = c.meleeId;
    }
    const sw = (t - c.swingAt) / 0.35;
    c.arms.rotation.y = sw >= 0 && sw < 1 ? Math.sin(sw * Math.PI) * 1.1 - sw * 0.6 : 0;
    c.head.rotation.x = c.pitch * 0.5;
    const op = c.cloaked ? 0.1 : 1;
    for (const m of c.mats) m.opacity = op;
    c.mats[0].emissive?.setHex(c.fortified ? 0x553300 : 0x000000);
    c.tag.visible = !c.cloaked;
  }

  // ------------------------------------------------------------ network
  sendState() {
    if (!this.net) return;
    const c = this.me;
    const r = (n) => +n.toFixed(2);
    this.net.relay({
      k: 'st', p: [r(c.pos.x), r(c.pos.y), r(c.pos.z)], yw: r(c.yaw), pt: r(c.pitch),
      hp: Math.round(c.hp), a: c.alive ? 1 : 0, m: c.moving ? 1 : 0, cl: c.cloaked ? 1 : 0, fo: c.fortified ? 1 : 0,
      w: c.slot[0], mi: c.meleeId,
    });
    if (this.isHost) {
      const l = [];
      for (const b of this.chars.values()) {
        if (!b.isBot) continue;
        l.push([b.id, r(b.pos.x), r(b.pos.y), r(b.pos.z), r(b.yaw), r(b.pitch), Math.round(b.hp), b.alive ? 1 : 0, b.moving ? 1 : 0, b.cloaked ? 1 : 0, b.fortified ? 1 : 0, b.slot[0], b.meleeId]);
      }
      if (l.length) this.net.relay({ k: 'bots', l });
    }
  }

  sendSync() {
    if (!this.net || !this.isHost) return;
    const bots = [];
    for (const b of this.chars.values()) if (b.isBot) bots.push({ id: b.id, name: b.name, role: b.role, team: b.team });
    this.net.relay({ k: 'sync', bots, scores: this.scores, left: this.endAt ? this.endAt - now() : null });
  }

  handleRelay(from, data) {
    from = String(from);
    const t = now();
    switch (data.k) {
      case 'st': {
        const c = this.chars.get(from);
        if (!c || c.isLocal) return;
        c.netPos.set(data.p[0], data.p[1], data.p[2]);
        if (!c.netSeen) {
          c.pos.copy(c.netPos);
          c.netSeen = true;
        }
        c.netYaw = data.yw;
        c.netPitch = data.pt;
        c.hp = data.hp;
        if (!c.alive && data.a) c.deadAt = 0;
        c.alive = !!data.a;
        c.moving = !!data.m;
        c.cloaked = !!data.cl;
        c.fortified = !!data.fo;
        c.slot = SLOT_CODES[data.w] || 'gun';
        if (MELEE[data.mi]) c.meleeId = data.mi;
        break;
      }
      case 'bots': {
        if (this.isHost) return;
        for (const [id, x, y, z, yw, pt, hp, a, m, cl, fo, w, mi] of data.l) {
          const b = this.chars.get(id);
          if (!b) continue;
          b.netPos.set(x, y, z);
          if (b.netSeen === false) {
            b.netSeen = true;
            b.pos.copy(b.netPos);
          }
          b.netYaw = yw;
          b.netPitch = pt;
          b.hp = hp;
          if (!b.alive && a) {
            b.deadAt = 0;
            b.pos.copy(b.netPos);
          }
          b.alive = !!a;
          b.moving = !!m;
          b.cloaked = !!cl;
          b.fortified = !!fo;
          b.slot = SLOT_CODES[w] || 'gun';
          if (MELEE[mi]) b.meleeId = mi;
        }
        break;
      }
      case 'sync': {
        if (this.isHost) return;
        const ids = new Set();
        for (const info of data.bots) {
          ids.add(info.id);
          const ex = this.chars.get(info.id);
          if (ex && (ex.role !== info.role || ex.team !== info.team)) this.removeChar(info.id);
          if (!this.chars.has(info.id)) {
            const b = this.makeChar({ ...info, isBot: true });
            b.netSeen = false;
            b.alive = false;
          }
        }
        for (const [id, c] of this.chars) if (c.isBot && !ids.has(id)) this.removeChar(id);
        this.scores = data.scores || this.scores;
        if (data.left != null) this.endAt = t + data.left;
        this.updateScoreHUD();
        break;
      }
      case 'shot': {
        const o = new THREE.Vector3(...data.o);
        for (const e of data.e) this.spawnTracer(o, new THREE.Vector3(...e));
        const c = this.chars.get(data.id);
        if (c) {
          this.playDistantShot(c, o);
          this.recentShooters.set(c.id, t);
        }
        break;
      }
      case 'hit':
        this.applyDamage(this.me, data.dmg, String(data.by), data.head, data.kind);
        break;
      case 'hitBot': {
        if (!this.isHost) return;
        const b = this.chars.get(data.id);
        if (!b || !b.isBot) return;
        if (this.mode === 'tdm' && data.team === b.team) return;
        this.applyDamage(b, data.dmg, String(data.by), data.head, data.kind);
        break;
      }
      case 'died':
        if (this.isHost) this.recordKill(String(data.by), String(data.victim), data.head, data.kind);
        break;
      case 'kill':
        if (!this.isHost) this.onKill(data);
        break;
      case 'heal':
        if (this.me.alive) {
          this.me.hp = Math.min(this.me.maxHp, this.me.hp + data.amount);
          this.toast('A medic healed you', 1500);
        }
        break;
      case 'fx':
        if (data.type === 'heal') this.spawnHealRing(new THREE.Vector3(...data.p));
        break;
      case 'swing': {
        const c = this.chars.get(data.id);
        if (c && !c.isLocal) {
          c.swingAt = t;
          c.slot = 'melee';
          this.sfx.swoosh(Math.max(0, 1 - this.camera.position.distanceTo(c.pos) / 30));
        }
        break;
      }
      case 'proj': {
        const c = this.chars.get(data.id);
        if (c && !c.isLocal) this.spawnProjectile(data.type, c, new THREE.Vector3(...data.o), new THREE.Vector3(...data.v), false);
        break;
      }
    }
  }

  // ------------------------------------------------------------ HUD
  updateHUD() {
    const c = this.me;
    const t = now();
    const W = c.R.weapon;
    const hpPct = Math.max(0, c.hp / c.maxHp);
    this.hud.hpFill.style.width = hpPct * 100 + '%';
    this.hud.hpFill.classList.toggle('low', hpPct < 0.35);
    this.hud.hpText.textContent = Math.ceil(Math.max(0, c.hp));
    const reloading = t < c.reloadUntil;
    if (c.slot === 'melee') {
      this.hud.ammo.textContent = 'MELEE';
      this.hud.weapon.textContent = (MELEE[c.meleeId] || MELEE.knife).name;
    } else if (c.slot === 'throw') {
      this.hud.ammo.textContent = `${c.throwLeft} / ${THROWING.count}`;
      this.hud.weapon.textContent = THROWING.name;
    } else {
      this.hud.ammo.textContent = reloading ? 'RELOADING' : `${c.mag} / ${this.magOf(c)}`;
      this.hud.weapon.textContent = W.name;
    }
    this.hud.reload.style.width = reloading && c.slot === 'gun' ? (1 - (c.reloadUntil - t) / this.reloadOf(c)) * 100 + '%' : '0%';
    if (this.wallet && this.hud.coins) this.hud.coins.textContent = this.wallet.coins.toLocaleString();
    const A = c.R.ability;
    this.hud.abilityName.textContent = A.name;
    const cd = Math.max(0, c.abilityReadyAt - t);
    const active = t < c.abilityUntil;
    this.hud.abilityFill.style.width = (active ? 100 : (1 - cd / A.cooldown) * 100) + '%';
    this.hud.abilityState.textContent = active ? 'ACTIVE' : cd > 0 ? cd.toFixed(0) + 's' : 'READY · Q';
    this.hud.abilityFill.parentElement.classList.toggle('ready', cd <= 0 && !active);

    const effects = [];
    if (c.cloaked) effects.push('CLOAKED');
    if (c.fortified) effects.push('FORTIFIED');
    if (c.role === 'assault' && active) effects.push('ADRENALINE');
    if (c.spawnProtectUntil && t < c.spawnProtectUntil) effects.push('SPAWN SHIELD');
    if (this.leaderId === this.myId) effects.push('IN THE LEAD');
    this.hud.status.textContent = effects.join(' · ');

    if (this.endAt) {
      const left = Math.max(0, this.endAt - t);
      const m = Math.floor(left / 60), s = Math.floor(left % 60);
      this.hud.timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    } else this.hud.timer.textContent = '--:--';

    if (this.vignetteFade) {
      const k = Math.max(0, 1 - (t - this.vignetteFade) * 1.5);
      this.hud.vignette.style.opacity = Math.min(parseFloat(this.hud.vignette.style.opacity) || 0, k);
      if (k <= 0) this.vignetteFade = 0;
    }
    if (hpPct < 0.3 && c.alive) this.hud.vignette.style.opacity = Math.max(parseFloat(this.hud.vignette.style.opacity) || 0, 0.35);

    this.drawMinimap();
  }

  updateScoreHUD() {
    const limit = this.settings.killLimit;
    if (this.mode === 'tdm') {
      const ts = this.teamScores();
      this.hud.score.innerHTML = `<span class="team-red">RED ${ts.red}</span> <span class="vs">vs</span> <span class="team-blue">${ts.blue} BLUE</span> <span class="limit">to ${limit}</span>`;
    } else {
      const mine = this.scores[this.myId]?.k || 0;
      this.hud.score.innerHTML = `<span class="mine">${mine}</span> kills <span class="limit">· first to ${limit}</span>`;
    }
    const rank = this.ranking();
    this.updateLeader(rank);
    this.renderLeaderboard(rank);
  }

  // Everyone in the match, most kills first. Ties keep the current leader on top.
  ranking() {
    return Object.entries(this.scores)
      .filter(([id]) => this.chars.has(id))
      .map(([id, s]) => ({ id, k: s.k, d: s.d, c: this.chars.get(id) }))
      .sort((a, b) => b.k - a.k
        || (a.id === this.leaderId ? -1 : b.id === this.leaderId ? 1 : 0)
        || a.d - b.d);
  }

  updateLeader(rank) {
    const top = rank[0];
    const leader = top && top.k > 0 ? top.id : null;
    if (leader === this.leaderId) return;
    const first = this.leaderId === undefined;
    this.leaderId = leader;
    this.placeCrown();
    if (first || !leader) return;
    if (leader === this.myId) {
      this.showBanner('YOU TOOK THE LEAD');
    } else {
      this.toast(`${this.nameOf(leader)} took the lead with ${top.k} ${top.k === 1 ? 'kill' : 'kills'}`, 2200);
    }
  }

  // A gold crown floats over the leader's head so everyone can see who to hunt.
  placeCrown() {
    if (!this.crown) {
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xb07800, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 });
      const crown = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.1, 16, 1, true), gold);
      band.material.side = THREE.DoubleSide;
      crown.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), gold);
        spike.position.set(Math.cos(a) * 0.18, 0.11, Math.sin(a) * 0.18);
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff3b5c : 0x3bd1ff }));
        gem.position.set(Math.cos(a) * 0.205, 0, Math.sin(a) * 0.205);
        crown.add(spike, gem);
      }
      this.crown = crown;
    }
    if (this.crown.parent) this.crown.parent.remove(this.crown);
    const c = this.leaderId ? this.chars.get(this.leaderId) : null;
    if (c && c.group) {
      this.crown.position.set(0, 2.0, 0);
      c.group.add(this.crown);
    }
  }

  renderLeaderboard(rank) {
    const el = this.hud.leaderboard;
    if (!el) return;
    const meIdx = rank.findIndex((r) => r.id === this.myId);
    const chip = (r, i) => {
      const lead = i === 0 && r.k > 0;
      const cls = ['lb-chip', lead ? 'lead' : '', r.id === this.myId ? 'me' : '', r.c?.team ? 't-' + r.c.team : ''].join(' ');
      const name = r.id === this.myId ? 'You' : this.escape(this.nameOf(r.id));
      return `<span class="${cls}"><b>${i + 1}</b>${lead ? CROWN_SVG : ''}<span class="lb-name">${name}</span><span class="lb-k">${r.k}</span></span>`;
    };
    let html = rank.slice(0, 3).map(chip).join('');
    if (meIdx >= 3) html += `<span class="lb-gap">…</span>${chip(rank[meIdx], meIdx)}`;
    el.innerHTML = html;
  }

  escape(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  renderScoreboard() {
    const r = this.results();
    const row = (p) => `<tr class="${p.id === this.myId ? 'me' : ''}"><td>${p.id === this.leaderId ? CROWN_SVG + ' ' : ''}${this.escape(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${ROLES[p.role]?.name || ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`;
    const head = '<tr><th>Player</th><th>Role</th><th>K</th><th>D</th></tr>';
    let html = `<h3>${this.map.name} · ${this.mode === 'tdm' ? 'Team Deathmatch' : 'Free-for-all'}</h3>`;
    if (this.mode === 'tdm') {
      for (const team of ['red', 'blue']) {
        html += `<div class="sb-team sb-${team}">${team.toUpperCase()} · ${r.teamScores[team]}</div><table>${head}${r.rows.filter((p) => p.team === team).map(row).join('')}</table>`;
      }
    } else {
      html += `<table>${head}${r.rows.map(row).join('')}</table>`;
    }
    this.hud.scoreboard.innerHTML = html;
  }

  chooseSpawn(index) {
    this.spawnChoice = index;
    this.renderSpawnPicker();
  }

  renderSpawnPicker() {
    const el = this.hud.spawnPicker;
    if (!el) return;
    const zones = this.allowedZones(this.me);
    if (!zones.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const btn = (key, label, choice, team) => {
      const on = this.spawnChoice === choice;
      const cls = 'sp-btn' + (on ? ' on' : '') + (this.mode === 'tdm' && team ? ' sp-' + team : '');
      return `<button class="${cls}" data-choice="${choice === null ? 'auto' : choice}"><kbd>${key}</kbd>${this.escape(label)}</button>`;
    };
    el.innerHTML = `<div class="sp-title">Choose where to respawn</div>
      <div class="sp-list">${btn(0, 'Auto · safest', null)}${zones.map((z, i) => btn(i + 1, z.name, z.index, z.team)).join('')}</div>
      <div class="sp-hint">${this.isTouch ? 'Tap a spot' : 'Press a number key'} · spots are marked on the minimap</div>`;
    for (const b of el.querySelectorAll('button')) {
      b.addEventListener('click', () => this.chooseSpawn(b.dataset.choice === 'auto' ? null : Number(b.dataset.choice)));
    }
  }

  drawMinimap() {
    const g = this.mmCtx, S = 160, k = this.minimapScale;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.minimapBase, 0, 0);
    const t = now();
    const dot = (c, color, r = 3) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc((c.pos.x + this.size) * k, (c.pos.z + this.size) * k, r, 0, Math.PI * 2);
      g.fill();
    };
    const dead = !this.me.alive;
    const allowed = this.allowedZones(this.me);
    g.font = 'bold 10px "Chakra Petch", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.pads || []) {
      const z = p.zone;
      const n = allowed.indexOf(z);
      const zx = (z.center.x + this.size) * k, zy = (z.center.z + this.size) * k;
      const col = this.mode === 'tdm' ? (z.team === 'blue' ? '#5aa8ff' : '#ff6b5e') : '#ffb020';
      const chosen = dead && this.spawnChoice === z.index;
      g.strokeStyle = col;
      g.globalAlpha = n >= 0 ? (dead ? 1 : 0.55) : 0.3;
      g.lineWidth = chosen ? 2.5 : 1.5;
      g.beginPath();
      g.arc(zx, zy, chosen ? 6 : 4, 0, Math.PI * 2);
      g.stroke();
      if (dead && n >= 0) {
        g.fillStyle = '#fff';
        g.fillText(String(n + 1), zx, zy - 10);
      }
      g.globalAlpha = 1;
    }
    for (const c of this.chars.values()) {
      if (c.isLocal || !c.alive || c.netSeen === false) continue;
      const friendly = !this.isEnemy(this.me, c);
      if (friendly) dot(c, c.team === 'blue' ? '#5aa8ff' : '#ff6b5e');
      else if (t - (this.recentShooters.get(c.id) || -99) < 1.2 && !c.cloaked) dot(c, '#ff3b3b');
    }
    const me = this.me;
    const x = (me.pos.x + this.size) * k, y = (me.pos.z + this.size) * k;
    g.save();
    g.translate(x, y);
    g.rotate(-me.yaw);
    g.fillStyle = '#ffd34d';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.5, 5);
    g.lineTo(-4.5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ main loop
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const t = now();
    const rawDt = t - this.clock;
    const dt = Math.min(0.05, rawDt);
    this.clock = t;

    // Offline games pause while the mouse is released (menu open).
    if (!this.net && !this.isTouch && !this.locked && !this.ended) {
      if (this.endAt) this.endAt += rawDt;
      const c = this.me;
      this.camera.position.set(c.pos.x, c.pos.y + EYE, c.pos.z);
      this.camera.rotation.set(c.pitch, c.yaw, 0);
      for (const o of this.chars.values()) if (!o.isLocal) this.updateCharVisual(o, 0);
      this.updateHUD();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.updateLocal(dt);
    for (const c of this.chars.values()) {
      if (c.isLocal) continue;
      if (c.isBot && this.isHost) this.updateBot(c, dt);
      else this.updateRemote(c, dt);
      this.updateCharVisual(c, dt);
    }
    this.updateEffects();
    if (this.crown && this.crown.parent) this.crown.rotation.y += dt * 1.6;
    this.updateProjectiles(dt);
    for (const p of this.pads || []) p.ring.material.opacity = 0.45 + Math.sin(t * 2.5 + p.zone.index) * 0.2;
    if (this.snow) {
      const arr = this.snow.geometry.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= dt * 2.2;
        arr[i - 1] += Math.sin(t + i) * dt * 0.3;
        if (arr[i] < 0) arr[i] = 25;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }

    // Network timers use real elapsed time so slow frames don't delay syncing.
    this.netTimer += rawDt;
    if (this.netTimer >= NET_RATE) {
      this.netTimer = 0;
      this.sendState();
    }
    this.syncTimer += rawDt;
    if (this.syncTimer >= SYNC_RATE) {
      this.syncTimer = 0;
      this.sendSync();
      this.checkWin();
    }
    if (this.isHost && this.endAt && t >= this.endAt) this.checkWin();

    this.updateHUD();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ended = true;
    for (const [target, ev, fn, opts] of this.listeners) target.removeEventListener(ev, fn, opts);
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.root.hidden = true;
    this.hud.pause.hidden = true;
    this.hud.touch.hidden = true;
    this.hud.scoreboard.hidden = true;
    this.hud.death.hidden = true;
    this.hud.scope.hidden = true;
  }
}
