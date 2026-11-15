// The blocky "hopper" avatar and every item you can buy for it with Ariabux.
// Used by Hopscape (in game) and by the Avatar Shop on the Ariabux page.
//
// buildAvatar(color, outfit) returns a THREE.Group facing +z, feet at y = 0, with:
//   userData.limbs   { legL, legR, armL, armR } pivots for walk animation
//   userData.animate (dt, moving, airborne) to run item effects (propellers, flames, flapping wings)

import * as THREE from '../vendor/three.module.js';
import { AVATAR_ITEMS, SLOTS, BODY_COLORS } from './bux.js';

export { AVATAR_ITEMS, SLOTS, BODY_COLORS };

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const glow = (color) => new THREE.MeshBasicMaterial({ color });
function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ------------------------------------------------------------------ hats (sit on a head whose top is y = 2.25)
const HATS = {
  cone(g) {
    mesh(new THREE.ConeGeometry(0.26, 0.62, 16), std(0xff70a6), 0, 2.56, 0, g);
    mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.06, 16), std(0xffd23f), 0, 2.42, 0, g);
    mesh(new THREE.SphereGeometry(0.08, 10, 8), std(0xffffff), 0, 2.9, 0, g);
  },
  propeller(g, anim) {
    mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x3a86ff), 0, 2.2, 0, g);
    mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), std(0x444444), 0, 2.6, 0, g);
    const prop = new THREE.Group();
    prop.position.y = 2.72;
    for (const [c, r] of [[0xff5d5d, 0], [0xffd23f, Math.PI / 2]]) mesh(boxG(0.62, 0.03, 0.1), std(c), 0, 0, 0, prop).rotation.y = r;
    g.add(prop);
    anim.push((dt, moving, air) => { prop.rotation.y += dt * (moving || air ? 22 : 6); });
  },
  tophat(g) {
    mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.05, 20), std(0x1d1d24), 0, 2.27, 0, g);
    mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.55, 20), std(0x1d1d24), 0, 2.56, 0, g);
    mesh(new THREE.CylinderGeometry(0.295, 0.295, 0.1, 20), std(0xd62839), 0, 2.36, 0, g);
  },
  wizard(g) {
    mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), std(0x5b2a9e), 0, 2.27, 0, g);
    mesh(new THREE.ConeGeometry(0.34, 0.95, 18), std(0x6c3ac2), 0.04, 2.74, 0, g).rotation.z = -0.15;
    for (const [x, y, z] of [[0.18, 2.55, 0.22], [-0.12, 2.75, 0.2], [0.05, 2.95, 0.12]]) mesh(new THREE.OctahedronGeometry(0.05), glow(0xffe066), x, y, z, g);
  },
  halo(g, anim) {
    const ring = mesh(new THREE.TorusGeometry(0.3, 0.045, 10, 32), glow(0xffe680), 0, 2.62, 0, g);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = false;
    let t = 0;
    anim.push((dt) => { t += dt; ring.position.y = 2.62 + Math.sin(t * 2.5) * 0.04; });
  },
  crown(g) {
    const gold = std(0xffc83d, { metalness: 0.6, roughness: 0.3, emissive: 0x6b4a00, emissiveIntensity: 0.3, side: THREE.DoubleSide });
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 20, 1, true), gold, 0, 2.35, 0, g);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      mesh(new THREE.ConeGeometry(0.07, 0.18, 6), gold, Math.cos(a) * 0.27, 2.53, Math.sin(a) * 0.27, g);
      mesh(new THREE.SphereGeometry(0.035, 8, 6), glow(i % 2 ? 0xff3b5c : 0x3bd1ff), Math.cos(a) * 0.305, 2.35, Math.sin(a) * 0.305, g);
    }
  },
};

// ------------------------------------------------------------------ heads (replace the default head, centered at y = 1.97)
const eyes = (g, color = 0x1a1a1a, y = 2.0, z = 0.29, gap = 0.13, size = [0.09, 0.12]) => {
  for (const s of [-1, 1]) mesh(boxG(size[0], size[1], 0.02), glow(color), s * gap, y, z, g);
};
const HEADS = {
  robot(g, anim) {
    mesh(boxG(0.62, 0.56, 0.58), std(0xa7b1bd, { metalness: 0.6, roughness: 0.35 }), 0, 1.97, 0, g);
    const visor = mesh(boxG(0.48, 0.12, 0.03), glow(0x3dfcff), 0, 2.0, 0.3, g);
    mesh(boxG(0.3, 0.05, 0.02), glow(0x2b2f3a), 0, 1.84, 0.3, g);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 6), std(0x555555), 0, 2.37, 0, g);
    const bulb = mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(0xff3b3b), 0, 2.5, 0, g);
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), std(0x6d7783, { metalness: 0.6 }), s * 0.34, 1.97, 0, g).rotation.z = Math.PI / 2;
    let t = 0;
    anim.push((dt) => { t += dt; bulb.visible = Math.sin(t * 6) > -0.3; visor.material.color.setHSL(0.5, 1, 0.55 + Math.sin(t * 3) * 0.1); });
  },
  pumpkin(g) {
    const p = mesh(new THREE.SphereGeometry(0.38, 18, 14), std(0xff8a1f), 0, 1.98, 0, g);
    p.scale.set(1.05, 0.85, 1);
    const dark = glow(0x2a1200);
    for (const s of [-1, 1]) {
      const e = mesh(new THREE.ConeGeometry(0.07, 0.1, 3), dark, s * 0.13, 2.04, 0.33, g);
      e.rotation.x = Math.PI / 2;
    }
    mesh(boxG(0.3, 0.06, 0.02), dark, 0, 1.86, 0.34, g);
    mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 8), std(0x3b7a2a), 0, 2.34, 0, g);
  },
  cat(g) {
    const fur = std(0xf4a261);
    mesh(boxG(0.6, 0.54, 0.56), fur, 0, 1.96, 0, g);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.12, 0.2, 4), fur, s * 0.2, 2.31, 0, g);
      ear.rotation.y = Math.PI / 4;
      mesh(new THREE.ConeGeometry(0.06, 0.1, 4), std(0xffb3c6), s * 0.2, 2.3, 0.05, g).rotation.y = Math.PI / 4;
      for (const k of [-1, 1]) mesh(boxG(0.22, 0.012, 0.012), glow(0x333333), s * 0.24, 1.9 + k * 0.03, 0.29, g).rotation.z = s * k * 0.15;
    }
    eyes(g, 0x2e7d32, 2.02, 0.285, 0.13, [0.1, 0.1]);
    mesh(boxG(0.07, 0.05, 0.02), glow(0xff8fab), 0, 1.92, 0.29, g);
  },
  alien(g) {
    const h = mesh(new THREE.SphereGeometry(0.34, 18, 14), std(0x7ee081), 0, 2.02, 0, g);
    h.scale.set(1, 1.2, 1);
    for (const s of [-1, 1]) {
      const e = mesh(new THREE.SphereGeometry(0.1, 12, 10), glow(0x0b0b10), s * 0.13, 2.04, 0.27, g);
      e.scale.set(0.9, 1.4, 0.5);
      e.rotation.z = s * 0.5;
      mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6), std(0x7ee081), s * 0.14, 2.45, 0, g).rotation.z = -s * 0.3;
      mesh(new THREE.SphereGeometry(0.05, 8, 6), glow(0xd4ff5c), s * 0.18, 2.58, 0, g);
    }
  },
  smiley(g) {
    mesh(new THREE.SphereGeometry(0.34, 20, 16), std(0xffd23f), 0, 1.98, 0, g);
    eyes(g, 0x1a1a1a, 2.05, 0.31, 0.11, [0.06, 0.12]);
    const smile = mesh(new THREE.TorusGeometry(0.14, 0.025, 8, 16, Math.PI), glow(0x1a1a1a), 0, 1.93, 0.3, g);
    smile.rotation.z = Math.PI;
  },
  knight(g, anim) {
    const steel = std(0xc9d1d9, { metalness: 0.7, roughness: 0.3 });
    mesh(boxG(0.64, 0.6, 0.6), steel, 0, 1.98, 0, g);
    mesh(boxG(0.5, 0.06, 0.02), glow(0x101318), 0, 2.02, 0.31, g);
    mesh(boxG(0.04, 0.3, 0.02), glow(0x101318), 0, 1.86, 0.31, g);
    const plume = new THREE.Group();
    plume.position.set(0, 2.3, -0.05);
    for (let i = 0; i < 4; i++) mesh(boxG(0.08, 0.3 - i * 0.04, 0.12), std(0xd62839), 0, 0.14 - i * 0.02, -i * 0.1, plume);
    g.add(plume);
    let t = 0;
    anim.push((dt, moving) => { t += dt; plume.rotation.x = (moving ? -0.25 : -0.08) + Math.sin(t * 8) * (moving ? 0.08 : 0.02); });
  },
};

// ------------------------------------------------------------------ backpacks (attach to the torso back, z < -0.23)
function wing(shapeFn, color, side, opacity = 1) {
  const s = new THREE.Shape();
  shapeFn(s);
  const geo = new THREE.ShapeGeometry(s);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6, transparent: opacity < 1, opacity }));
  m.scale.x = side;
  m.castShadow = true;
  return m;
}
const BACKS = {
  pack(g) {
    mesh(boxG(0.6, 0.62, 0.26), std(0x8d5a2b), 0, 1.28, -0.36, g);
    mesh(boxG(0.62, 0.22, 0.28), std(0x6e4420), 0, 1.53, -0.36, g);
    mesh(boxG(0.4, 0.2, 0.08), std(0x6e4420), 0, 1.1, -0.51, g);
    mesh(boxG(0.08, 0.06, 0.02), std(0xc9a35b, { metalness: 0.6 }), 0, 1.45, -0.51, g);
    for (const s of [-1, 1]) mesh(boxG(0.08, 0.7, 0.04), std(0x5a3818), s * 0.22, 1.3, 0.25, g);
  },
  jetpack(g, anim) {
    const metal = std(0x9aa5b1, { metalness: 0.7, roughness: 0.3 });
    const flames = [];
    for (const s of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.6, 14), metal, s * 0.16, 1.32, -0.38, g);
      mesh(new THREE.ConeGeometry(0.13, 0.12, 14), std(0xd62839), s * 0.16, 1.68, -0.38, g);
      mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.1, 12), std(0x444a55), s * 0.16, 0.98, -0.38, g);
      const f = mesh(new THREE.ConeGeometry(0.09, 0.4, 10), glow(0xff8a1f), s * 0.16, 0.73, -0.38, g);
      f.rotation.x = Math.PI;
      f.castShadow = false;
      flames.push(f);
    }
    mesh(boxG(0.3, 0.4, 0.1), metal, 0, 1.32, -0.28, g);
    let t = 0;
    anim.push((dt, moving, air) => {
      t += dt;
      for (const f of flames) {
        const k = air ? 1.4 : moving ? 0.8 : 0.45;
        f.scale.set(1, k * (0.85 + Math.sin(t * 40 + f.position.x * 9) * 0.15), 1);
        f.position.y = 0.93 - 0.2 * f.scale.y;
      }
    });
  },
  angelwings(g, anim) {
    const parts = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 1.45, -0.27);
      const w = wing((s) => { s.moveTo(0, 0); s.bezierCurveTo(0.4, 0.5, 0.9, 0.55, 1.1, 0.25); s.bezierCurveTo(0.8, 0.0, 0.7, -0.4, 0.45, -0.55); s.bezierCurveTo(0.3, -0.35, 0.1, -0.2, 0, 0); }, 0xffffff, side);
      pivot.add(w);
      pivot.rotation.y = side * 0.5;
      g.add(pivot);
      parts.push([pivot, side]);
    }
    let t = 0;
    anim.push((dt, moving, air) => { t += dt; for (const [p, s] of parts) p.rotation.y = s * (0.5 + Math.sin(t * (air ? 12 : 3)) * (air ? 0.45 : 0.12)); });
  },
  dragonwings(g, anim) {
    const parts = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 1.5, -0.27);
      const w = wing((s) => { s.moveTo(0, 0); s.lineTo(1.25, 0.45); s.lineTo(1.05, -0.05); s.lineTo(0.85, -0.3); s.lineTo(0.6, -0.15); s.lineTo(0.4, -0.45); s.lineTo(0.2, -0.2); s.lineTo(0, 0); }, 0x7b2cbf, side, 0.95);
      pivot.add(w);
      const bone = mesh(boxG(1.3, 0.05, 0.05), std(0x3c096c), side * 0.62, 0.22, 0.01, pivot);
      bone.rotation.z = side * 0.35;
      pivot.rotation.y = side * 0.55;
      g.add(pivot);
      parts.push([pivot, side]);
    }
    let t = 0;
    anim.push((dt, moving, air) => { t += dt; for (const [p, s] of parts) p.rotation.y = s * (0.55 + Math.sin(t * (air ? 9 : 2.5)) * (air ? 0.5 : 0.1)); });
  },
  shell(g) {
    const sh = mesh(new THREE.SphereGeometry(0.42, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0x3a7d44), 0, 1.25, -0.24, g);
    sh.rotation.x = -Math.PI / 2;
    sh.scale.set(1, 1.15, 0.7);
    for (const [x, y] of [[0, 1.25], [-0.17, 1.42], [0.17, 1.42], [-0.17, 1.08], [0.17, 1.08]]) {
      const p = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 6), std(0x9ccc65), x, y, -0.5, g);
      p.rotation.x = Math.PI / 2;
    }
  },
  cape(g, anim) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.64, -0.25);
    const cloth = mesh(boxG(0.8, 1.3, 0.03), std(0xd62839, { side: THREE.DoubleSide }), 0, -0.65, 0, pivot);
    mesh(boxG(0.82, 0.06, 0.05), std(0xffc83d, { metalness: 0.5 }), 0, 0, 0.01, pivot);
    cloth.castShadow = true;
    g.add(pivot);
    let t = 0;
    anim.push((dt, moving, air) => { t += dt; pivot.rotation.x = -((air ? 0.9 : moving ? 0.45 : 0.08) + Math.sin(t * 9) * (moving || air ? 0.06 : 0.02)); });
  },
};

// ------------------------------------------------------------------ shoes (one per leg; leg pivots sit at the hip)
const SHOES = {
  sneakers(leg) {
    mesh(boxG(0.38, 0.16, 0.48), std(0xe63946), 0, -0.83, 0.04, leg);
    mesh(boxG(0.4, 0.05, 0.5), std(0xffffff), 0, -0.9, 0.04, leg);
    mesh(boxG(0.3, 0.03, 0.1), std(0xffffff), 0, -0.76, 0.2, leg);
  },
  cowboy(leg) {
    mesh(boxG(0.38, 0.42, 0.4), std(0x8b5a2b), 0, -0.72, 0, leg);
    mesh(boxG(0.38, 0.12, 0.5), std(0x6e4420), 0, -0.86, 0.06, leg);
    mesh(boxG(0.2, 0.08, 0.12), std(0x3d2614), 0, -0.9, -0.15, leg);
    mesh(boxG(0.39, 0.04, 0.41), std(0xc9a35b, { metalness: 0.5 }), 0, -0.6, 0, leg);
  },
  golden(leg) {
    mesh(boxG(0.4, 0.2, 0.5), std(0xffc83d, { metalness: 0.75, roughness: 0.25, emissive: 0x5a3d00, emissiveIntensity: 0.3 }), 0, -0.82, 0.04, leg);
  },
  rainbow(leg) {
    const cols = [0xff5d5d, 0xffd23f, 0x3bceac, 0x3a86ff, 0x8338ec];
    cols.forEach((c, i) => mesh(boxG(0.38, 0.035, 0.48), std(c), 0, -0.9 + i * 0.035, 0.04, leg));
  },
  rocket(leg, anim) {
    mesh(boxG(0.38, 0.2, 0.46), std(0x9aa5b1, { metalness: 0.7, roughness: 0.3 }), 0, -0.8, 0.03, leg);
    mesh(boxG(0.39, 0.05, 0.47), std(0xd62839), 0, -0.74, 0.03, leg);
    const f = mesh(new THREE.ConeGeometry(0.11, 0.3, 10), glow(0xff8a1f), 0, -1.05, -0.08, leg);
    f.rotation.x = Math.PI;
    f.castShadow = false;
    let t = 0;
    anim.push((dt, moving, air) => { t += dt; f.visible = air || moving; f.scale.y = (air ? 1.5 : 0.7) * (0.85 + Math.sin(t * 45) * 0.15); });
  },
  skates(leg) {
    mesh(boxG(0.36, 0.3, 0.44), std(0xf1f5f9), 0, -0.78, 0.03, leg);
    mesh(boxG(0.04, 0.06, 0.56), std(0xd0d7de, { metalness: 0.9, roughness: 0.2 }), 0, -0.95, 0.04, leg);
  },
};

// outfit: { hat, head, back, shoes } item ids (or null)
export function buildAvatar(color, outfit = {}) {
  const g = new THREE.Group();
  const anim = [];
  const body = std(color), skin = std(0xffd9b3), dark = std(0x2b2f3a), shoe = std(0x1e2230);
  const pivot = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); g.add(p); return p; };
  const legL = pivot(-0.2, 0.9), legR = pivot(0.2, 0.9);
  for (const leg of [legL, legR]) {
    mesh(boxG(0.34, 0.8, 0.38), dark, 0, -0.4, 0, leg);
    if (outfit.shoes && SHOES[outfit.shoes]) SHOES[outfit.shoes](leg, anim);
    else mesh(boxG(0.36, 0.14, 0.44), shoe, 0, -0.84, 0.03, leg);
  }
  mesh(boxG(0.82, 0.78, 0.46), body, 0, 1.28, 0, g);
  const armL = pivot(-0.56, 1.6), armR = pivot(0.56, 1.6);
  for (const arm of [armL, armR]) {
    mesh(boxG(0.26, 0.74, 0.3), body, 0, -0.34, 0, arm);
    mesh(boxG(0.24, 0.16, 0.28), skin, 0, -0.76, 0, arm);
  }
  if (outfit.head && HEADS[outfit.head]) HEADS[outfit.head](g, anim);
  else {
    mesh(boxG(0.6, 0.56, 0.56), skin, 0, 1.97, 0, g);
    eyes(g);
    mesh(boxG(0.2, 0.04, 0.02), glow(0x1a1a1a), 0, 1.86, 0.29, g);
  }
  if (outfit.hat && HATS[outfit.hat]) HATS[outfit.hat](g, anim);
  if (outfit.back && BACKS[outfit.back]) BACKS[outfit.back](g, anim);
  g.userData.limbs = { legL, legR, armL, armR };
  g.userData.animate = (dt, moving = false, air = false) => { for (const fn of anim) fn(dt, moving, air); };
  return g;
}

export { THREE };
