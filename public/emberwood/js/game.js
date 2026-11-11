// Emberwood: a small top-down action RPG.
import { CLASSES, ATTRS, ITEMS, ENEMIES, QUESTS, NPCS, TUNIC_COLORS, CLASS_WEAPONS } from './data.js';
import { buildWorld, T, isSolidTile } from './world.js';

const SAVE_KEY = 'emberwood_save_v1';
const LAYER_PX = 48; // resolution of the pre-rendered map layer
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => performance.now() / 1000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const angDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// ------------------------------------------------------------------ sound
const sfx = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.15, slide = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 1200) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = buf;
    f.type = 'bandpass';
    f.frequency.value = freq;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.ctx.destination);
    src.start(t);
  },
  swing() { this.noise(0.12, 0.25, 2200); },
  shoot() { this.tone(900, 0.08, 'triangle', 0.08, 0.5); },
  hit() { this.tone(220, 0.07, 'square', 0.1, 0.6); },
  hurt() { this.tone(160, 0.18, 'sawtooth', 0.12, 0.5); },
  coin() { this.tone(1320, 0.06, 'square', 0.06); setTimeout(() => this.tone(1760, 0.1, 'square', 0.06), 60); },
  magic() { this.tone(520, 0.3, 'sine', 0.12, 2.2); },
  boom() { this.noise(0.5, 0.45, 300); },
  level() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.12), i * 110)); },
  quest() { [660, 880, 990].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.1), i * 90)); },
  talk() { this.tone(440 + Math.random() * 120, 0.04, 'square', 0.03); },
};

// ------------------------------------------------------------------ state
const world = buildWorld();
let S = null; // the saved hero
const P = { x: 0, y: 0, r: 0.32, hp: 1, mp: 1, face: Math.PI / 2, moving: false, walk: 0, attackAt: -9, nextAttack: 0,
  invulnUntil: 0, rollUntil: 0, rollDir: [0, 1], cryUntil: 0, lastHurt: -99, cds: { q: 0, e: 0 }, lavaAt: 0, prevX: 0, prevY: 0, attackAim: 0 };
const G = {
  map: null, enemies: [], projectiles: [], drops: [], effects: [], parts: [], floaters: [], npcs: [],
  mode: 'title', layers: {}, keys: new Set(), mouse: { sx: 0, sy: 0, active: false, at: -99, down: false },
  stick: { x: 0, y: 0 }, touchAttack: false, tp: 40, cam: { x: 0, y: 0 }, shake: 0, lastSave: 0, exitMsgAt: 0,
  dialog: null, menuTab: 'char', shop: null, boss: null, isTouch: matchMedia('(pointer: coarse)').matches,
};
const canvas = $('view');
const ctx = canvas.getContext('2d');
let vw = 0, vh = 0, dpr = 1;
const dark = document.createElement('canvas');
const dctx = dark.getContext('2d');

// ------------------------------------------------------------------ hero math
const xpNext = (lv) => Math.round(45 * Math.pow(lv, 1.55));
function stats() {
  const a = S.attrs;
  const w = ITEMS[S.equip.weapon], ar = ITEMS[S.equip.armor];
  return {
    maxHp: Math.round(50 + a.vit * 9 + S.level * 6),
    maxMp: Math.round(20 + a.int * 6 + S.level * 2),
    atk: w ? w.atk : 1,
    def: Math.round(((ar ? ar.def : 0) + a.vit * 0.3) * 10) / 10,
    speed: 4.0 + a.agi * 0.06,
    crit: Math.min(0.5, 0.05 + a.agi * 0.006),
    mpRegen: 0.8 + a.int * 0.1,
  };
}
function rollDamage(mult = 1) {
  const C = CLASSES[S.cls], st = stats();
  let dmg = st.atk;
  for (const [k, v] of Object.entries(C.attack.scale)) dmg += S.attrs[k] * v;
  if (now() < P.cryUntil) dmg *= 1.5;
  dmg *= mult * rand(0.9, 1.1);
  const crit = Math.random() < st.crit;
  if (crit) dmg *= 1.75;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}
function addItem(id, n = 1) { S.inv[id] = (S.inv[id] || 0) + n; }
function removeItem(id, n = 1) {
  S.inv[id] = (S.inv[id] || 0) - n;
  if (S.inv[id] <= 0) delete S.inv[id];
}
const hasItem = (id) => (S.inv[id] || 0) > 0;

// ------------------------------------------------------------------ quests
const questDone = (id) => S.quests[id]?.state === 'done';
function questComplete(id) {
  const Q = QUESTS[id], q = S.quests[id];
  if (!q) return false;
  if (Q.type === 'kill') return q.progress >= Q.count;
  if (Q.type === 'fetch') return hasItem(Q.item);
  return false;
}
function questState(id) {
  const q = S.quests[id];
  if (q) return q.state === 'done' ? 'done' : questComplete(id) ? 'ready' : 'active';
  return (QUESTS[id].requires || []).every(questDone) ? 'available' : 'locked';
}
const THANKS = {
  slimes: 'The fields are quiet again. Thank you! Take these, and go see Hunter Tom and Mira. They could use someone like you. Garrick will let you through the north gate now.',
  amulet: 'My mother\'s amulet! I thought I\'d never see it again. Please, take this armor. It was my brother\'s, and he\'d want a hero to have it.',
  wolves: 'Five wolves! Ha! The road is safe again. You\'ve earned this. And if you\'re brave enough, the Ashen Cave beyond the woods is open to you now.',
  warden: 'The ash has stopped falling. You did it. Emberwood will sing about you for a hundred years. Take this, forged from the Warden\'s own fire.',
};
function acceptQuest(id) {
  S.quests[id] = { state: 'active', progress: 0 };
  if (id === 'warden' && S.bossDead) S.quests[id].progress = 1;
  sfx.quest();
  toast(`New quest: ${QUESTS[id].title}`);
  renderTracker();
  save();
}
function completeQuest(id) {
  const Q = QUESTS[id];
  if (Q.type === 'fetch') removeItem(Q.item);
  S.quests[id].state = 'done';
  const got = [];
  S.gold += Q.reward.gold || 0;
  for (const it of Q.reward.items || []) { addItem(it); got.push(ITEMS[it].name); }
  if (Q.reward.weapon) {
    const w = CLASS_WEAPONS[S.cls][1];
    addItem(w);
    got.push(ITEMS[w].name);
  }
  sfx.quest();
  toast(`Quest complete: ${Q.title} · +${Q.reward.gold} gold${got.length ? ' · ' + got.join(', ') : ''}`, 4200);
  gainXp(Q.reward.xp || 0);
  renderTracker();
  save();
  if (id === 'warden') setTimeout(() => showOverlay('victory'), 600);
}
function onEnemyKilled(type) {
  for (const [id, q] of Object.entries(S.quests)) {
    const Q = QUESTS[id];
    if (q.state !== 'active' || Q.type !== 'kill' || Q.target !== type || q.progress >= Q.count) continue;
    q.progress++;
    if (q.progress >= Q.count) toast(`${Q.title}: done! Return to ${NPCS[Q.giver].name}.`, 3200);
  }
  renderTracker();
}

// ------------------------------------------------------------------ saving
function save() {
  if (!S || !G.map) return;
  S.map = G.map.id;
  S.x = P.x;
  S.y = P.y;
  S.hp = Math.round(P.hp);
  S.mp = Math.round(P.mp);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* storage blocked: progress lasts this session only */ }
  G.lastSave = now();
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.v === 1 && CLASSES[s.cls] ? s : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ map tiles
function tileAt(x, y) { return G.map.grid.get(Math.floor(x), Math.floor(y)); }
function blocked(x, y, r, mode) {
  const g = G.map.grid;
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
      const t = g.get(tx, ty);
      if (mode === 'fly') { if (t === T.TREE || t === T.WALL || t === T.CAVE_WALL || t === T.DOOR) return true; continue; }
      if (isSolidTile(t)) return true;
      if (mode === 'enemy' && t === T.LAVA) return true;
    }
  }
  for (const c of G.map.chests) if (Math.abs(c.x - x) < 0.4 + r && Math.abs(c.y - y) < 0.35 + r) return true;
  return false;
}
function move(e, dx, dy, mode) {
  let hit = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
  for (let i = 0; i < steps; i++) {
    const nx = e.x + dx / steps;
    if (!blocked(nx, e.y, e.r, mode)) e.x = nx; else hit = true;
    const ny = e.y + dy / steps;
    if (!blocked(e.x, ny, e.r, mode)) e.y = ny; else hit = true;
  }
  return hit;
}

// ------------------------------------------------------------------ pre-rendered map art
const THEME = {
  village: { grass: ['#5e9c48', '#579441', '#64a34e'], dark: '#253a1d' },
  meadow: { grass: ['#6aab4f', '#63a247', '#71b356'], dark: '#2a4220' },
  woods: { grass: ['#3e6d38', '#386533', '#44753d'], dark: '#0f1a0e' },
  cave: { grass: ['#3b3430', '#36302c', '#403833'], dark: '#0b0908' },
};
function seeded(n) {
  let s = n >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function buildLayer(map) {
  const s = LAYER_PX, g = map.grid, th = THEME[map.id] || THEME.village;
  const c = document.createElement('canvas');
  c.width = g.w * s;
  c.height = g.h * s;
  const x = c.getContext('2d');
  const r = seeded(map.id.length * 977 + g.w * 31);
  const floor = map.dark ? th.grass : th.grass;
  // ground pass
  for (let ty = 0; ty < g.h; ty++) {
    for (let tx = 0; tx < g.w; tx++) {
      const t = g.get(tx, ty), px = tx * s, py = ty * s;
      x.fillStyle = floor[Math.floor(r() * floor.length)];
      x.fillRect(px, py, s, s);
      for (let i = 0; i < 5; i++) {
        x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
        x.fillRect(px + r() * s, py + r() * s, 2 + r() * 3, 2 + r() * 3);
      }
      if (t === T.PATH) {
        x.fillStyle = '#b89c6c';
        x.fillRect(px, py, s, s);
        for (let i = 0; i < 4; i++) {
          x.fillStyle = r() < 0.5 ? '#a68959' : '#c9b083';
          x.beginPath();
          x.ellipse(px + r() * s, py + r() * s, 2 + r() * 3, 1.5 + r() * 2, 0, 0, 7);
          x.fill();
        }
      } else if (t === T.WATER || t === T.BRIDGE) {
        x.fillStyle = '#2f6f9f';
        x.fillRect(px, py, s, s);
        x.strokeStyle = 'rgba(180,220,255,0.35)';
        x.lineWidth = 2;
        for (let i = 0; i < 2; i++) {
          const yy = py + 10 + r() * (s - 20), xx = px + r() * s * 0.5;
          x.beginPath();
          x.moveTo(xx, yy);
          x.quadraticCurveTo(xx + 8, yy - 4, xx + 16, yy);
          x.stroke();
        }
        if (t === T.BRIDGE) {
          x.fillStyle = '#8b6a43';
          x.fillRect(px, py + 4, s, s - 8);
          x.fillStyle = '#6e5233';
          for (let i = 0; i < 4; i++) x.fillRect(px + i * (s / 4), py + 4, 2, s - 8);
        }
      } else if (t === T.LAVA) {
        x.fillStyle = '#b8380b';
        x.fillRect(px, py, s, s);
        for (let i = 0; i < 4; i++) {
          x.fillStyle = r() < 0.5 ? '#f97316' : '#fbbf24';
          x.beginPath();
          x.ellipse(px + r() * s, py + r() * s, 3 + r() * 6, 2 + r() * 4, r() * 3, 0, 7);
          x.fill();
        }
      } else if (t === T.CAVE_WALL) {
        x.fillStyle = '#1e1917';
        x.fillRect(px, py, s, s);
        if (g.get(tx, ty + 1) !== T.CAVE_WALL) {
          x.fillStyle = '#4a3f38';
          x.fillRect(px, py + s * 0.55, s, s * 0.45);
          x.fillStyle = '#5b4e45';
          x.fillRect(px, py + s * 0.55, s, 4);
        }
        x.fillStyle = 'rgba(255,255,255,0.04)';
        x.fillRect(px + r() * s * 0.6, py + r() * s * 0.4, 6, 4);
      } else if (t === T.FLOWERS) {
        for (let i = 0; i < 4; i++) {
          x.fillStyle = ['#ffd6e8', '#fff3a3', '#d6b4ff', '#ff9e9e'][Math.floor(r() * 4)];
          x.beginPath();
          x.arc(px + 6 + r() * (s - 12), py + 6 + r() * (s - 12), 2.6, 0, 7);
          x.fill();
        }
      }
    }
  }
  // houses
  for (const h of map.houses) drawHouse(x, h, s);
  // objects pass, row by row so lower things overlap upper ones
  for (let ty = 0; ty < g.h; ty++) {
    for (let tx = 0; tx < g.w; tx++) {
      const t = g.get(tx, ty), px = tx * s, py = ty * s, cx = px + s / 2, cy = py + s / 2;
      if (t === T.TREE) {
        x.fillStyle = '#5b3d22';
        x.fillRect(cx - 4, cy, 8, s * 0.42);
        const shade = map.id === 'woods' ? ['#1f4a22', '#2a5c2b', '#356d33'] : ['#2b6a2f', '#367d38', '#46914a'];
        x.fillStyle = shade[0];
        x.beginPath();
        x.arc(cx + 2, cy - 2, s * 0.6, 0, 7);
        x.fill();
        x.fillStyle = shade[1];
        x.beginPath();
        x.arc(cx - 2, cy - 6, s * 0.5, 0, 7);
        x.fill();
        x.fillStyle = shade[2];
        x.beginPath();
        x.arc(cx - 8, cy - 12, s * 0.22, 0, 7);
        x.fill();
      } else if (t === T.ROCK) {
        x.fillStyle = map.dark ? '#2b2522' : '#6f7378';
        x.beginPath();
        x.ellipse(cx, cy + 4, s * 0.4, s * 0.32, 0, 0, 7);
        x.fill();
        x.fillStyle = map.dark ? '#423834' : '#8d9298';
        x.beginPath();
        x.ellipse(cx - 4, cy, s * 0.26, s * 0.2, 0, 0, 7);
        x.fill();
      } else if (t === T.BUSH) {
        for (const [ox, oy, rr] of [[-8, 4, 0.3], [8, 4, 0.3], [0, -4, 0.34]]) {
          x.fillStyle = '#2f7a34';
          x.beginPath();
          x.arc(cx + ox, cy + oy, s * rr, 0, 7);
          x.fill();
        }
        x.fillStyle = '#c0392b';
        x.beginPath();
        x.arc(cx + 4, cy - 2, 2.5, 0, 7);
        x.arc(cx - 6, cy + 6, 2.5, 0, 7);
        x.fill();
      } else if (t === T.MUSHROOM) {
        for (let i = 0; i < 2; i++) {
          const mx = px + 10 + r() * (s - 20), my = py + 14 + r() * (s - 24);
          x.fillStyle = '#efe6d2';
          x.fillRect(mx - 2, my, 4, 7);
          x.fillStyle = r() < 0.5 ? '#c0392b' : '#d68910';
          x.beginPath();
          x.arc(mx, my, 6, Math.PI, 0);
          x.fill();
        }
      } else if (t === T.FENCE) {
        x.fillStyle = '#8b6a43';
        const L = g.get(tx - 1, ty) === T.FENCE, R = g.get(tx + 1, ty) === T.FENCE;
        const U = g.get(tx, ty - 1) === T.FENCE, D = g.get(tx, ty + 1) === T.FENCE;
        x.fillRect(cx - 3, cy - 12, 6, 22);
        if (L || R) {
          x.fillRect(L ? px : cx, cy - 8, L && R ? s : s / 2, 4);
          x.fillRect(L ? px : cx, cy + 1, L && R ? s : s / 2, 4);
        }
        if (U || D) x.fillRect(cx - 2, U ? py : cy, 4, U && D ? s : s / 2);
      } else if (t === T.WELL) {
        x.fillStyle = '#7f8c8d';
        x.beginPath();
        x.arc(cx, cy, s * 0.46, 0, 7);
        x.fill();
        x.fillStyle = '#1d4e73';
        x.beginPath();
        x.arc(cx, cy, s * 0.3, 0, 7);
        x.fill();
        x.fillStyle = '#5b3d22';
        x.fillRect(cx - s * 0.5, cy - s * 0.55, 5, s * 0.6);
        x.fillRect(cx + s * 0.5 - 5, cy - s * 0.55, 5, s * 0.6);
        x.fillRect(cx - s * 0.5, cy - s * 0.6, s, 6);
      }
    }
  }
  return c;
}
function drawHouse(x, h, s) {
  const px = h.x * s, py = h.y * s, w = h.w * s, hh = h.h * s;
  const front = h.doorTop ? 0 : s; // regular houses show a front wall row
  // walls
  x.fillStyle = '#d8c39a';
  x.fillRect(px, py + hh - s, w, s);
  x.fillStyle = '#6e4b2a';
  for (let i = 0; i <= h.w; i++) x.fillRect(px + i * s - 2, py + hh - s, 4, s);
  x.fillRect(px, py + hh - s, w, 4);
  // roof
  const roofH = hh - front;
  x.fillStyle = h.roof;
  x.beginPath();
  x.moveTo(px - 6, py + roofH);
  x.lineTo(px - 6, py + s * 0.3);
  x.lineTo(px + w / 2, py - s * 0.35);
  x.lineTo(px + w + 6, py + s * 0.3);
  x.lineTo(px + w + 6, py + roofH);
  x.closePath();
  x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.22)';
  x.lineWidth = 2;
  for (let yy = py + s * 0.6; yy < py + roofH; yy += 12) {
    x.beginPath();
    x.moveTo(px - 6, yy);
    x.lineTo(px + w + 6, yy);
    x.stroke();
  }
  x.fillStyle = 'rgba(255,255,255,0.12)';
  x.beginPath();
  x.moveTo(px + w / 2, py - s * 0.35);
  x.lineTo(px + w + 6, py + s * 0.3);
  x.lineTo(px + w + 6, py + roofH);
  x.lineTo(px + w / 2, py + roofH);
  x.closePath();
  x.fill();
  // door + windows
  const [dx, dy] = h.door;
  const doorX = dx * s, doorY = dy * s;
  x.fillStyle = '#4a2f18';
  if (h.doorTop) {
    x.fillRect(doorX + 8, doorY - 6, s - 16, s * 0.55);
    x.fillStyle = '#6e4b2a';
    x.fillRect(doorX + 4, doorY - 10, s - 8, 6);
  } else {
    x.fillRect(doorX + 8, doorY + 6, s - 16, s - 6);
    x.fillStyle = '#c9a35b';
    x.beginPath();
    x.arc(doorX + s - 14, doorY + s * 0.6, 2.5, 0, 7);
    x.fill();
    x.fillStyle = '#ffe9a8';
    for (const wx of [px + s * 0.7, px + w - s * 0.7 - 16]) {
      if (Math.abs(wx - doorX) < s) continue;
      x.fillRect(wx, py + hh - s + 12, 16, 16);
      x.strokeStyle = '#6e4b2a';
      x.strokeRect(wx, py + hh - s + 12, 16, 16);
    }
  }
  // sign
  x.font = `700 ${Math.round(s * 0.34)}px "Alegreya SC", Georgia, serif`;
  x.textAlign = 'center';
  x.fillStyle = 'rgba(255,245,220,0.85)';
  x.fillText(h.label, px + w / 2, py + roofH * 0.62);
}

// ------------------------------------------------------------------ characters & enemies art
function drawPerson(c, sx, sy, u, o) {
  const bob = o.moving ? Math.abs(Math.sin(o.walk)) * 0.05 * u : 0;
  const up = Math.sin(o.face) < -0.35;
  const handX = sx + Math.cos(o.face) * 0.24 * u, handY = sy - 0.4 * u + Math.sin(o.face) * 0.12 * u - bob;
  c.save();
  if (o.alpha !== undefined) c.globalAlpha = o.alpha;
  // shadow
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.beginPath();
  c.ellipse(sx, sy, 0.26 * u, 0.1 * u, 0, 0, 7);
  c.fill();
  const weapon = () => drawWeapon(c, handX, handY, u, o);
  if (up) weapon();
  // legs
  const leg = Math.sin(o.walk) * 0.06 * u * (o.moving ? 1 : 0);
  c.fillStyle = o.legs || '#3b2f25';
  c.fillRect(sx - 0.13 * u, sy - 0.2 * u + leg, 0.1 * u, 0.2 * u);
  c.fillRect(sx + 0.03 * u, sy - 0.2 * u - leg, 0.1 * u, 0.2 * u);
  // body
  c.fillStyle = o.tunic;
  roundRect(c, sx - 0.21 * u, sy - 0.54 * u - bob, 0.42 * u, 0.38 * u, 0.1 * u);
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(sx - 0.21 * u, sy - 0.26 * u - bob, 0.42 * u, 0.05 * u);
  // head
  c.fillStyle = o.skin || '#f0c9a0';
  c.beginPath();
  c.arc(sx, sy - 0.72 * u - bob, 0.18 * u, 0, 7);
  c.fill();
  c.fillStyle = o.hair || '#4a2f18';
  c.beginPath();
  c.arc(sx, sy - 0.76 * u - bob, 0.19 * u, Math.PI * 1.05, Math.PI * 1.95);
  c.fill();
  if (o.hat) {
    c.fillStyle = o.hat;
    c.beginPath();
    c.ellipse(sx, sy - 0.86 * u - bob, 0.24 * u, 0.07 * u, 0, 0, 7);
    c.fill();
    c.fillRect(sx - 0.13 * u, sy - 1.02 * u - bob, 0.26 * u, 0.16 * u);
  }
  if (!up) {
    c.fillStyle = o.eyes || '#1a1208';
    const ex = Math.cos(o.face) * 0.06 * u;
    c.fillRect(sx - 0.08 * u + ex, sy - 0.74 * u - bob, 0.04 * u, 0.05 * u);
    c.fillRect(sx + 0.05 * u + ex, sy - 0.74 * u - bob, 0.04 * u, 0.05 * u);
  }
  if (!up) weapon();
  if (o.flash) {
    c.globalAlpha = 0.6;
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(sx, sy - 0.5 * u, 0.36 * u, 0, 7);
    c.fill();
  }
  c.restore();
}
function drawWeapon(c, hx, hy, u, o) {
  if (!o.weapon) return;
  const a = o.face + (o.swing || 0);
  c.save();
  c.translate(hx, hy);
  c.rotate(a);
  if (o.weapon === 'sword') {
    c.fillStyle = '#5b3d22';
    c.fillRect(-0.04 * u, -0.03 * u, 0.12 * u, 0.06 * u);
    c.fillStyle = '#c9a35b';
    c.fillRect(0.07 * u, -0.08 * u, 0.04 * u, 0.16 * u);
    c.fillStyle = o.blade || '#dfe6ee';
    c.beginPath();
    c.moveTo(0.11 * u, -0.035 * u);
    c.lineTo(0.62 * u, -0.02 * u);
    c.lineTo(0.68 * u, 0);
    c.lineTo(0.62 * u, 0.02 * u);
    c.lineTo(0.11 * u, 0.035 * u);
    c.fill();
  } else if (o.weapon === 'bow') {
    c.strokeStyle = '#8b5a2b';
    c.lineWidth = 0.05 * u;
    c.beginPath();
    c.arc(0, 0, 0.3 * u, -1.2, 1.2);
    c.stroke();
    c.strokeStyle = '#efe6d2';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(Math.cos(-1.2) * 0.3 * u, Math.sin(-1.2) * 0.3 * u);
    c.lineTo(Math.cos(1.2) * 0.3 * u, Math.sin(1.2) * 0.3 * u);
    c.stroke();
  } else if (o.weapon === 'staff') {
    c.strokeStyle = '#7a5230';
    c.lineWidth = 0.06 * u;
    c.beginPath();
    c.moveTo(-0.2 * u, 0);
    c.lineTo(0.55 * u, 0);
    c.stroke();
    c.fillStyle = o.orb || '#8fd3ff';
    c.shadowColor = o.orb || '#8fd3ff';
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(0.6 * u, 0, 0.09 * u, 0, 7);
    c.fill();
  } else if (o.weapon === 'bone') {
    c.fillStyle = '#b9b2a0';
    c.fillRect(0, -0.03 * u, 0.55 * u, 0.06 * u);
  }
  c.restore();
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
const WEAPON_ART = { warrior: 'sword', ranger: 'bow', mage: 'staff' };
function heroLook(extra = {}) {
  const w = S ? S.equip.weapon : '';
  return {
    tunic: S ? S.color : TUNIC_COLORS[0], weapon: WEAPON_ART[S ? S.cls : 'warrior'],
    blade: w === 'sword_ember' ? '#ff9a4a' : undefined, orb: w === 'staff_ember' ? '#ff7a2f' : w === 'staff_crystal' ? '#c39bff' : undefined,
    hair: '#3b2414', ...extra,
  };
}

function drawEnemy(c, e, sx, sy, u) {
  const D = e.def, t = now();
  const flash = t < e.flashUntil;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.beginPath();
  c.ellipse(sx, sy, D.r * u * 0.9, D.r * u * 0.35, 0, 0, 7);
  c.fill();
  const body = flash ? '#ffffff' : D.color;
  const facing = Math.cos(e.face) >= 0 ? 1 : -1;
  if (e.type === 'slime') {
    const sq = 1 + Math.sin(e.anim * 8) * 0.12;
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(sx, sy - D.r * u * 0.6 / sq, D.r * u * sq, D.r * u * 0.75 / sq, 0, Math.PI, 0);
    c.lineTo(sx + D.r * u * sq, sy);
    c.lineTo(sx - D.r * u * sq, sy);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath();
    c.arc(sx - 0.12 * u, sy - 0.32 * u, 0.06 * u, 0, 7);
    c.fill();
    eyes(c, sx + facing * 0.05 * u, sy - 0.2 * u, u, 0.1);
  } else if (e.type === 'bee' || e.type === 'bat') {
    const fy = sy - 0.55 * u + Math.sin(e.anim * 6) * 0.08 * u;
    const flap = Math.sin(e.anim * 30) * 0.5;
    c.fillStyle = e.type === 'bee' ? 'rgba(220,240,255,0.7)' : (flash ? '#fff' : '#3d3048');
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(sx + s * 0.22 * u, fy - 0.05 * u, 0.2 * u, 0.09 * u * (1 + flap), s * 0.5, 0, 7);
      c.fill();
    }
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(sx, fy, 0.2 * u, 0.16 * u, 0, 0, 7);
    c.fill();
    if (e.type === 'bee') {
      c.fillStyle = '#2b2b2b';
      c.fillRect(sx - 0.05 * u, fy - 0.15 * u, 0.05 * u, 0.3 * u);
      c.fillRect(sx + 0.07 * u, fy - 0.13 * u, 0.04 * u, 0.26 * u);
    } else {
      c.fillStyle = '#ff5a4e';
      c.fillRect(sx - 0.08 * u, fy - 0.04 * u, 0.04 * u, 0.04 * u);
      c.fillRect(sx + 0.04 * u, fy - 0.04 * u, 0.04 * u, 0.04 * u);
    }
  } else if (e.type === 'wolf') {
    const lunge = e.state === 'windup' ? -0.08 : e.state === 'strike' ? 0.15 : 0;
    c.translate(sx, sy - 0.3 * u);
    c.scale(facing, 1);
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(lunge * u, 0, 0.42 * u, 0.2 * u, 0, 0, 7);
    c.fill();
    c.beginPath();
    c.arc((0.36 + lunge) * u, -0.12 * u, 0.17 * u, 0, 7);
    c.fill();
    c.beginPath();
    c.moveTo((0.3 + lunge) * u, -0.25 * u);
    c.lineTo((0.36 + lunge) * u, -0.4 * u);
    c.lineTo((0.42 + lunge) * u, -0.25 * u);
    c.fill();
    c.beginPath();
    c.moveTo(-0.38 * u, -0.05 * u);
    c.lineTo(-0.62 * u, -0.22 * u + Math.sin(e.anim * 8) * 0.05 * u);
    c.lineTo(-0.4 * u, 0.05 * u);
    c.fill();
    c.fillStyle = '#5d626b';
    const leg = Math.sin(e.anim * 14) * 0.05 * u;
    c.fillRect(-0.28 * u + leg, 0.12 * u, 0.07 * u, 0.2 * u);
    c.fillRect(0.2 * u - leg, 0.12 * u, 0.07 * u, 0.2 * u);
    c.fillStyle = e.state === 'windup' ? '#ff3b2f' : '#ffd36a';
    c.fillRect((0.42 + lunge) * u, -0.16 * u, 0.05 * u, 0.04 * u);
  } else if (e.type === 'shroom') {
    c.fillStyle = flash ? '#fff' : '#efe6d2';
    c.fillRect(sx - 0.1 * u, sy - 0.32 * u, 0.2 * u, 0.32 * u);
    c.fillStyle = body;
    c.beginPath();
    c.ellipse(sx, sy - 0.34 * u, 0.36 * u, 0.26 * u, 0, Math.PI, 0);
    c.fill();
    c.fillStyle = '#fff4e0';
    for (const [ox, oy] of [[-0.16, -0.44], [0.08, -0.5], [0.2, -0.4]]) {
      c.beginPath();
      c.arc(sx + ox * u, sy + oy * u, 0.04 * u, 0, 7);
      c.fill();
    }
    eyes(c, sx, sy - 0.2 * u, u, 0.08);
  } else if (e.type === 'skeleton') {
    const swing = e.state === 'windup' ? -1.2 : e.state === 'strike' ? 0.9 : 0;
    drawPerson(c, sx, sy, u, { tunic: flash ? '#fff' : '#d8d1bd', skin: flash ? '#fff' : '#e8e2d0', hair: '#e8e2d0', legs: '#c9c2ad', eyes: '#2b0d0d', face: e.face, walk: e.anim * 8, moving: e.moving, weapon: 'bone', swing });
  } else if (e.type === 'warden') {
    const pulse = 0.5 + Math.sin(t * 4) * 0.5;
    const sz = u * 1.1;
    c.fillStyle = flash ? '#fff' : '#3a2a22';
    roundRect(c, sx - 0.75 * sz, sy - 1.6 * sz, 1.5 * sz, 1.4 * sz, 0.3 * sz);
    c.fill();
    c.fillStyle = flash ? '#fff' : '#2a1d17';
    c.fillRect(sx - 0.62 * sz, sy - 0.3 * sz, 0.4 * sz, 0.3 * sz);
    c.fillRect(sx + 0.22 * sz, sy - 0.3 * sz, 0.4 * sz, 0.3 * sz);
    c.strokeStyle = `rgba(255,${120 + pulse * 80},40,0.9)`;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(sx - 0.5 * sz, sy - 1.3 * sz);
    c.lineTo(sx - 0.2 * sz, sy - 0.9 * sz);
    c.lineTo(sx - 0.4 * sz, sy - 0.5 * sz);
    c.moveTo(sx + 0.5 * sz, sy - 1.4 * sz);
    c.lineTo(sx + 0.25 * sz, sy - 1.0 * sz);
    c.stroke();
    c.fillStyle = `rgba(255,${150 + pulse * 90},60,1)`;
    c.shadowColor = '#ff7a2f';
    c.shadowBlur = 25;
    c.beginPath();
    c.arc(sx, sy - 0.95 * sz, (0.2 + pulse * 0.05) * sz, 0, 7);
    c.fill();
    c.fillRect(sx - 0.35 * sz, sy - 1.4 * sz, 0.18 * sz, 0.08 * sz);
    c.fillRect(sx + 0.17 * sz, sy - 1.4 * sz, 0.18 * sz, 0.08 * sz);
    c.shadowBlur = 0;
    for (const s of [-1, 1]) {
      const raise = e.action === 'slam' && e.actPhase === 'windup' ? -0.5 : 0;
      c.fillStyle = flash ? '#fff' : '#4a362b';
      c.beginPath();
      c.arc(sx + s * 0.95 * sz, sy + (-0.9 + raise) * sz, 0.3 * sz, 0, 7);
      c.fill();
    }
  }
  c.restore();
  // health bar
  if (e.hp < e.maxHp && e.type !== 'warden') {
    const w = 0.8 * u, top = sy - (e.type === 'skeleton' ? 1.15 : 0.95) * u;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(sx - w / 2, top, w, 5);
    c.fillStyle = '#e04b3a';
    c.fillRect(sx - w / 2, top, (w * e.hp) / e.maxHp, 5);
  }
}
function eyes(c, x, y, u, gap) {
  c.fillStyle = '#1a1208';
  c.fillRect(x - gap * u, y, 0.05 * u, 0.06 * u);
  c.fillRect(x + (gap - 0.05) * u, y, 0.05 * u, 0.06 * u);
}

// ------------------------------------------------------------------ map lifecycle
function changeMap(id, x, y, { silent = false } = {}) {
  const fade = $('fade');
  const go = () => {
    G.map = world[id];
    if (!G.layers[id]) G.layers[id] = buildLayer(G.map);
    P.x = x;
    P.y = y;
    P.prevX = x;
    P.prevY = y;
    G.projectiles = [];
    G.drops = [];
    G.effects = [];
    G.parts = [];
    G.floaters = [];
    G.boss = null;
    G.enemies = [];
    for (const sp of G.map.spawns) {
      if (sp.boss && S.bossDead) continue;
      spawnEnemy(sp.type, sp.x, sp.y, sp.boss);
    }
    G.npcs = G.map.npcs.map((n) => ({ ...n, hx: n.x, hy: n.y, r: 0.32, face: Math.PI / 2, walk: 0, moving: false, wt: 0 }));
    $('boss-bar').hidden = true;
    snapCamera();
    showBanner(G.map.name, G.map.dark ? 'Danger · it\'s dark in here' : G.map.safe ? 'Safe haven' : 'Wilds');
    save();
    renderTracker();
    setTimeout(() => fade.classList.remove('on'), 60);
  };
  if (silent) go();
  else {
    fade.classList.add('on');
    setTimeout(go, 230);
  }
}
// Change area with a short fade; the world pauses while the screen is dark.
function travel(to, x, y) {
  G.mode = 'transition';
  changeMap(to, x, y);
  setTimeout(() => { if (G.mode === 'transition') G.mode = 'play'; }, 280);
}
function spawnEnemy(type, x, y, boss = false) {
  const D = ENEMIES[type];
  const e = {
    type, def: D, x, y, hx: x, hy: y, r: D.r * (boss ? 0.9 : 0.85), hp: D.hp, maxHp: D.hp, state: 'idle', face: Math.PI / 2, anim: Math.random() * 10,
    wanderAt: 0, wdx: 0, wdy: 0, cd: 0, contactCd: 0, fireAt: now() + rand(1, 2), flashUntil: 0, slowUntil: 0, kb: [0, 0], moving: false,
    boss, awake: false, action: null, actPhase: null, actT: 2, phase: 1, summoned: false,
    fly: D.behavior === 'erratic',
  };
  G.enemies.push(e);
  return e;
}

// ------------------------------------------------------------------ combat
function hitEnemy(e, roll, kbAngle, kbForce = 4) {
  if (e.hp <= 0) return;
  const dmg = Math.max(1, roll.dmg - e.def.def);
  e.hp -= dmg;
  e.flashUntil = now() + 0.1;
  if (!e.boss) e.kb = [Math.cos(kbAngle) * kbForce, Math.sin(kbAngle) * kbForce];
  if (e.state === 'idle') e.state = 'chase';
  if (e.boss) e.awake = true;
  floater(e.x, e.y - 0.9, roll.crit ? `${dmg}!` : `${dmg}`, roll.crit ? '#ffd36a' : '#ffffff', roll.crit ? 1.35 : 1);
  sparks(e.x, e.y - 0.4, roll.crit ? '#ffd36a' : '#ffe2c0', roll.crit ? 10 : 5);
  sfx.hit();
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.hp = 0;
  G.enemies = G.enemies.filter((x) => x !== e);
  const D = e.def;
  sparks(e.x, e.y - 0.4, D.color, 16);
  const gold = Math.round(rand(D.gold[0], D.gold[1] + 0.99));
  S.gold += gold;
  floater(e.x, e.y - 1.3, `+${gold}g`, '#ffd36a');
  sfx.coin();
  for (const [item, chance] of D.drops || []) {
    if (Math.random() < chance) G.drops.push({ x: e.x + rand(-0.3, 0.3), y: e.y + rand(-0.3, 0.3), item, born: now() });
  }
  gainXp(D.xp);
  onEnemyKilled(e.type);
  if (e.boss) {
    S.bossDead = true;
    $('boss-bar').hidden = true;
    G.boss = null;
    for (const m of G.enemies) if (m.summon) m.hp = 0;
    G.enemies = G.enemies.filter((m) => !m.summon);
    G.shake = 1.2;
    sfx.boom();
    toast('The Cinder Warden crumbles to ash! Return to Elder Maren.', 5000);
    save();
  }
}
function hurtPlayer(raw, source = 'hit') {
  const t = now();
  if (G.mode !== 'play' || P.hp <= 0) return;
  if (source !== 'lava' && (t < P.invulnUntil || t < P.rollUntil)) return;
  const st = stats();
  const dmg = Math.max(1, Math.round(raw - st.def * 0.5));
  P.hp -= dmg;
  P.lastHurt = t;
  if (source !== 'lava') P.invulnUntil = t + 0.5;
  floater(P.x, P.y - 1.1, `-${dmg}`, '#ff6b5a');
  G.shake = Math.max(G.shake, 0.35);
  sfx.hurt();
  if (P.hp <= 0) die();
}
function gainXp(n) {
  if (!n) return;
  S.xp += n;
  floater(P.x, P.y - 1.4, `+${n} XP`, '#e8b84a');
  while (S.xp >= xpNext(S.level)) {
    S.xp -= xpNext(S.level);
    S.level++;
    const g = CLASSES[S.cls].growth;
    for (const k of Object.keys(g)) S.attrs[k] += g[k];
    S.points += 3;
    const st = stats();
    P.hp = st.maxHp;
    P.mp = st.maxMp;
    sfx.level();
    G.effects.push({ kind: 'levelup', x: P.x, y: P.y, start: now(), dur: 1.2 });
    sparks(P.x, P.y - 0.5, '#ffd36a', 30);
    toast(`Level ${S.level}! You have ${S.points} attribute ${S.points === 1 ? 'point' : 'points'} to spend (press C).`, 4000);
    save();
  }
}
function die() {
  P.hp = 0;
  G.mode = 'dead';
  const lost = Math.floor(S.gold * 0.1);
  S.gold -= lost;
  $('death-text').textContent = lost > 0
    ? `Rosa found you and carried you back to the inn. You dropped ${lost} gold on the way.`
    : 'Rosa found you and carried you back to the inn.';
  showOverlay('death');
}

function aimAngle() {
  if (G.mouse.active && !G.isTouch) {
    const wx = (G.mouse.sx - vw / 2) / G.tp + G.cam.x, wy = (G.mouse.sy - vh / 2) / G.tp + G.cam.y;
    return Math.atan2(wy - (P.y - 0.4), wx - P.x);
  }
  // auto-aim: nearest enemy within reach, favoring the way you're facing
  let best = null, bestScore = Infinity;
  for (const e of G.enemies) {
    const d = Math.hypot(e.x - P.x, e.y - P.y);
    if (d > 9) continue;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    const score = d + Math.abs(angDiff(P.face, a)) * 2;
    if (score < bestScore) { bestScore = score; best = a; }
  }
  return best ?? P.face;
}

function tryAttack() {
  const t = now();
  if (t < P.nextAttack || t < P.rollUntil) return;
  const C = CLASSES[S.cls];
  const aim = aimAngle();
  P.face = aim;
  P.attackAt = t;
  P.attackAim = aim;
  P.nextAttack = t + C.attack.cooldown * (t < P.cryUntil ? 0.8 : 1);
  if (C.attack.kind === 'melee') {
    sfx.swing();
    G.effects.push({ kind: 'slash', x: P.x, y: P.y - 0.4, a: aim, arc: C.attack.arc, r: C.attack.range, start: t, dur: 0.16 });
    for (const e of [...G.enemies]) {
      const d = Math.hypot(e.x - P.x, e.y - P.y) - e.r;
      if (d > C.attack.range) continue;
      if (Math.abs(angDiff(aim, Math.atan2(e.y - P.y, e.x - P.x))) > C.attack.arc && d > 0.3) continue;
      hitEnemy(e, rollDamage(1), aim);
    }
  } else {
    sfx.shoot();
    shoot(C.attack.kind, aim, rollDamage(1), C.attack.speed, C.attack.range);
  }
}
function shoot(kind, a, roll, speed, range, extra = {}) {
  G.projectiles.push({
    owner: 'p', kind, x: P.x + Math.cos(a) * 0.4, y: P.y - 0.4 + Math.sin(a) * 0.4, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    r: kind === 'fireball' ? 0.2 : 0.12, roll, life: range / speed, a, ...extra,
  });
}
function useSkill(slot) {
  const t = now();
  if (t < P.cds[slot] || t < P.rollUntil) return;
  const sk = CLASSES[S.cls].skills[slot];
  if (P.mp < sk.mp) {
    toast('Not enough mana', 1000);
    return;
  }
  P.mp -= sk.mp;
  P.cds[slot] = t + sk.cooldown;
  const aim = aimAngle();
  if (sk.id === 'whirlwind') {
    sfx.swing();
    setTimeout(() => sfx.swing(), 120);
    G.effects.push({ kind: 'whirl', x: P.x, y: P.y - 0.4, r: 2.1, start: t, dur: 0.35 });
    for (const e of [...G.enemies]) {
      if (Math.hypot(e.x - P.x, e.y - P.y) - e.r <= 2.1) hitEnemy(e, rollDamage(1.8), Math.atan2(e.y - P.y, e.x - P.x), 6);
    }
  } else if (sk.id === 'battlecry') {
    P.cryUntil = t + 6;
    sfx.magic();
    G.effects.push({ kind: 'ring', x: P.x, y: P.y - 0.3, r: 2.5, color: '255,90,60', start: t, dur: 0.6 });
    toast('Battle Cry! +50% damage', 1500);
  } else if (sk.id === 'multishot') {
    sfx.shoot();
    for (const off of [-0.36, -0.18, 0, 0.18, 0.36]) shoot('arrow', aim + off, rollDamage(0.85), 13, 9);
  } else if (sk.id === 'roll') {
    let dx = 0, dy = 0;
    const mv = moveInput();
    if (mv[0] || mv[1]) [dx, dy] = mv;
    else [dx, dy] = [Math.cos(aim), Math.sin(aim)];
    const l = Math.hypot(dx, dy) || 1;
    P.rollDir = [dx / l, dy / l];
    P.rollUntil = t + 0.28;
    sfx.swing();
  } else if (sk.id === 'fireball') {
    sfx.magic();
    shoot('fireball', aim, rollDamage(2.2), 9, 10, { aoe: 1.8 });
  } else if (sk.id === 'frostnova') {
    sfx.magic();
    G.effects.push({ kind: 'nova', x: P.x, y: P.y - 0.2, r: 3.2, start: t, dur: 0.5 });
    for (const e of [...G.enemies]) {
      if (Math.hypot(e.x - P.x, e.y - P.y) - e.r <= 3.2) {
        e.slowUntil = t + 3;
        hitEnemy(e, rollDamage(1.3), Math.atan2(e.y - P.y, e.x - P.x), 3);
      }
    }
  }
  renderSkillbar();
}
function usePotion(id) {
  if (!hasItem(id)) {
    toast(`No ${ITEMS[id].name}s. Ivy sells them in the village.`, 1500);
    return;
  }
  const st = stats(), I = ITEMS[id];
  if ((I.heal && P.hp < st.maxHp) || (I.mana && P.mp < st.maxMp)) {
    removeItem(id);
    if (I.heal) P.hp = Math.min(st.maxHp, P.hp + I.heal);
    if (I.mana) P.mp = Math.min(st.maxMp, P.mp + I.mana);
    sfx.magic();
    G.effects.push({ kind: 'ring', x: P.x, y: P.y - 0.3, r: 1.2, color: I.heal ? '120,255,140' : '120,170,255', start: now(), dur: 0.5 });
    renderSkillbar();
  } else {
    toast('You\'re already full', 1000);
  }
}

// ------------------------------------------------------------------ effects
function floater(x, y, text, color, scale = 1) {
  G.floaters.push({ x: x + rand(-0.2, 0.2), y, text, color, scale, start: now() });
}
function sparks(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(1.5, 5);
    G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: rand(0.25, 0.6), born: now(), color, size: rand(2, 4) });
  }
}

// ------------------------------------------------------------------ update
function moveInput() {
  let x = 0, y = 0;
  const k = G.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  x += G.stick.x;
  y += G.stick.y;
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return [x, y];
}
function updatePlayer(dt) {
  const t = now(), st = stats();
  P.prevX = P.x;
  P.prevY = P.y;
  let [mx, my] = moveInput();
  let speed = st.speed * (t < P.cryUntil ? 1.25 : 1);
  if (t < P.rollUntil) {
    [mx, my] = P.rollDir;
    speed = 11;
  }
  P.moving = Math.hypot(mx, my) > 0.1;
  if (P.moving) {
    move(P, mx * speed * dt, my * speed * dt, 'walk');
    P.walk += dt * speed * 2.2;
    if (!(G.mouse.active && !G.isTouch) && t - P.attackAt > 0.3) P.face = Math.atan2(my, mx);
  }
  if (G.mouse.active && !G.isTouch && t - P.attackAt > 0.3) {
    const wx = (G.mouse.sx - vw / 2) / G.tp + G.cam.x, wy = (G.mouse.sy - vh / 2) / G.tp + G.cam.y;
    P.face = Math.atan2(wy - (P.y - 0.4), wx - P.x);
  }
  if (G.keys.has('Space') || G.mouse.down || G.touchAttack) tryAttack();
  // regen
  P.mp = Math.min(st.maxMp, P.mp + st.mpRegen * dt);
  if (t - P.lastHurt > 5) P.hp = Math.min(st.maxHp, P.hp + Math.max(1.5, st.maxHp * 0.015) * dt);
  P.hp = Math.min(P.hp, st.maxHp);
  // lava
  if (tileAt(P.x, P.y) === T.LAVA && t >= P.rollUntil && t > P.lavaAt) {
    P.lavaAt = t + 0.45;
    hurtPlayer(9, 'lava');
    sparks(P.x, P.y, '#ff9a3c', 5);
  }
}
function updateEnemies(dt) {
  const t = now();
  for (const e of [...G.enemies]) {
    const D = e.def;
    e.anim += dt;
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy);
    const toP = Math.atan2(dy, dx);
    const slow = t < e.slowUntil ? 0.45 : 1;
    let vx = 0, vy = 0;
    const alive = G.mode === 'play' && P.hp > 0;
    // knockback
    if (Math.abs(e.kb[0]) + Math.abs(e.kb[1]) > 0.05) {
      move(e, e.kb[0] * dt, e.kb[1] * dt, e.fly ? 'fly' : 'enemy');
      e.kb[0] *= Math.pow(0.002, dt);
      e.kb[1] *= Math.pow(0.002, dt);
    }
    if (e.boss) {
      updateBoss(e, dt, d, toP, alive);
      continue;
    }
    if (e.state === 'idle') {
      if (alive && d < D.aggro) e.state = 'chase';
      if (t > e.wanderAt) {
        e.wanderAt = t + rand(1.5, 3.5);
        const a = Math.random() * Math.PI * 2, back = Math.hypot(e.hx - e.x, e.hy - e.y) > 3;
        const wa = back ? Math.atan2(e.hy - e.y, e.hx - e.x) : a;
        const go = Math.random() < 0.6;
        e.wdx = go ? Math.cos(wa) : 0;
        e.wdy = go ? Math.sin(wa) : 0;
      }
      vx = e.wdx * D.speed * 0.4;
      vy = e.wdy * D.speed * 0.4;
    } else {
      if (!alive || d > D.aggro * 2.2) {
        e.state = 'idle';
      } else if (D.behavior === 'hop') {
        const ph = (e.anim % 1.0);
        if (ph < 0.45) { vx = Math.cos(toP) * D.speed * 2; vy = Math.sin(toP) * D.speed * 2; }
      } else if (D.behavior === 'erratic') {
        const wob = Math.sin(e.anim * 5) * 1.2;
        vx = Math.cos(toP + wob) * D.speed;
        vy = Math.sin(toP + wob) * D.speed;
      } else if (D.behavior === 'ranged') {
        const want = d < 3.5 ? -1 : d > 5.5 ? 1 : 0;
        vx = Math.cos(toP) * D.speed * want + Math.cos(toP + Math.PI / 2) * Math.sin(e.anim) * 0.8;
        vy = Math.sin(toP) * D.speed * want + Math.sin(toP + Math.PI / 2) * Math.sin(e.anim) * 0.8;
        if (t > e.fireAt && d < D.aggro + 1) {
          e.fireAt = t + D.fireEvery * rand(0.85, 1.2);
          G.projectiles.push({ owner: 'e', kind: 'spore', x: e.x, y: e.y - 0.35, vx: Math.cos(toP) * 5.5, vy: Math.sin(toP) * 5.5, r: 0.16, dmg: D.dmg, life: 2.2 });
        }
      } else if (D.behavior === 'chase') {
        if (e.state === 'chase') {
          vx = Math.cos(toP) * D.speed;
          vy = Math.sin(toP) * D.speed;
          if (d < D.reach + 0.25 && t > e.cd) {
            e.state = 'windup';
            e.stateAt = t;
          }
        } else if (e.state === 'windup') {
          if (t - e.stateAt > D.windup) {
            e.state = 'strike';
            e.stateAt = t;
            if (d < D.reach + 0.55) hurtPlayer(D.dmg);
            e.cd = t + 1.0;
          }
        } else if (e.state === 'strike') {
          if (t - e.stateAt > 0.25) e.state = 'chase';
        }
      }
      // contact damage for blobs and fliers
      if ((D.behavior === 'hop' || D.behavior === 'erratic') && d < e.r + P.r + 0.1 && t > e.contactCd) {
        e.contactCd = t + 1.0;
        hurtPlayer(D.dmg);
      }
    }
    if (vx || vy) {
      e.face = Math.atan2(vy, vx);
      e.moving = true;
      move(e, vx * slow * dt, vy * slow * dt, e.fly ? 'fly' : 'enemy');
    } else e.moving = false;
    if (e.state !== 'idle') e.face = toP;
  }
}
function updateBoss(e, dt, d, toP, alive) {
  const t = now(), D = e.def;
  if (!e.awake) {
    if (alive && d < D.aggro) {
      e.awake = true;
      G.boss = e;
      $('boss-bar').hidden = false;
      toast('The Cinder Warden awakens!', 2500);
      G.shake = 0.8;
      sfx.boom();
    }
    return;
  }
  G.boss = e;
  $('boss-bar').hidden = false;
  if (!alive) return;
  if (e.hp < e.maxHp * 0.5 && e.phase === 1) {
    e.phase = 2;
    toast('The Warden burns hotter!', 2000);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const b = spawnEnemy('bat', e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2);
      b.state = 'chase';
      b.summon = true;
    }
  }
  const speedMul = e.phase === 2 ? 1.35 : 1;
  const slow = t < e.slowUntil ? 0.5 : 1;
  if (!e.action) {
    // stalk the player between attacks
    if (d > 1.6) move(e, Math.cos(toP) * D.speed * speedMul * slow * dt, Math.sin(toP) * D.speed * speedMul * slow * dt, 'enemy');
    e.face = toP;
    e.actT -= dt;
    if (e.actT <= 0) {
      const options = d < 3.5 ? ['slam', 'slam', 'ring', 'charge'] : ['ring', 'charge', 'charge', 'slam'];
      e.action = options[Math.floor(Math.random() * options.length)];
      e.actPhase = 'windup';
      e.actAt = t;
      e.target = [P.x, P.y];
    }
  } else {
    const since = t - e.actAt;
    if (e.action === 'slam') {
      if (e.actPhase === 'windup' && since > 0.9 / speedMul) {
        e.actPhase = 'done';
        G.shake = 0.9;
        sfx.boom();
        sparks(e.x, e.y, '#ff9a3c', 30);
        G.effects.push({ kind: 'ring', x: e.x, y: e.y, r: 2.8, color: '255,120,40', start: t, dur: 0.4 });
        if (Math.hypot(P.x - e.x, P.y - e.y) < 2.8) hurtPlayer(D.dmg * 1.5);
        endBossAction(e);
      }
    } else if (e.action === 'ring') {
      if (e.actPhase === 'windup' && since > 0.6) {
        const n = e.phase === 2 ? 16 : 12;
        const off = Math.random();
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          G.projectiles.push({ owner: 'e', kind: 'fire', x: e.x, y: e.y - 0.9, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, r: 0.22, dmg: D.dmg * 0.8, life: 3 });
        }
        sfx.magic();
        if (e.phase === 2 && !e.second) {
          e.second = true;
          e.actAt = t;
        } else {
          e.second = false;
          endBossAction(e);
        }
      }
    } else if (e.action === 'charge') {
      if (e.actPhase === 'windup' && since > 0.55) {
        e.actPhase = 'go';
        e.actAt = t;
        e.chargeA = Math.atan2(e.target[1] - e.y, e.target[0] - e.x);
      } else if (e.actPhase === 'go') {
        const hit = move(e, Math.cos(e.chargeA) * 10 * speedMul * dt, Math.sin(e.chargeA) * 10 * speedMul * dt, 'enemy');
        if (Math.hypot(P.x - e.x, P.y - e.y) < e.r + P.r + 0.2) hurtPlayer(D.dmg);
        if (hit || since > 0.65) {
          if (hit) { G.shake = 0.5; sfx.boom(); }
          endBossAction(e);
        }
      }
    }
  }
  if (Math.hypot(P.x - e.x, P.y - e.y) < e.r + P.r && t > e.contactCd) {
    e.contactCd = t + 1;
    hurtPlayer(D.dmg * 0.6);
  }
}
function endBossAction(e) {
  e.action = null;
  e.actPhase = null;
  e.actT = rand(0.9, 1.8) / (e.phase === 2 ? 1.4 : 1);
}
function updateProjectiles(dt) {
  const t = now();
  G.projectiles = G.projectiles.filter((p) => {
    p.life -= dt;
    if (p.life <= 0) {
      if (p.kind === 'fireball') explode(p);
      return false;
    }
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    const tile = G.map.grid.get(Math.floor(nx), Math.floor(ny + 0.4));
    if (isSolidTile(tile) && tile !== T.WATER && tile !== T.FENCE) {
      if (p.kind === 'fireball') explode(p);
      else sparks(p.x, p.y, '#cfc6b0', 3);
      return false;
    }
    p.x = nx;
    p.y = ny;
    if (p.owner === 'p') {
      for (const e of G.enemies) {
        const ey = e.y - (e.boss ? 0.9 : 0.35);
        if (Math.hypot(e.x - p.x, ey - p.y) < e.r + p.r + (e.boss ? 0.4 : 0)) {
          if (p.kind === 'fireball') explode(p);
          else hitEnemy(e, p.roll, Math.atan2(p.vy, p.vx), 3);
          return false;
        }
      }
    } else if (G.mode === 'play' && Math.hypot(P.x - p.x, P.y - 0.4 - p.y) < P.r + p.r) {
      hurtPlayer(p.dmg);
      return false;
    }
    if (p.kind === 'fire' || p.kind === 'fireball') {
      if (Math.random() < 0.5) G.parts.push({ x: p.x, y: p.y, vx: rand(-0.5, 0.5), vy: rand(-1.5, -0.5), life: 0.3, born: t, color: '#ffb35a', size: 3 });
    }
    return true;
  });
}
function explode(p) {
  sfx.boom();
  G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: p.aoe, color: '255,140,40', start: now(), dur: 0.35, fill: true });
  sparks(p.x, p.y, '#ff9a3c', 18);
  G.shake = Math.max(G.shake, 0.3);
  for (const e of [...G.enemies]) {
    if (Math.hypot(e.x - p.x, e.y - 0.4 - p.y) - e.r <= p.aoe) hitEnemy(e, p.roll, Math.atan2(e.y - p.y, e.x - p.x), 5);
  }
}
function updateDrops() {
  G.drops = G.drops.filter((d) => {
    if (Math.hypot(d.x - P.x, d.y - P.y) < 0.7) {
      addItem(d.item);
      floater(P.x, P.y - 1.2, `+ ${ITEMS[d.item].name}`, '#bfe3ff');
      sfx.coin();
      renderSkillbar();
      return false;
    }
    return now() - d.born < 90;
  });
}
function updateNpcs(dt) {
  const t = now();
  for (const n of G.npcs) {
    const near = Math.hypot(n.x - P.x, n.y - P.y) < 3;
    if (near) n.face = Math.atan2(P.y - n.y, P.x - n.x);
    if (!n.wander || near) { n.moving = false; continue; }
    if (t > n.wt) {
      n.wt = t + rand(1.5, 3);
      const a = Math.random() * Math.PI * 2;
      const back = Math.hypot(n.hx - n.x, n.hy - n.y) > 2.5;
      n.dir = back ? Math.atan2(n.hy - n.y, n.hx - n.x) : a;
      n.go = Math.random() < 0.6;
    }
    n.moving = n.go;
    if (n.go) {
      move(n, Math.cos(n.dir) * 1.4 * dt, Math.sin(n.dir) * 1.4 * dt, 'enemy');
      n.face = n.dir;
      n.walk += dt * 4;
    }
  }
}
function checkExits() {
  for (const ex of G.map.exits) {
    if (P.x >= ex.x && P.x <= ex.x + ex.w && P.y >= ex.y && P.y <= ex.y + ex.h) {
      if (ex.requires && !questDone(ex.requires)) {
        P.x = P.prevX;
        P.y = P.prevY;
        // step back out of the exit zone
        const cx = ex.x + ex.w / 2, cy = ex.y + ex.h / 2;
        const a = Math.atan2(P.y - cy, P.x - cx);
        move(P, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 'walk');
        if (now() - G.exitMsgAt > 3) {
          G.exitMsgAt = now();
          toast(ex.msg, 3500);
        }
        return;
      }
      travel(ex.to, ex.tx, ex.ty);
      return;
    }
  }
}

// ------------------------------------------------------------------ interaction
function nearestInteractable() {
  let best = null, bd = 1.5;
  for (const n of G.npcs) {
    const d = Math.hypot(n.x - P.x, n.y - P.y);
    if (d < bd) { bd = d; best = { kind: 'npc', ref: n }; }
  }
  for (const c of G.map.chests) {
    if (S.chests[c.id]) continue;
    const d = Math.hypot(c.x - P.x, c.y - P.y);
    if (d < bd) { bd = d; best = { kind: 'chest', ref: c }; }
  }
  return best;
}
function interact() {
  const it = nearestInteractable();
  if (!it) return;
  if (it.kind === 'npc') talkTo(it.ref.id);
  else openChest(it.ref);
}
function openChest(c) {
  S.chests[c.id] = true;
  S.gold += c.gold || 0;
  const names = [];
  for (const i of c.items) { addItem(i); names.push(ITEMS[i].name); }
  sfx.quest();
  sparks(c.x, c.y - 0.3, '#ffd36a', 20);
  toast(`Found ${c.gold ? c.gold + ' gold, ' : ''}${names.join(', ')}`, 3000);
  if (c.items.includes('amulet') && !S.quests.amulet) toast('Found a silver amulet. Someone in the village must be missing it.', 3500);
  renderTracker();
  renderSkillbar();
  save();
}
function talkTo(id) {
  const N = NPCS[id];
  const pages = [], options = [];
  const say = (text) => pages.push(text);
  let handled = false;
  for (const qid of N.quests || []) {
    const st = questState(qid);
    if (st === 'ready') {
      say(THANKS[qid]);
      options.push({ label: 'Claim reward', fn: () => completeQuest(qid) });
      handled = true;
      break;
    }
  }
  if (!handled) {
    for (const qid of N.quests || []) {
      const st = questState(qid), Q = QUESTS[qid];
      if (st === 'active') {
        const q = S.quests[qid];
        say(Q.type === 'kill' ? `${Q.desc} (${q.progress} of ${Q.count} so far.)` : Q.desc);
        handled = true;
        break;
      }
      if (st === 'available') {
        say(Q.desc);
        options.push({ label: `Accept: ${Q.title}`, fn: () => acceptQuest(qid) }, { label: 'Not now', fn: () => {} });
        handled = true;
        break;
      }
    }
  }
  if (!handled && N.quests && N.quests.every((q) => questState(q) === 'locked') && N.before) {
    say(N.before);
    handled = true;
  }
  if (!handled && N.gate) {
    say(questDone(N.gate.requires) ? N.gate.open : N.gate.locked);
    handled = true;
  }
  if (!handled && N.after && N.quests && N.quests.every((q) => questState(q) === 'done')) {
    say(N.after);
    handled = true;
  }
  if (!handled || N.shop || N.inn) {
    if (!handled) say(N.lines[Math.floor(Math.random() * N.lines.length)]);
  }
  if (N.shop) options.push({ label: 'Browse wares', fn: () => openShop(id) }, { label: 'Goodbye', fn: () => {} });
  if (N.inn) {
    options.push({
      label: `Rest for the night (${N.inn} gold)`,
      fn: () => {
        if (S.gold < N.inn) { toast('You can\'t afford a room.', 2000); return; }
        S.gold -= N.inn;
        const st = stats();
        P.hp = st.maxHp;
        P.mp = st.maxMp;
        sfx.level();
        toast('You feel rested. Health and mana restored. Game saved.', 3000);
        save();
      },
    }, { label: 'Goodbye', fn: () => {} });
  }
  openDialog(N, pages, options);
}

// ------------------------------------------------------------------ dialog
function openDialog(N, pages, options) {
  G.dialog = { N, pages, options, page: 0, shown: 0, typingAt: now() };
  G.mode = 'dialog';
  $('dialog').hidden = false;
  $('dlg-name').innerHTML = `${esc(N.name)}<small>${esc(N.role)}</small>`;
  const pc = $('dlg-portrait').getContext('2d');
  pc.clearRect(0, 0, 128, 128);
  drawPerson(pc, 64, 118, 110, { tunic: N.color, hat: N.hat, face: Math.PI / 2, walk: 0, hair: '#5a3a1e' });
  renderDialog();
}
function renderDialog() {
  const D = G.dialog;
  const text = D.pages[D.page] || '';
  $('dlg-text').textContent = text.slice(0, Math.floor(D.shown));
  const last = D.page >= D.pages.length - 1 && D.shown >= text.length;
  const opts = $('dlg-options');
  opts.innerHTML = '';
  if (last && D.options.length) {
    D.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'btn btn-small' + (i === 0 ? ' btn-ember' : '');
      b.textContent = `${i + 1}. ${o.label}`;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        chooseOption(i);
      });
      opts.appendChild(b);
    });
  }
  $('dlg-next').textContent = last ? (D.options.length ? 'Choose an answer' : 'Click or press F to close') : 'Click or press F to continue';
}
function advanceDialog() {
  const D = G.dialog;
  if (!D) return;
  const text = D.pages[D.page] || '';
  if (D.shown < text.length) {
    D.shown = text.length;
  } else if (D.page < D.pages.length - 1) {
    D.page++;
    D.shown = 0;
  } else if (!D.options.length) {
    closeDialog();
    return;
  }
  renderDialog();
}
function chooseOption(i) {
  const D = G.dialog;
  if (!D || !D.options[i]) return;
  const fn = D.options[i].fn;
  closeDialog();
  fn();
}
function closeDialog() {
  G.dialog = null;
  $('dialog').hidden = true;
  if (G.mode === 'dialog') G.mode = 'play';
}
function tickDialog(dt) {
  const D = G.dialog;
  if (!D) return;
  const text = D.pages[D.page] || '';
  if (D.shown < text.length) {
    const before = Math.floor(D.shown);
    D.shown = Math.min(text.length, D.shown + dt * 55);
    if (Math.floor(D.shown) !== before && Math.floor(D.shown) % 3 === 0) sfx.talk();
    renderDialog();
  }
}

// ------------------------------------------------------------------ shop
function itemStat(I) {
  if (I.type === 'weapon') return `Attack ${I.atk}`;
  if (I.type === 'armor') return `Defense ${I.def}`;
  if (I.heal && I.mana) return 'Restores everything';
  if (I.heal) return `+${I.heal} health`;
  if (I.mana) return `+${I.mana} mana`;
  return I.desc;
}
function sellPrice(id) {
  const I = ITEMS[id];
  return I.type === 'loot' ? I.value : Math.floor((I.price || 0) / 2);
}
const ICON = { weapon: ['#c9a35b', 'W'], armor: ['#8fa3b8', 'A'], consumable: ['#e05a5a', 'P'], loot: ['#a3c46a', 'L'], quest: ['#ff9a3c', '!'] };
function icon(id) {
  const I = ITEMS[id];
  let [bg, ch] = ICON[I.type] || ['#888', '?'];
  if (id === 'potion_mp') bg = '#5a8fe0';
  if (id === 'elixir') bg = '#ff9a3c';
  return `<span class="ico" style="background:${bg}">${ch}</span>`;
}
function openShop(id) {
  G.shop = { id, tab: 'buy' };
  G.mode = 'shop';
  $('shop').hidden = false;
  renderShop();
}
function renderShop() {
  const N = NPCS[G.shop.id];
  $('shop-title').textContent = G.shop.id === 'bran' ? 'Bran\'s Smithy' : 'Ivy\'s Remedies';
  $('shop-gold').textContent = S.gold;
  for (const b of $('shop-tabs').children) b.classList.toggle('on', b.dataset.tab === G.shop.tab);
  const body = $('shop-body');
  let html = '<ul class="item-list">';
  if (G.shop.tab === 'buy') {
    const stock = N.shop.filter((id) => !ITEMS[id].cls || ITEMS[id].cls === S.cls);
    for (const id of stock) {
      const I = ITEMS[id];
      const owned = (I.type === 'weapon' || I.type === 'armor') && (S.equip.weapon === id || S.equip.armor === id || hasItem(id));
      const afford = S.gold >= I.price;
      html += `<li class="item">${icon(id)}<div class="info"><b>${esc(I.name)}</b><small>${esc(itemStat(I))} · ${esc(I.desc)}</small></div>
        <div class="acts"><span class="price"><span class="coin"></span>${I.price}</span>
        <button class="btn btn-small ${afford && !owned ? 'btn-ember' : ''}" data-buy="${id}" ${!afford || owned ? 'disabled' : ''}>${owned ? 'Owned' : 'Buy'}</button></div></li>`;
    }
  } else {
    const ids = Object.keys(S.inv).filter((id) => ITEMS[id].type !== 'quest');
    if (!ids.length) html += '<li class="empty">Nothing to sell.</li>';
    for (const id of ids) {
      const I = ITEMS[id];
      html += `<li class="item">${icon(id)}<div class="info"><b>${esc(I.name)} ×${S.inv[id]}</b><small>${esc(itemStat(I))}</small></div>
        <div class="acts"><span class="price"><span class="coin"></span>${sellPrice(id)}</span><button class="btn btn-small" data-sell="${id}">Sell one</button></div></li>`;
    }
  }
  html += '</ul>';
  body.innerHTML = html;
  for (const b of body.querySelectorAll('[data-buy]')) b.addEventListener('click', () => buy(b.dataset.buy));
  for (const b of body.querySelectorAll('[data-sell]')) b.addEventListener('click', () => sell(b.dataset.sell));
}
function buy(id) {
  const I = ITEMS[id];
  if (S.gold < I.price) return;
  S.gold -= I.price;
  sfx.coin();
  if (I.type === 'weapon' || I.type === 'armor') {
    const slot = I.type;
    const cur = ITEMS[S.equip[slot]];
    const better = !cur || (slot === 'weapon' ? I.atk > cur.atk : I.def > cur.def);
    if (better) {
      if (S.equip[slot]) addItem(S.equip[slot]);
      S.equip[slot] = id;
      toast(`Bought and equipped ${I.name}`, 2000);
    } else {
      addItem(id);
      toast(`Bought ${I.name}`, 1500);
    }
  } else {
    addItem(id);
  }
  renderShop();
  renderSkillbar();
  save();
}
function sell(id) {
  if (!hasItem(id)) return;
  S.gold += sellPrice(id);
  removeItem(id);
  sfx.coin();
  renderShop();
  renderSkillbar();
  save();
}
function closeShop() {
  $('shop').hidden = true;
  G.shop = null;
  if (G.mode === 'shop') G.mode = 'play';
}

// ------------------------------------------------------------------ menu (character / inventory / quests)
function openMenu(tab) {
  if (G.mode !== 'play' && G.mode !== 'menu') return;
  G.menuTab = tab || G.menuTab;
  G.mode = 'menu';
  $('menu').hidden = false;
  renderMenu();
}
function closeMenu() {
  $('menu').hidden = true;
  if (G.mode === 'menu') G.mode = 'play';
}
function renderMenu() {
  for (const b of $('menu-tabs').children) b.classList.toggle('on', b.dataset.tab === G.menuTab);
  $('menu-title').textContent = S.name;
  const body = $('menu-body');
  const st = stats();
  if (G.menuTab === 'char') {
    const C = CLASSES[S.cls];
    body.innerHTML = `<div class="two-col">
      <div class="panel" style="padding:14px; display:grid; gap:10px; align-content:start;">
        <span class="label">Level ${S.level} ${C.name}</span>
        <dl class="stat-list">
          <dt>Health</dt><dd>${Math.ceil(P.hp)} / ${st.maxHp}</dd>
          <dt>Mana</dt><dd>${Math.floor(P.mp)} / ${st.maxMp}</dd>
          <dt>Experience</dt><dd>${S.xp} / ${xpNext(S.level)}</dd>
          <dt>Weapon attack</dt><dd>${st.atk}</dd>
          <dt>Defense</dt><dd>${st.def}</dd>
          <dt>Critical chance</dt><dd>${Math.round(st.crit * 100)}%</dd>
          <dt>Move speed</dt><dd>${st.speed.toFixed(1)}</dd>
          <dt>Gold</dt><dd>${S.gold}</dd>
        </dl>
      </div>
      <div class="panel" style="padding:14px; display:grid; gap:4px; align-content:start;">
        <span class="label">Attributes · ${S.points} ${S.points === 1 ? 'point' : 'points'} to spend</span>
        ${Object.entries(ATTRS).map(([k, A]) => `<div class="attr"><div><b>${A.name}</b><small>${A.desc}</small></div><span class="val">${S.attrs[k]}</span>
          <button class="btn btn-small ${S.points ? 'btn-ember' : ''}" data-attr="${k}" ${S.points ? '' : 'disabled'} aria-label="Add a point to ${A.name}">+</button></div>`).join('')}
        <p class="muted" style="margin:6px 0 0; font-size:14px;">You get 3 points every level, and your class grows its main attributes on its own.</p>
      </div>
    </div>
    <div class="panel" style="padding:14px; display:grid; gap:6px;">
      <span class="label">Skills</span>
      ${['q', 'e'].map((k) => { const s = C.skills[k]; return `<div><b style="font-family:var(--font-display)">${k.toUpperCase()} · ${s.name}</b> <span class="muted">(${s.mp} mana, ${s.cooldown}s)</span> · ${s.desc}</div>`; }).join('')}
    </div>`;
    for (const b of body.querySelectorAll('[data-attr]')) {
      b.addEventListener('click', () => {
        if (S.points <= 0) return;
        S.points--;
        S.attrs[b.dataset.attr]++;
        sfx.coin();
        save();
        renderMenu();
      });
    }
  } else if (G.menuTab === 'inv') {
    let html = '<div class="panel" style="padding:14px; display:grid; gap:8px;"><span class="label">Equipped</span><ul class="item-list">';
    for (const slot of ['weapon', 'armor']) {
      const id = S.equip[slot];
      html += id ? `<li class="item equipped">${icon(id)}<div class="info"><b>${esc(ITEMS[id].name)}</b><small>${esc(itemStat(ITEMS[id]))}</small></div><div class="acts"><span class="muted">${slot}</span></div></li>` : '';
    }
    html += '</ul></div><div class="panel" style="padding:14px; display:grid; gap:8px;"><span class="label">Bag</span><ul class="item-list">';
    const ids = Object.keys(S.inv);
    if (!ids.length) html += '<li class="empty">Your bag is empty.</li>';
    for (const id of ids) {
      const I = ITEMS[id];
      let act = '';
      if (I.type === 'consumable') act = `<button class="btn btn-small btn-ember" data-use="${id}">Use</button>`;
      else if ((I.type === 'weapon' && I.cls === S.cls) || I.type === 'armor') act = `<button class="btn btn-small btn-ember" data-equip="${id}">Equip</button>`;
      else if (I.type === 'weapon') act = '<span class="muted">Not for your class</span>';
      html += `<li class="item">${icon(id)}<div class="info"><b>${esc(I.name)}${S.inv[id] > 1 ? ' ×' + S.inv[id] : ''}</b><small>${esc(itemStat(I))}${I.type !== 'consumable' && I.desc && itemStat(I) !== I.desc ? ' · ' + esc(I.desc) : ''}</small></div><div class="acts">${act}</div></li>`;
    }
    html += '</ul></div>';
    body.innerHTML = html;
    for (const b of body.querySelectorAll('[data-use]')) b.addEventListener('click', () => { usePotion(b.dataset.use); renderMenu(); });
    for (const b of body.querySelectorAll('[data-equip]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.equip, slot = ITEMS[id].type;
        removeItem(id);
        if (S.equip[slot]) addItem(S.equip[slot]);
        S.equip[slot] = id;
        sfx.coin();
        save();
        renderMenu();
      });
    }
  } else {
    let html = '';
    const ids = Object.keys(QUESTS);
    const active = ids.filter((id) => S.quests[id] && S.quests[id].state !== 'done');
    const done = ids.filter((id) => questDone(id));
    html += '<span class="label">Active</span>';
    if (!active.length) html += '<p class="empty">No active quests. Look for villagers with a gold "!" over their heads.</p>';
    for (const id of active) {
      const Q = QUESTS[id], q = S.quests[id];
      const ready = questComplete(id);
      const prog = ready ? `Ready to turn in to ${NPCS[Q.giver].name}` : Q.type === 'kill' ? `${q.progress} / ${Q.count} defeated` : 'Not found yet';
      html += `<div class="q-entry"><b>${esc(Q.title)}</b><p>${esc(Q.desc)}</p><span class="prog">${esc(prog)}</span></div>`;
    }
    html += '<span class="label">Completed</span>';
    if (!done.length) html += '<p class="empty">None yet.</p>';
    for (const id of done) html += `<div class="q-entry done"><b>${esc(QUESTS[id].title)}</b></div>`;
    body.innerHTML = html;
  }
}

// ------------------------------------------------------------------ HUD
function renderTracker() {
  if (!S) return;
  const el = $('tracker');
  const active = Object.keys(QUESTS).filter((id) => S.quests[id] && S.quests[id].state !== 'done');
  if (!active.length) {
    const avail = Object.keys(QUESTS).find((id) => questState(id) === 'available');
    el.innerHTML = avail
      ? `<h4>Next step</h4><div class="trk"><b>Talk to ${esc(NPCS[QUESTS[avail].giver].name)}</b><span>They have work for you in the village.</span></div>`
      : '<h4>Quests</h4><div class="trk"><span>All quests complete. Keep exploring!</span></div>';
    return;
  }
  el.innerHTML = '<h4>Quests</h4>' + active.map((id) => {
    const Q = QUESTS[id], q = S.quests[id], ready = questComplete(id);
    const line = ready ? `Return to ${NPCS[Q.giver].name}` : Q.type === 'kill' ? `${ENEMIES[Q.target].name}: ${q.progress} / ${Q.count}` : 'Search the Whispering Woods';
    return `<div class="trk${ready ? ' ready' : ''}"><b>${esc(Q.title)}</b><span>${esc(line)}</span></div>`;
  }).join('');
}
function renderSkillbar() {
  if (!S) return;
  const C = CLASSES[S.cls];
  const slot = (key, name, extra = '') => `<div class="skill" data-k="${key}"><kbd>${key}</kbd><span class="nm">${name}</span>${extra}<div class="cd"></div></div>`;
  $('skillbar').innerHTML = slot('Click', C.attack.kind === 'melee' ? 'Attack' : 'Shoot')
    + slot('Q', C.skills.q.name)
    + slot('E', C.skills.e.name)
    + slot('1', 'Health', `<span class="cnt">${S.inv.potion_hp || 0}</span>`)
    + slot('2', 'Mana', `<span class="cnt">${S.inv.potion_mp || 0}</span>`);
  $('t-pot').textContent = `POTION ${S.inv.potion_hp || 0}`;
}
function updateHUD() {
  const st = stats(), t = now();
  $('hud-name').textContent = S.name;
  $('hud-level').textContent = `Lv ${S.level} ${CLASSES[S.cls].name}`;
  const bar = (id, v, max, label) => {
    const el = $(id);
    el.firstElementChild.style.width = (clamp(v / max, 0, 1) * 100) + '%';
    if (label !== undefined) el.lastElementChild.textContent = label;
  };
  bar('hp-bar', P.hp, st.maxHp, `${Math.ceil(P.hp)} / ${st.maxHp}`);
  bar('mp-bar', P.mp, st.maxMp, `${Math.floor(P.mp)} / ${st.maxMp}`);
  bar('xp-bar', S.xp, xpNext(S.level));
  $('hud-gold').textContent = S.gold;
  $('hud-points').textContent = S.points ? `${S.points} points to spend (C)` : '';
  $('lowhp').style.opacity = P.hp / st.maxHp < 0.3 ? 1 : 0;
  // cooldown overlays
  const C = CLASSES[S.cls];
  for (const el of $('skillbar').children) {
    const k = el.dataset.k, cd = el.querySelector('.cd');
    if (k === 'Q' || k === 'E') {
      const s = k.toLowerCase(), left = Math.max(0, P.cds[s] - t);
      cd.style.height = (left / C.skills[s].cooldown) * 100 + '%';
      el.classList.toggle('nomana', P.mp < C.skills[s].mp);
    } else if (k === 'Click') {
      const left = Math.max(0, P.nextAttack - t);
      cd.style.height = (left / C.attack.cooldown) * 100 + '%';
    }
  }
  if (G.boss) {
    const b = $('boss-bar');
    b.querySelector('i').style.width = (G.boss.hp / G.boss.maxHp) * 100 + '%';
    b.querySelector('span').textContent = `${Math.max(0, Math.ceil(G.boss.hp))} / ${G.boss.maxHp}`;
  }
  // interaction prompt
  const it = G.mode === 'play' ? nearestInteractable() : null;
  const pr = $('prompt');
  if (it) {
    pr.hidden = false;
    pr.innerHTML = `<kbd>${G.isTouch ? 'TALK' : 'F'}</kbd>${it.kind === 'npc' ? `Talk to ${esc(NPCS[it.ref.id].name)}` : 'Open chest'}`;
    $('t-act').textContent = it.kind === 'npc' ? 'TALK' : 'OPEN';
  } else {
    pr.hidden = true;
    $('t-act').textContent = 'TALK';
  }
}
let toastTimer;
function toast(text, ms = 2500) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function showBanner(name, sub) {
  const el = $('area-banner');
  el.innerHTML = `${esc(name)}<small>${esc(sub)}</small>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function showOverlay(id) {
  $(id).hidden = false;
  if (id === 'victory') {
    G.mode = 'victory';
    $('victory-text').textContent = `${S.name} the ${CLASSES[S.cls].name} put out the Cinder Warden's fire. The ash storms are over, and Emberwood is safe. Your hero is saved, so you can keep exploring, level up and collect gear.`;
  }
}

// ------------------------------------------------------------------ rendering
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  vw = window.innerWidth;
  vh = window.innerHeight;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  dark.width = canvas.width;
  dark.height = canvas.height;
  G.tp = clamp(Math.round(Math.min(vw / 17, vh / 11.5)), 30, 58);
  const ec = $('embers');
  ec.width = Math.round(vw * dpr);
  ec.height = Math.round(vh * dpr);
}
function snapCamera() {
  G.cam.x = P.x;
  G.cam.y = P.y;
  clampCamera();
}
function clampCamera() {
  const g = G.map.grid, hw = vw / 2 / G.tp, hh = vh / 2 / G.tp;
  G.cam.x = g.w <= hw * 2 ? g.w / 2 : clamp(G.cam.x, hw, g.w - hw);
  G.cam.y = g.h <= hh * 2 ? g.h / 2 : clamp(G.cam.y, hh, g.h - hh);
}
function render() {
  const tp = G.tp, t = now();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const th = THEME[G.map.id] || THEME.village;
  ctx.fillStyle = th.dark;
  ctx.fillRect(0, 0, vw, vh);
  const k = 1 - Math.exp(-8 * 0.016);
  G.cam.x += (P.x - G.cam.x) * k * 2;
  G.cam.y += (P.y - 0.3 - G.cam.y) * k * 2;
  clampCamera();
  const shx = G.shake > 0 ? rand(-1, 1) * G.shake * 8 : 0, shy = G.shake > 0 ? rand(-1, 1) * G.shake * 8 : 0;
  const ox = vw / 2 - G.cam.x * tp + shx, oy = vh / 2 - G.cam.y * tp + shy;
  const W = (x) => ox + x * tp, H = (y) => oy + y * tp;
  // map layer (only the visible part)
  const layer = G.layers[G.map.id];
  const sx0 = Math.max(0, -ox / tp), sy0 = Math.max(0, -oy / tp);
  const sw = Math.min(G.map.grid.w - sx0, vw / tp + 1), sh = Math.min(G.map.grid.h - sy0, vh / tp + 1);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer, sx0 * LAYER_PX, sy0 * LAYER_PX, sw * LAYER_PX, sh * LAYER_PX, W(sx0), H(sy0), sw * tp, sh * tp);
  // lava shimmer
  const x0 = Math.floor(sx0), y0 = Math.floor(sy0), x1 = Math.ceil(sx0 + sw), y1 = Math.ceil(sy0 + sh);
  const lavaTiles = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (G.map.grid.get(x, y) === T.LAVA) {
      lavaTiles.push([x, y]);
      ctx.fillStyle = `rgba(255,${170 + Math.sin(t * 3 + x + y) * 50},60,${0.18 + Math.sin(t * 2 + x * 0.7 + y) * 0.1})`;
      ctx.fillRect(W(x), H(y), tp, tp);
    }
  }
  // boss telegraphs on the ground
  for (const e of G.enemies) {
    if (!e.boss || !e.action || e.actPhase !== 'windup') continue;
    const prog = Math.min(1, (t - e.actAt) / (e.action === 'slam' ? 0.9 : 0.6));
    ctx.save();
    if (e.action === 'slam') {
      ctx.fillStyle = `rgba(255,60,30,${0.15 + prog * 0.25})`;
      ctx.beginPath();
      ctx.arc(W(e.x), H(e.y), 2.8 * tp, 0, 7);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,40,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W(e.x), H(e.y), 2.8 * tp * prog, 0, 7);
      ctx.stroke();
    } else if (e.action === 'charge') {
      const a = Math.atan2(e.target[1] - e.y, e.target[0] - e.x);
      ctx.translate(W(e.x), H(e.y));
      ctx.rotate(a);
      ctx.fillStyle = `rgba(255,60,30,${0.12 + prog * 0.25})`;
      ctx.fillRect(0, -0.9 * tp, 7 * tp, 1.8 * tp);
    }
    ctx.restore();
  }
  // pickups and chests
  for (const d of G.drops) {
    const bob = Math.sin(t * 4 + d.x) * 0.08;
    const I = ITEMS[d.item];
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(W(d.x), H(d.y), 0.18 * tp, 0.07 * tp, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = d.item === 'potion_mp' ? '#5a8fe0' : I.type === 'consumable' ? '#e05a5a' : I.type === 'loot' ? '#c9b083' : '#c9a35b';
    ctx.beginPath();
    ctx.arc(W(d.x), H(d.y - 0.25 + bob), 0.15 * tp, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const c of G.map.chests) drawChest(W(c.x), H(c.y), tp, !!S.chests[c.id]);
  // characters sorted by depth
  const actors = [
    ...G.npcs.map((n) => ({ y: n.y, draw: () => drawNpc(n, W(n.x), H(n.y), tp) })),
    ...G.enemies.map((e) => ({ y: e.y, draw: () => drawEnemy(ctx, e, W(e.x), H(e.y), tp) })),
    { y: P.y, draw: () => drawPlayer(W(P.x), H(P.y), tp) },
  ].sort((a, b) => a.y - b.y);
  for (const a of actors) a.draw();
  // projectiles
  for (const p of G.projectiles) {
    const px = W(p.x), py = H(p.y);
    ctx.save();
    if (p.kind === 'arrow') {
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.strokeStyle = '#d9c7a3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-0.35 * tp, 0);
      ctx.lineTo(0.15 * tp, 0);
      ctx.stroke();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath();
      ctx.moveTo(0.25 * tp, 0);
      ctx.lineTo(0.12 * tp, -5);
      ctx.lineTo(0.12 * tp, 5);
      ctx.fill();
    } else {
      const col = { bolt: '#b48cff', fireball: '#ff8a2a', fire: '#ff6a1a', spore: '#b8e05a' }[p.kind];
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px, py, p.r * tp, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(px, py, p.r * tp * 0.45, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
  // effects
  G.effects = G.effects.filter((fx) => {
    const k2 = (t - fx.start) / fx.dur;
    if (k2 >= 1) return false;
    ctx.save();
    if (fx.kind === 'slash') {
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k2)})`;
      ctx.lineWidth = 0.12 * tp;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const a0 = fx.a - fx.arc, a1 = fx.a - fx.arc + fx.arc * 2 * Math.min(1, k2 * 1.6);
      ctx.arc(W(fx.x), H(fx.y), fx.r * tp * 0.8, a0, a1);
      ctx.stroke();
    } else if (fx.kind === 'whirl') {
      ctx.strokeStyle = `rgba(255,230,200,${0.7 * (1 - k2)})`;
      ctx.lineWidth = 0.15 * tp;
      ctx.beginPath();
      ctx.arc(W(fx.x), H(fx.y), fx.r * tp * (0.6 + k2 * 0.4), k2 * 12, k2 * 12 + 4.5);
      ctx.stroke();
    } else if (fx.kind === 'ring') {
      ctx.strokeStyle = `rgba(${fx.color},${0.85 * (1 - k2)})`;
      ctx.fillStyle = `rgba(${fx.color},${0.3 * (1 - k2)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(W(fx.x), H(fx.y), fx.r * tp * (0.4 + k2 * 0.6), 0, 7);
      if (fx.fill) ctx.fill();
      ctx.stroke();
    } else if (fx.kind === 'nova') {
      ctx.fillStyle = `rgba(150,220,255,${0.35 * (1 - k2)})`;
      ctx.strokeStyle = `rgba(210,245,255,${0.9 * (1 - k2)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(W(fx.x), H(fx.y), fx.r * tp * Math.min(1, k2 * 2.5), 0, 7);
      ctx.fill();
      ctx.stroke();
    } else if (fx.kind === 'levelup') {
      ctx.fillStyle = `rgba(255,211,106,${0.4 * (1 - k2)})`;
      ctx.fillRect(W(fx.x) - 0.4 * tp, H(fx.y) - 3 * tp * k2 - 1 * tp, 0.8 * tp, 1.2 * tp);
    }
    ctx.restore();
    return true;
  });
  // particles
  G.parts = G.parts.filter((p) => {
    const age = t - p.born;
    if (age > p.life) return false;
    p.x += p.vx * 0.016;
    p.y += p.vy * 0.016;
    p.vy += 6 * 0.016;
    ctx.globalAlpha = 1 - age / p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(W(p.x) - p.size / 2, H(p.y) - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
    return true;
  });
  // darkness in the cave
  if (G.map.dark) {
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, vw, vh);
    dctx.fillStyle = 'rgba(6,3,10,0.9)';
    dctx.fillRect(0, 0, vw, vh);
    dctx.globalCompositeOperation = 'destination-out';
    const light = (x, y, r, a = 1) => {
      const gr = dctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = gr;
      dctx.beginPath();
      dctx.arc(x, y, r, 0, 7);
      dctx.fill();
    };
    light(W(P.x), H(P.y - 0.4), 5.5 * tp + Math.sin(t * 7) * 3);
    for (const [x, y] of lavaTiles) light(W(x + 0.5), H(y + 0.5), 1.9 * tp, 0.8);
    for (const p of G.projectiles) if (p.kind !== 'arrow') light(W(p.x), H(p.y), 1.6 * tp, 0.9);
    for (const e of G.enemies) if (e.boss) light(W(e.x), H(e.y - 0.9), 3.5 * tp, 0.85);
    for (const fx of G.effects) if (fx.kind === 'ring') light(W(fx.x), H(fx.y), fx.r * tp, 0.7);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // NPC names and quest markers (above the dark)
  for (const n of G.npcs) {
    const N = NPCS[n.id];
    const mark = npcMarker(n.id);
    const d = Math.hypot(n.x - P.x, n.y - P.y);
    const top = H(n.y) - 1.25 * tp;
    if (mark) {
      ctx.font = `800 ${Math.round(tp * 0.6)}px "Alegreya SC", Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#2a1600';
      ctx.fillStyle = mark === '?' ? '#7dff8a' : '#ffd36a';
      const by = top - 4 + Math.sin(t * 4) * 3;
      ctx.strokeText(mark, W(n.x), by);
      ctx.fillText(mark, W(n.x), by);
    }
    if (d < 4.5) {
      ctx.font = `700 ${Math.round(tp * 0.3)}px "Alegreya Sans", sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#f1e6cf';
      ctx.strokeText(N.name, W(n.x), top + (mark ? 0.2 * tp : 0.45 * tp));
      ctx.fillText(N.name, W(n.x), top + (mark ? 0.2 * tp : 0.45 * tp));
    }
  }
  // floating numbers
  G.floaters = G.floaters.filter((f) => {
    const age = t - f.start;
    if (age > 1.1) return false;
    ctx.font = `800 ${Math.round(tp * 0.42 * f.scale)}px "Alegreya Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.globalAlpha = 1 - Math.max(0, age - 0.6) / 0.5;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const fy = H(f.y) - age * tp * 0.8;
    ctx.strokeText(f.text, W(f.x), fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, W(f.x), fy);
    ctx.globalAlpha = 1;
    return true;
  });
  G.shake = Math.max(0, G.shake - 0.05);
}
function npcMarker(id) {
  const N = NPCS[id];
  if (!N.quests) return null;
  if (N.quests.some((q) => questState(q) === 'ready')) return '?';
  if (N.quests.some((q) => questState(q) === 'available')) return '!';
  return null;
}
function drawNpc(n, sx, sy, u) {
  const N = NPCS[n.id];
  drawPerson(ctx, sx, sy, u, { tunic: N.color, hat: N.hat, face: n.face, walk: n.walk, moving: n.moving, hair: '#5a3a1e' });
}
function drawPlayer(sx, sy, u) {
  const t = now();
  const C = CLASSES[S.cls];
  let swing = 0;
  const since = t - P.attackAt;
  if (C.attack.kind === 'melee' && since < 0.18) swing = -C.attack.arc + (since / 0.18) * C.attack.arc * 2;
  const blink = t < P.invulnUntil && Math.floor(t * 20) % 2 === 0;
  const rolling = t < P.rollUntil;
  ctx.save();
  if (rolling) {
    ctx.translate(sx, sy - 0.35 * u);
    ctx.rotate(((t * 18) % (Math.PI * 2)) * (P.rollDir[0] >= 0 ? 1 : -1));
    ctx.translate(-sx, -(sy - 0.35 * u));
  }
  if (t < P.cryUntil) {
    ctx.fillStyle = `rgba(255,90,60,${0.18 + Math.sin(t * 10) * 0.08})`;
    ctx.beginPath();
    ctx.arc(sx, sy - 0.4 * u, 0.6 * u, 0, 7);
    ctx.fill();
  }
  drawPerson(ctx, sx, sy, u, heroLook({ face: P.face, walk: P.walk, moving: P.moving, swing, alpha: blink ? 0.4 : 1 }));
  ctx.restore();
}
function drawChest(sx, sy, u, open) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 0.05 * u, 0.4 * u, 0.12 * u, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#7a4e26';
  ctx.fillRect(sx - 0.36 * u, sy - 0.4 * u, 0.72 * u, 0.42 * u);
  ctx.fillStyle = '#c9a35b';
  ctx.fillRect(sx - 0.36 * u, sy - 0.24 * u, 0.72 * u, 0.05 * u);
  if (open) {
    ctx.fillStyle = '#1a0f06';
    ctx.fillRect(sx - 0.32 * u, sy - 0.46 * u, 0.64 * u, 0.1 * u);
    ctx.fillStyle = '#5e3a1b';
    ctx.fillRect(sx - 0.36 * u, sy - 0.66 * u, 0.72 * u, 0.2 * u);
  } else {
    ctx.fillStyle = '#8c5a2c';
    roundRect(ctx, sx - 0.38 * u, sy - 0.58 * u, 0.76 * u, 0.22 * u, 0.08 * u);
    ctx.fill();
    ctx.fillStyle = '#ffd36a';
    ctx.fillRect(sx - 0.05 * u, sy - 0.34 * u, 0.1 * u, 0.1 * u);
    ctx.fillStyle = `rgba(255,220,120,${0.25 + Math.sin(now() * 3) * 0.15})`;
    ctx.beginPath();
    ctx.arc(sx, sy - 0.3 * u, 0.6 * u, 0, 7);
    ctx.fill();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ main loop
let last = now();
function frame() {
  requestAnimationFrame(frame);
  const t = now();
  const dt = Math.min(0.05, t - last);
  last = t;
  if (G.mode === 'title' || G.mode === 'create') {
    drawEmbers(dt);
    return;
  }
  if (!G.map) return;
  if (G.mode === 'play') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateDrops();
    updateNpcs(dt);
    checkExits();
    if (t - G.lastSave > 30) save();
  } else if (G.mode === 'dialog') {
    tickDialog(dt);
  }
  render();
  updateHUD();
}

// title-screen embers
const embers = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: rand(1, 3), v: rand(0.02, 0.07), w: rand(0, 6) }));
function drawEmbers(dt) {
  const ec = $('embers'), c = ec.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, vw, vh);
  for (const e of embers) {
    e.y -= e.v * dt;
    e.w += dt;
    if (e.y < -0.02) { e.y = 1.02; e.x = Math.random(); }
    const x = (e.x + Math.sin(e.w) * 0.01) * vw, y = e.y * vh;
    c.fillStyle = `rgba(255,${120 + e.s * 30},50,${0.35 + e.s * 0.15})`;
    c.beginPath();
    c.arc(x, y, e.s, 0, 7);
    c.fill();
  }
}

// ------------------------------------------------------------------ input
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  sfx.ensure();
  const code = e.code;
  if (G.mode === 'dialog') {
    if (code === 'KeyF' || code === 'Space' || code === 'Enter') { e.preventDefault(); advanceDialog(); }
    if (/^Digit[1-4]$/.test(code)) chooseOption(Number(code.slice(5)) - 1);
    if (code === 'Escape' && !G.dialog.options.length) closeDialog();
    return;
  }
  if (G.mode === 'menu') {
    if (code === 'Escape') closeMenu();
    if (code === 'KeyC') { G.menuTab === 'char' ? closeMenu() : openMenu('char'); }
    if (code === 'KeyI') { G.menuTab === 'inv' ? closeMenu() : openMenu('inv'); }
    if (code === 'KeyL') { G.menuTab === 'quests' ? closeMenu() : openMenu('quests'); }
    return;
  }
  if (G.mode === 'shop') {
    if (code === 'Escape') closeShop();
    return;
  }
  if (G.mode !== 'play') return;
  G.keys.add(code);
  if (code === 'Space') e.preventDefault();
  if (code === 'KeyQ') useSkill('q');
  if (code === 'KeyE') useSkill('e');
  if (code === 'KeyF' || code === 'Enter') interact();
  if (code === 'Digit1') usePotion('potion_hp');
  if (code === 'Digit2') usePotion('potion_mp');
  if (code === 'KeyC' || code === 'Tab') { e.preventDefault(); openMenu('char'); }
  if (code === 'KeyI') openMenu('inv');
  if (code === 'KeyL') openMenu('quests');
  if (code === 'Escape') openMenu();
});
window.addEventListener('keyup', (e) => G.keys.delete(e.code));
window.addEventListener('blur', () => { G.keys.clear(); G.mouse.down = false; });
canvas.addEventListener('mousemove', (e) => {
  G.mouse.sx = e.clientX;
  G.mouse.sy = e.clientY;
  G.mouse.active = true;
  G.mouse.at = now();
});
canvas.addEventListener('mousedown', (e) => {
  sfx.ensure();
  if (G.mode === 'dialog') { advanceDialog(); return; }
  if (e.button === 0) G.mouse.down = true;
  G.mouse.sx = e.clientX;
  G.mouse.sy = e.clientY;
  G.mouse.active = true;
});
window.addEventListener('mouseup', () => { G.mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
$('dialog').addEventListener('click', () => { if (G.dialog && !(G.dialog.options.length && G.dialog.page >= G.dialog.pages.length - 1 && G.dialog.shown >= (G.dialog.pages[G.dialog.page] || '').length)) advanceDialog(); });

// touch
function setupTouch() {
  if (!G.isTouch) return;
  $('touch').hidden = false;
  const stick = $('stick'), knob = $('knob');
  let id = null, origin = null;
  stick.addEventListener('pointerdown', (e) => {
    sfx.ensure();
    id = e.pointerId;
    const r = stick.getBoundingClientRect();
    origin = [r.left + r.width / 2, r.top + r.height / 2];
    stick.setPointerCapture(e.pointerId);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - origin[0], dy = e.clientY - origin[1];
    const l = Math.hypot(dx, dy), max = 50;
    if (l > max) { dx *= max / l; dy *= max / l; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    G.stick.x = dx / max;
    G.stick.y = dy / max;
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    knob.style.transform = '';
    G.stick.x = G.stick.y = 0;
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  const btn = (bid, down, up) => {
    const el = $(bid);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); sfx.ensure(); down(); });
    if (up) {
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    }
  };
  btn('t-attack', () => { G.touchAttack = true; }, () => { G.touchAttack = false; });
  btn('t-q', () => G.mode === 'play' && useSkill('q'));
  btn('t-e', () => G.mode === 'play' && useSkill('e'));
  btn('t-act', () => { if (G.mode === 'dialog') advanceDialog(); else if (G.mode === 'play') interact(); });
  btn('t-pot', () => G.mode === 'play' && usePotion('potion_hp'));
}

// ------------------------------------------------------------------ menus wiring
$('menu-btn').addEventListener('click', () => openMenu());
$('menu-close').addEventListener('click', closeMenu);
for (const b of $('menu-tabs').children) b.addEventListener('click', () => { G.menuTab = b.dataset.tab; renderMenu(); });
$('shop-close').addEventListener('click', closeShop);
for (const b of $('shop-tabs').children) b.addEventListener('click', () => { G.shop.tab = b.dataset.tab; renderShop(); });
$('death-btn').addEventListener('click', () => {
  $('death').hidden = true;
  const st = stats();
  P.hp = st.maxHp;
  P.mp = st.maxMp;
  P.cryUntil = 0;
  const inn = world.village.innSpot;
  travel('village', inn[0], inn[1]);
});
$('victory-btn').addEventListener('click', () => {
  $('victory').hidden = true;
  G.mode = 'play';
});

// ------------------------------------------------------------------ title & character creation
const draft = { cls: 'warrior', color: TUNIC_COLORS[0] };
function showTitle() {
  G.mode = 'title';
  $('title').hidden = false;
  $('create').hidden = true;
  $('hud').hidden = true;
  $('embers').hidden = false;
  const s = loadSave();
  $('btn-continue').hidden = !s;
  $('save-info').textContent = s ? `Saved: ${s.name}, level ${s.level} ${CLASSES[s.cls].name} · ${s.gold} gold` : '';
}
function showCreate() {
  G.mode = 'create';
  $('title').hidden = true;
  $('create').hidden = false;
  renderCreate();
  setTimeout(() => $('hero-name').focus(), 50);
}
function renderCreate() {
  const grid = $('class-grid');
  grid.innerHTML = '';
  for (const C of Object.values(CLASSES)) {
    const b = document.createElement('button');
    b.className = 'panel class-card' + (draft.cls === C.id ? ' on' : '');
    b.setAttribute('aria-pressed', draft.cls === C.id);
    b.innerHTML = `<canvas width="144" height="144"></canvas><h3>${C.name}</h3><span class="tag">${C.tagline}</span><p>${C.desc}</p>
      <div class="skills"><div><b>Q · ${C.skills.q.name}</b> ${C.skills.q.desc}</div><div><b>E · ${C.skills.e.name}</b> ${C.skills.e.desc}</div></div>`;
    const pc = b.querySelector('canvas').getContext('2d');
    drawPerson(pc, 72, 132, 118, { tunic: draft.color, weapon: WEAPON_ART[C.id], face: 0.5, walk: 0, hair: '#3b2414' });
    b.addEventListener('click', () => { draft.cls = C.id; renderCreate(); });
    grid.appendChild(b);
  }
  const sw = $('swatches');
  sw.innerHTML = '';
  for (const c of TUNIC_COLORS) {
    const s = document.createElement('button');
    s.className = 'swatch' + (draft.color === c ? ' on' : '');
    s.style.background = c;
    s.setAttribute('aria-label', 'Tunic color ' + c);
    s.addEventListener('click', () => { draft.color = c; renderCreate(); });
    sw.appendChild(s);
  }
}
function newHero() {
  const C = CLASSES[draft.cls];
  const name = ($('hero-name').value || '').replace(/[^\w \-']/g, '').trim().slice(0, 14) || 'Ash';
  S = {
    v: 1, name, cls: C.id, color: draft.color, level: 1, xp: 0, gold: 30, attrs: { ...C.base }, points: 0,
    inv: { potion_hp: 3, potion_mp: 1 }, equip: { weapon: C.weapon, armor: 'armor_cloth' },
    quests: {}, chests: {}, bossDead: false, map: 'village', x: world.village.start[0], y: world.village.start[1],
  };
  const st = stats();
  S.hp = st.maxHp;
  S.mp = st.maxMp;
  startGame(true);
}
function startGame(fresh = false) {
  $('title').hidden = true;
  $('create').hidden = true;
  $('embers').hidden = true;
  $('hud').hidden = false;
  P.hp = S.hp;
  P.mp = S.mp;
  P.cds = { q: 0, e: 0 };
  G.mode = 'play';
  renderSkillbar();
  changeMap(S.map, S.x, S.y, { silent: true });
  if (fresh) {
    setTimeout(() => toast(`Welcome to Emberwood, ${S.name}. Elder Maren is waiting for you, north of the square.`, 5000), 800);
  }
}
$('btn-new').addEventListener('click', () => {
  sfx.ensure();
  if (loadSave()) $('confirm-new').hidden = false;
  else showCreate();
});
$('confirm-yes').addEventListener('click', () => { $('confirm-new').hidden = true; showCreate(); });
$('confirm-no').addEventListener('click', () => { $('confirm-new').hidden = true; });
$('btn-continue').addEventListener('click', () => {
  sfx.ensure();
  S = loadSave();
  if (S) startGame();
});
$('create-back').addEventListener('click', showTitle);
$('create-go').addEventListener('click', () => { sfx.ensure(); newHero(); });
$('hero-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') newHero(); });

window.addEventListener('resize', () => {
  resize();
  if (G.map) clampCamera();
});
window.addEventListener('beforeunload', () => { if (G.mode !== 'title' && G.mode !== 'create') save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S) save(); });

resize();
setupTouch();
showTitle();
requestAnimationFrame(frame);
// for debugging in the console
window.emberwood = { G, P, get S() { return S; }, world, stats, gainXp, changeMap };
