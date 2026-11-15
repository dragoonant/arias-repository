// Ariabux: one wallet shared by every game on this site.
// It lives in this browser's localStorage, so all games (same site) see the same balance,
// and other open tabs update when it changes.

export const BUX_NAME = 'Ariabux'; // change this to rename the currency everywhere
export const DAILY_BONUS = 25;
const KEY = 'ariabux_v1';
const START_BALANCE = 250;

// The catalog. `slot` decides where it goes; one item per slot.
// Avatar items for your hopper (bought in the Avatar Shop on the Ariabux page, worn in Hopscape).
export const AVATAR_ITEMS = [
  { id: 'cone', slot: 'hat', name: 'Party Cone', price: 60, desc: 'Every jump is a celebration.' },
  { id: 'propeller', slot: 'hat', name: 'Propeller Cap', price: 150, desc: 'Spins faster when you run.' },
  { id: 'tophat', slot: 'hat', name: 'Top Hat', price: 120, desc: 'Fancy footwork deserves a fancy hat.' },
  { id: 'wizard', slot: 'hat', name: 'Wizard Hat', price: 220, desc: 'Starry and very tall.' },
  { id: 'halo', slot: 'hat', name: 'Halo', price: 260, desc: 'Floats and glows a little.' },
  { id: 'crown', slot: 'hat', name: 'Golden Crown', price: 400, desc: 'For the ruler of every obby.' },

  { id: 'smiley', slot: 'head', name: 'Smiley Head', price: 60, desc: 'Always happy, even after falling.' },
  { id: 'pumpkin', slot: 'head', name: 'Pumpkin Head', price: 150, desc: 'Carved and ready for spooky season.' },
  { id: 'cat', slot: 'head', name: 'Cat Head', price: 180, desc: 'Ears, whiskers and a pink nose.' },
  { id: 'robot', slot: 'head', name: 'Robot Head', price: 200, desc: 'Glowing visor and a blinking antenna.' },
  { id: 'alien', slot: 'head', name: 'Alien Head', price: 220, desc: 'Big eyes. Came in peace.' },
  { id: 'knight', slot: 'head', name: 'Knight Helmet', price: 260, desc: 'Steel helm with a red plume that sways.' },

  { id: 'pack', slot: 'back', name: 'Explorer Pack', price: 80, desc: 'Room for snacks and spare hats.' },
  { id: 'cape', slot: 'back', name: 'Hero Cape', price: 120, desc: 'Flows behind you when you run and jump.' },
  { id: 'shell', slot: 'back', name: 'Turtle Shell', price: 160, desc: 'Slow and steady. Mostly steady.' },
  { id: 'jetpack', slot: 'back', name: 'Jetpack', price: 300, desc: 'Flames roar when you jump. (Looks only.)' },
  { id: 'angelwings', slot: 'back', name: 'Angel Wings', price: 350, desc: 'Feathered wings that flap mid-air.' },
  { id: 'dragonwings', slot: 'back', name: 'Dragon Wings', price: 450, desc: 'Purple bat-style wings for big leaps.' },

  { id: 'sneakers', slot: 'shoes', name: 'Red Sneakers', price: 40, desc: 'Classic kicks with white soles.' },
  { id: 'cowboy', slot: 'shoes', name: 'Cowboy Boots', price: 90, desc: 'Tall boots with a little gold trim.' },
  { id: 'rainbow', slot: 'shoes', name: 'Rainbow Kicks', price: 120, desc: 'Five colors stacked up.' },
  { id: 'skates', slot: 'shoes', name: 'Ice Skates', price: 140, desc: 'Perfect for Frost Summit. (Looks only.)' },
  { id: 'rocket', slot: 'shoes', name: 'Rocket Boots', price: 250, desc: 'Little flames when you move.' },
  { id: 'golden', slot: 'shoes', name: 'Golden Boots', price: 300, desc: 'Shiny, heavy, fabulous.' },
];
export const SLOTS = [
  { id: 'hat', name: 'Hats' },
  { id: 'head', name: 'Heads' },
  { id: 'back', name: 'Backpacks' },
  { id: 'shoes', name: 'Shoes' },
];
export const BODY_COLORS = ['#ff5d5d', '#ff9f1c', '#ffd23f', '#3bceac', '#3a86ff', '#8338ec', '#ff70a6', '#f5f5f5'];

export const HATS = AVATAR_ITEMS.filter((i) => i.slot === 'hat');

function fresh() {
  return { balance: START_BALANCE, history: [], owned: {}, equipped: {}, daily: null, migrated: {} };
}
function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.balance === 'number') return { ...fresh(), ...s };
  } catch { /* storage blocked or corrupt */ }
  return fresh();
}

let S = read();
const listeners = new Set();
function write() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* storage blocked: balance lasts this visit only */ }
  for (const fn of listeners) fn(S.balance);
}
function log(amount, reason, game) {
  S.history.unshift({ amount, reason, game, at: Date.now() });
  if (S.history.length > 40) S.history.length = 40;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export const Bux = {
  balance: () => S.balance,
  history: () => S.history.slice(),
  earn(amount, reason, game) {
    amount = Math.round(amount);
    if (!(amount > 0)) return 0;
    S.balance += amount;
    log(amount, reason, game);
    write();
    return amount;
  },
  spend(amount, reason, game) {
    amount = Math.round(amount);
    if (amount < 0 || S.balance < amount) return false;
    S.balance -= amount;
    log(-amount, reason, game);
    write();
    return true;
  },
  // For games that keep a plain number (StrikeZone): set the new total and log the difference.
  set(value, game) {
    const diff = Math.round(value) - S.balance;
    if (!diff) return;
    S.balance += diff;
    log(diff, diff > 0 ? `Earned in ${game}` : `Spent in ${game}`, game);
    write();
  },
  owns: (id) => !!S.owned[id],
  buy(id, price, name, game) {
    if (S.owned[id]) return true;
    if (!Bux.spend(price, `Bought ${name}`, game)) return false;
    S.owned[id] = true;
    write();
    return true;
  },
  equipped: (slot) => S.equipped[slot] || null,
  equip(slot, id) {
    S.equipped[slot] = id;
    write();
  },
  // What the hopper is wearing: { hat, head, back, shoes } (only items you own).
  outfit() {
    const o = {};
    for (const slot of SLOTS) {
      const id = S.equipped[slot.id];
      o[slot.id] = id && S.owned[id] ? id : null;
    }
    return o;
  },
  bodyColor: (fallback) => S.equipped.color || fallback,
  canClaimDaily: () => S.daily !== today(),
  claimDaily() {
    if (!Bux.canClaimDaily()) return 0;
    S.daily = today();
    return Bux.earn(DAILY_BONUS, 'Daily bonus', 'Ariabux');
  },
  // Move an older per-game balance into Ariabux, once.
  migrateOnce(key, amount, reason, game) {
    if (S.migrated[key]) return;
    S.migrated[key] = true;
    if (amount > 0) Bux.earn(amount, reason, game);
    else write();
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// Another tab changed the wallet: pick it up.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  S = read();
  for (const fn of listeners) fn(S.balance);
});

// ------------------------------------------------------------------ small UI helpers
export const BUX_ICON = `<svg class="bux-ico" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="buxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dffd4"/><stop offset="1" stop-color="#11a77a"/></linearGradient></defs><circle cx="12" cy="12" r="11" fill="url(#buxg)" stroke="#0b7a58" stroke-width="1.5"/><path d="M12 4.5 L13.6 10.4 L19.5 12 L13.6 13.6 L12 19.5 L10.4 13.6 L4.5 12 L10.4 10.4 Z" fill="#ffffff"/></svg>`;

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
    .bux-ico { width: 1em; height: 1em; vertical-align: -0.14em; flex: none; }
    #bux-toasts { position: fixed; left: max(14px, env(safe-area-inset-left)); bottom: max(14px, env(safe-area-inset-bottom)); z-index: 99; display: grid; gap: 6px; pointer-events: none; }
    .bux-toast { display: flex; align-items: center; gap: 8px; background: rgba(10,40,32,0.92); color: #eafff7; border: 1px solid #2fd6a0; border-radius: 12px;
      padding: 8px 14px; font: 700 15px/1.3 system-ui, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,0.3); animation: buxin 3.2s ease forwards; }
    .bux-toast b { color: #7dffd4; font-size: 17px; }
    @keyframes buxin { 0% { opacity: 0; transform: translateY(10px); } 8%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .bux-toast { animation-duration: 3.2s; animation-name: buxfade; } @keyframes buxfade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } } }
  `;
  document.head.appendChild(st);
}
injectStyle();

// "+50 Ariabux · Quest complete" in the corner.
export function buxToast(amount, reason) {
  if (!amount) return;
  let host = document.getElementById('bux-toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'bux-toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'bux-toast';
  el.innerHTML = `${BUX_ICON}<b>${amount > 0 ? '+' : ''}${amount}</b><span></span>`;
  el.querySelector('span').textContent = `${BUX_NAME} · ${reason}`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3300);
}
