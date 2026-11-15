// Ariabux: one wallet shared by every game on this site.
// It lives in this browser's localStorage, so all games (same site) see the same balance,
// and other open tabs update when it changes.

export const BUX_NAME = 'Ariabux'; // change this to rename the currency everywhere
export const DAILY_BONUS = 25;
const KEY = 'ariabux_v1';
const START_BALANCE = 250;

// Hats for your Hopscape hopper, bought on the Ariabux page.
export const HATS = [
  { id: 'cone', name: 'Party Cone', price: 60, desc: 'Every jump is a celebration.' },
  { id: 'propeller', name: 'Propeller Cap', price: 150, desc: 'The propeller spins while you run.' },
  { id: 'tophat', name: 'Top Hat', price: 120, desc: 'Fancy footwork deserves a fancy hat.' },
  { id: 'wizard', name: 'Wizard Hat', price: 220, desc: 'Starry and very tall.' },
  { id: 'halo', name: 'Halo', price: 260, desc: 'For flawless runs. Glows a little.' },
  { id: 'crown', name: 'Golden Crown', price: 400, desc: 'For the ruler of every obby.' },
];

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
