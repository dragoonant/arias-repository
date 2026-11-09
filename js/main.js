// Menus, friends list, online lobby and match lifecycle.

import { Net } from './net.js';
import { Game } from './game.js';
import { ROLES, ROLE_ORDER, roleStats } from './roles.js';
import { MAPS, MAP_ORDER } from './maps.js';
import { SHOP, COINS, newWallet } from './weapons.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- storage
function load(key, fallback) {
  try {
    const v = localStorage.getItem('sz_' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem('sz_' + key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

const state = {
  name: load('name', 'Player' + Math.floor(100 + Math.random() * 900)),
  role: load('role', 'assault'),
  friends: load('friends', []),
  sens: load('sens', 2.2),
  vol: load('vol', 0.5),
  settings: load('settings', { map: 'rustyard', mode: 'ffa', bots: 5, killLimit: 20, timeLimit: 8, difficulty: 'normal' }),
  online: false, // are we in the online lobby flow?
  room: null,
  game: null,
  presence: new Map(),
  pendingInvite: null,
  lastResultsOnline: false,
};

// Coins, unlocks and supplies live in this browser and carry over between matches.
state.wallet = Object.assign(newWallet(), load('wallet', {}));
if (!state.wallet.owned || typeof state.wallet.owned !== 'object') state.wallet.owned = {};
function saveWallet() {
  save('wallet', state.wallet);
  renderCoins();
}
function renderCoins() {
  for (const el of document.querySelectorAll('.coins-total')) el.textContent = state.wallet.coins.toLocaleString();
}

const net = new Net();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 'screen-' + id;
}
function hideScreens() {
  for (const s of document.querySelectorAll('.screen')) s.hidden = true;
}

// ---------------------------------------------------------------- home
const nameInput = $('name-input');
nameInput.value = state.name;
let helloTimer;
nameInput.addEventListener('input', () => {
  state.name = nameInput.value.replace(/[^\w \-]/g, '').slice(0, 16);
  save('name', state.name);
  clearTimeout(helloTimer);
  helloTimer = setTimeout(sendHello, 400);
});

function sendHello() {
  net.send({ t: 'hello', name: state.name || 'Player', role: state.role });
}

const sensInput = $('sens-input'), volInput = $('vol-input');
sensInput.value = state.sens;
volInput.value = state.vol;
const showSettings = () => {
  $('sens-val').textContent = Number(state.sens).toFixed(1);
  $('vol-val').textContent = Math.round(state.vol * 100) + '%';
};
showSettings();
sensInput.addEventListener('input', () => { state.sens = +sensInput.value; save('sens', state.sens); showSettings(); });
volInput.addEventListener('input', () => { state.vol = +volInput.value; save('vol', state.vol); showSettings(); });

$('btn-solo').addEventListener('click', () => {
  state.online = false;
  if (net.connected && state.room) net.send({ t: 'leave' });
  state.room = null;
  openSetup();
});

$('btn-friends').addEventListener('click', async () => {
  $('home-error').textContent = '';
  if (!state.name.trim()) {
    $('home-error').textContent = 'Enter a callsign first so friends can find you.';
    nameInput.focus();
    return;
  }
  if (!net.connected) {
    setServerStatus('busy', 'Connecting…');
    const ok = await net.connect();
    if (!ok) {
      setServerStatus('', 'No game server found');
      $('home-error').textContent = 'Online play needs the game server running. Start it with "npm start" (see README), then open the address it prints.';
      return;
    }
    onConnected();
  }
  $('online-error').textContent = '';
  show('online');
});

for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => show(b.dataset.back));
}

// ---------------------------------------------------------------- server status / friends
function setServerStatus(cls, text) {
  $('server-dot').className = 'dot ' + (cls || '');
  $('server-text').textContent = text;
}

function onConnected() {
  setServerStatus('on', 'Game server online · friends can join you');
  sendHello();
  pollPresence();
}

function pollPresence() {
  if (net.connected && state.friends.length) net.send({ t: 'presence', names: state.friends });
}
setInterval(pollPresence, 4000);

function renderFriends() {
  const list = $('friend-list');
  list.innerHTML = '';
  $('friends-count').textContent = state.friends.length ? `${state.friends.length} added` : '';
  if (!state.friends.length) {
    list.innerHTML = '<li class="empty">No friends yet. Add their callsign above.</li>';
  }
  for (const f of state.friends) {
    const p = state.presence.get(f.toLowerCase());
    const li = document.createElement('li');
    li.className = 'friend';
    li.innerHTML = `<span class="dot ${p ? (p.inRoom ? 'busy' : 'on') : ''}"></span><span class="name"></span><span class="status">${!net.connected ? '' : p ? (p.inRoom ? 'In a room' : 'Online') : 'Offline'}</span><button class="icon-btn" title="Remove friend" aria-label="Remove friend">×</button>`;
    li.querySelector('.name').textContent = f;
    li.querySelector('button').addEventListener('click', () => {
      state.friends = state.friends.filter((x) => x !== f);
      save('friends', state.friends);
      renderFriends();
      renderInviteList();
    });
    list.appendChild(li);
  }
  renderInviteList();
}

$('add-friend-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('friend-input').value.replace(/[^\w \-]/g, '').trim().slice(0, 16);
  if (!v) return;
  if (v.toLowerCase() === state.name.toLowerCase()) {
    $('friend-input').value = '';
    return;
  }
  if (!state.friends.some((f) => f.toLowerCase() === v.toLowerCase())) {
    state.friends.push(v);
    save('friends', state.friends);
  }
  $('friend-input').value = '';
  renderFriends();
  pollPresence();
});

function renderInviteList() {
  const list = $('invite-list');
  if (!list) return;
  list.innerHTML = '';
  if (!state.friends.length) {
    list.innerHTML = '<li class="empty">Add friends on the main menu, or share the room code.</li>';
    return;
  }
  for (const f of state.friends) {
    const p = state.presence.get(f.toLowerCase());
    const inThisRoom = state.room?.players.some((pl) => pl.name.toLowerCase() === f.toLowerCase());
    const li = document.createElement('li');
    li.className = 'friend';
    li.innerHTML = `<span class="dot ${p ? 'on' : ''}"></span><span class="name"></span><button class="btn small-btn">${inThisRoom ? 'Here' : 'Invite'}</button>`;
    li.querySelector('.name').textContent = f;
    const btn = li.querySelector('button');
    btn.disabled = !p || inThisRoom;
    btn.addEventListener('click', () => {
      net.send({ t: 'invite', name: f });
      btn.textContent = 'Sent';
      btn.disabled = true;
    });
    list.appendChild(li);
  }
}

net.on('presence', (msg) => {
  state.presence = new Map(msg.online.map((p) => [p.name.toLowerCase(), p]));
  renderFriends();
});

net.on('invite', (msg) => {
  if (state.game) return; // don't interrupt a match
  state.pendingInvite = msg.code;
  $('invite-text').textContent = `${msg.from} invited you to room ${msg.code}`;
  $('invite-toast').hidden = false;
});
$('invite-dismiss').addEventListener('click', () => { $('invite-toast').hidden = true; });
$('invite-join').addEventListener('click', () => {
  $('invite-toast').hidden = true;
  if (state.pendingInvite) {
    state.online = true;
    net.send({ t: 'join', code: state.pendingInvite });
  }
});

net.on('inviteResult', (msg) => {
  if (!msg.ok) addChat('System', `${msg.name} is not online right now.`);
});

net.on('disconnect', () => {
  setServerStatus('', 'Disconnected from game server');
  state.presence.clear();
  renderFriends();
  if (state.online) {
    if (state.game) {
      state.game.destroy();
      state.game = null;
    }
    state.online = false;
    state.room = null;
    show('home');
    $('home-error').textContent = 'Lost connection to the game server.';
  }
});

// ---------------------------------------------------------------- online entry
$('btn-create').addEventListener('click', () => {
  state.online = true;
  net.send({ t: 'setRole', role: state.role });
  net.send({ t: 'create', settings: state.settings });
});
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code-input').value.trim().toUpperCase();
  if (code.length < 4) {
    $('online-error').textContent = 'Room codes are 5 letters or numbers.';
    return;
  }
  state.online = true;
  net.send({ t: 'setRole', role: state.role });
  net.send({ t: 'join', code });
});
net.on('error', (msg) => {
  $('online-error').textContent = msg.message;
  if (!state.room) state.online = false;
});

net.on('room', (msg) => {
  const firstTime = !state.room || state.room.code !== msg.room.code;
  state.room = msg.room;
  state.online = true;
  if (state.game) {
    const others = msg.room.players.filter((p) => p.id !== net.id);
    state.game.updateRoster(others, msg.room.hostId);
    return;
  }
  if (firstTime) {
    $('chat-log').innerHTML = '';
    addChat('System', `You joined room ${msg.room.code}.`);
  }
  if (!state.inResults) openSetup();
});

net.on('left', (msg) => {
  if (state.game) state.game.setHost(msg.hostId);
});

net.on('chat', (msg) => addChat(msg.from, msg.text));

function addChat(from, text) {
  const log = $('chat-log');
  const line = document.createElement('div');
  line.innerHTML = '<b></b> <span></span>';
  line.querySelector('b').textContent = from + ':';
  line.querySelector('span').textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('chat-input').value.trim();
  if (!v) return;
  net.send({ t: 'chat', text: v });
  $('chat-input').value = '';
});

// ---------------------------------------------------------------- setup / lobby
function isHost() {
  return !state.online || (state.room && state.room.hostId === net.id);
}

function currentSettings() {
  return state.online && state.room ? state.room.settings : state.settings;
}

function mapPreviewSVG(map) {
  const [sky, a, b, ground] = map.preview;
  // deterministic little skyline from the map id
  let seed = [...map.id].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let blocks = '';
  let x = 6;
  while (x < 160) {
    const w = 10 + r() * 26, h = 12 + r() * (map.id === 'neon' ? 46 : 26);
    blocks += `<rect x="${x.toFixed(1)}" y="${(56 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${r() < 0.5 ? a : b}" opacity="${(0.75 + r() * 0.25).toFixed(2)}"/>`;
    x += w + 4 + r() * 10;
  }
  return `<svg viewBox="0 0 160 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="160" height="80" fill="${sky}"/>${blocks}<rect y="56" width="160" height="24" fill="${ground}"/><rect y="56" width="160" height="1.5" fill="#000" opacity=".2"/></svg>`;
}

function renderRoles() {
  const grid = $('role-grid');
  grid.innerHTML = '';
  for (const id of ROLE_ORDER) {
    const R = ROLES[id];
    const st = roleStats(R);
    const btn = document.createElement('button');
    btn.className = 'role-card' + (state.role === id ? ' selected' : '');
    btn.setAttribute('aria-pressed', state.role === id);
    const hex = '#' + R.color.toString(16).padStart(6, '0');
    btn.innerHTML = `
      <div class="role-head"><span class="role-glyph" style="background:${hex}">${R.name[0]}</span><div><h4>${R.name}</h4><div class="tag">${R.tagline}</div></div></div>
      <div class="weapon-line">${R.weapon.name}</div>
      <div class="stats">${Object.entries(st).map(([k, v]) => `<div class="stat">${k}<span class="bar"><i style="width:${Math.max(1, v) * 10}%; background:${hex}"></i></span></div>`).join('')}</div>
      <div class="ability"><b>${R.ability.name}</b> · ${R.ability.desc}</div>`;
    btn.title = R.lore;
    btn.addEventListener('click', () => {
      state.role = id;
      save('role', id);
      if (state.online) net.send({ t: 'setRole', role: id });
      renderRoles();
    });
    grid.appendChild(btn);
  }
}

function renderMaps() {
  const grid = $('map-grid');
  grid.innerHTML = '';
  const s = currentSettings();
  const host = isHost();
  $('map-hint').textContent = host ? 'Everyone plays on the map you pick' : 'The host picks the map';
  for (const id of MAP_ORDER) {
    const M = MAPS[id];
    const btn = document.createElement('button');
    btn.className = 'map-card' + (s.map === id ? ' selected' : '');
    btn.disabled = !host;
    btn.setAttribute('aria-pressed', s.map === id);
    btn.innerHTML = `${mapPreviewSVG(M)}<div class="map-body"><h4>${M.name}</h4><p>${M.desc}</p></div>`;
    btn.addEventListener('click', () => updateSettings({ map: id }));
    grid.appendChild(btn);
  }
}

function updateSettings(patch) {
  if (!isHost()) return;
  if (state.online) {
    net.send({ t: 'settings', settings: patch });
  } else {
    Object.assign(state.settings, patch);
    save('settings', state.settings);
    renderSetup();
  }
}

function renderRules() {
  const s = currentSettings();
  const host = isHost();
  for (const b of $('mode-seg').children) {
    b.classList.toggle('on', b.dataset.mode === s.mode);
    b.disabled = !host;
  }
  for (const b of $('diff-seg').children) {
    b.classList.toggle('on', b.dataset.diff === s.difficulty);
    b.disabled = !host;
  }
  const setRange = (id, valId, v, label) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
    el.disabled = !host;
    $(valId).textContent = label;
  };
  setRange('bots-input', 'bots-val', s.bots, s.bots === 0 ? 'none' : s.bots);
  setRange('kills-input', 'kills-val', s.killLimit, s.mode === 'tdm' ? `${s.killLimit} per team` : s.killLimit);
  setRange('time-input', 'time-val', s.timeLimit, s.timeLimit + ' min');
}

for (const b of $('mode-seg').children) b.addEventListener('click', () => updateSettings({ mode: b.dataset.mode }));
for (const b of $('diff-seg').children) b.addEventListener('click', () => updateSettings({ difficulty: b.dataset.diff }));
const rangeBind = (id, key) => {
  const el = $(id);
  el.addEventListener('input', () => {
    if (!state.online) updateSettings({ [key]: +el.value });
    else renderRulesPreview(key, +el.value);
  });
  el.addEventListener('change', () => { if (state.online) updateSettings({ [key]: +el.value }); });
};
function renderRulesPreview(key, v) {
  if (key === 'bots') $('bots-val').textContent = v === 0 ? 'none' : v;
  if (key === 'killLimit') $('kills-val').textContent = v;
  if (key === 'timeLimit') $('time-val').textContent = v + ' min';
}
rangeBind('bots-input', 'bots');
rangeBind('kills-input', 'killLimit');
rangeBind('time-input', 'timeLimit');

function renderLobby() {
  const room = state.room;
  const extra = $('lobby-extra');
  extra.hidden = !state.online || !room;
  $('room-code').hidden = $('copy-code').hidden = !state.online || !room;
  if (!state.online || !room) return;
  $('room-code').textContent = room.code;
  const list = $('player-list');
  list.innerHTML = '';
  const tdm = room.settings.mode === 'tdm';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.className = tdm ? 'team-' + p.team : '';
    li.innerHTML = `<span class="pname"></span><span class="badge">${ROLES[p.role]?.name || ''}</span>${p.id === room.hostId ? '<span class="badge host">Host</span>' : ''}`;
    li.querySelector('.pname').textContent = p.name + (p.id === net.id ? ' (you)' : '');
    list.appendChild(li);
  }
  $('player-count').textContent = `${room.players.length} / 12`;
  $('team-pick').hidden = !tdm;
  const me = room.players.find((p) => p.id === net.id);
  for (const b of $('team-seg').children) b.classList.toggle('on', me && b.dataset.team === me.team);
  renderInviteList();
}
for (const b of $('team-seg').children) b.addEventListener('click', () => net.send({ t: 'setTeam', team: b.dataset.team }));

$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.room.code);
    $('copy-code').textContent = 'Copied';
  } catch {
    $('copy-code').textContent = state.room.code;
  }
  setTimeout(() => { $('copy-code').textContent = 'Copy code'; }, 1500);
});

function renderSetup() {
  $('setup-title').textContent = state.online ? 'Room lobby' : 'Solo vs bots';
  renderRoles();
  renderMaps();
  renderRules();
  renderLobby();
  const host = isHost();
  $('btn-start').hidden = !host;
  $('start-hint').textContent = host
    ? state.online ? 'Friends can still join after the match starts.' : ''
    : 'Waiting for the host to start the match…';
}

function openSetup() {
  state.inResults = false;
  renderSetup();
  show('setup');
}

$('setup-back').addEventListener('click', () => {
  if (state.online) {
    net.send({ t: 'leave' });
    state.room = null;
    state.online = false;
    show('online');
  } else {
    show('home');
  }
});

$('btn-start').addEventListener('click', () => {
  if (state.online) net.send({ t: 'start' });
  else startOffline();
});

// ---------------------------------------------------------------- matches
function commonGameOpts() {
  return {
    container: $('game-root'),
    sensitivity: state.sens / 1000,
    wallet: state.wallet,
    onWalletChange: saveWallet,
    onOpenShop: openShop,
  };
}

function startOffline() {
  hideScreens();
  const s = state.settings;
  state.game = new Game({
    ...commonGameOpts(),
    mapId: s.map,
    mode: s.mode,
    settings: { ...s },
    me: { id: 'me', name: state.name || 'You', role: state.role, team: 'red' },
    roster: [],
    net: null,
    onEnd: (results) => endMatch(results, false),
  });
  state.game.sfx.volume = state.vol;
}

net.on('start', (msg) => {
  state.room = msg.room;
  if (state.game) return;
  $('invite-toast').hidden = true;
  hideScreens();
  const me = msg.room.players.find((p) => p.id === net.id) || { role: state.role, team: 'red' };
  state.game = new Game({
    ...commonGameOpts(),
    mapId: msg.room.settings.map,
    mode: msg.room.settings.mode,
    settings: { ...msg.room.settings },
    me: { id: net.id, name: state.name || 'Player', role: me.role, team: me.team },
    roster: msg.room.players.filter((p) => p.id !== net.id),
    net,
    hostId: msg.room.hostId,
  });
  state.game.sfx.volume = state.vol;
});

net.on('relay', (msg) => {
  if (state.game) state.game.handleRelay(msg.from, msg.data);
});

net.on('end', (msg) => {
  if (state.game && msg.results) endMatch(msg.results, true);
  else if (state.game) {
    state.game.destroy();
    state.game = null;
    openSetup();
  }
});

function endMatch(results, online) {
  const earned = state.game ? state.game.coinsEarned : 0;
  $('results-coins').innerHTML = earned > 0
    ? `<span class="coin"></span>+${earned.toLocaleString()} coins earned · ${state.wallet.coins.toLocaleString()} total`
    : '';
  if (state.game) {
    state.game.destroy();
    state.game = null;
  }
  state.lastResultsOnline = online;
  state.inResults = true;
  $('results-winner').textContent = results.winner === 'Draw' ? 'Draw' : `${results.winner} wins`;
  $('results-sub').textContent = `${results.map} · ${results.mode === 'tdm' ? 'Team battle' : 'Free-for-all'}`;
  $('results-detail').textContent = results.teamScores ? `Red ${results.teamScores.red} – ${results.teamScores.blue} Blue` : '';
  const myId = online ? String(net.id) : 'me';
  const rows = results.rows.map((p) => `<tr class="${p.id === myId ? 'me' : ''}"><td>${escapeHtml(p.name)}${p.bot ? ' <small>BOT</small>' : ''}${p.team ? ` <small style="color:var(--${p.team})">${p.team.toUpperCase()}</small>` : ''}</td><td>${ROLES[p.role]?.name || ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`).join('');
  $('results-table').innerHTML = `<table><tr><th>Player</th><th>Role</th><th>Kills</th><th>Deaths</th></tr>${rows}</table>`;
  $('btn-again').textContent = online ? 'Back to lobby' : 'Play again';
  show('results');
}

$('btn-again').addEventListener('click', () => {
  state.inResults = false;
  if (state.lastResultsOnline && state.room) openSetup();
  else if (state.lastResultsOnline) show('online');
  else openSetup();
});
$('btn-menu').addEventListener('click', () => {
  state.inResults = false;
  if (state.online) {
    net.send({ t: 'leave' });
    state.room = null;
    state.online = false;
  }
  show('home');
});

$('leave-btn').addEventListener('click', () => {
  if (state.game) {
    state.game.destroy();
    state.game = null;
  }
  $('pause-overlay').hidden = true;
  if (state.online) {
    net.send({ t: 'leave' });
    state.room = null;
    state.online = false;
  }
  show('home');
});

// Touch devices have no Esc key: a menu button opens the pause card.
const touchMenu = document.createElement('button');
touchMenu.id = 'touch-menu';
touchMenu.textContent = 'MENU';
$('touch-controls').appendChild(touchMenu);
touchMenu.addEventListener('click', () => { $('pause-overlay').hidden = false; });
$('resume-btn').addEventListener('click', () => {
  if (matchMedia('(pointer: coarse)').matches) $('pause-overlay').hidden = true;
});

// ---------------------------------------------------------------- armory (shop)
function shopState(item) {
  const w = state.wallet;
  if (item.kind === 'supply') {
    const have = w[item.id] | 0;
    if (have >= item.max) return { label: `Full (${have}/${item.max})`, disabled: true, have };
    return { label: `Buy · ${item.price}`, disabled: w.coins < item.price, buy: true, have };
  }
  const owned = item.price === 0 || !!w.owned[item.id];
  if (item.kind === 'melee' && owned) {
    return w.melee === item.id ? { label: 'Equipped', disabled: true, owned, equipped: true } : { label: 'Equip', equip: true, owned };
  }
  if (owned) return { label: 'Owned', disabled: true, owned };
  if (item.requires && !w.owned[item.requires]) {
    const req = SHOP.find((x) => x.id === item.requires);
    return { label: `Needs ${req ? req.name : item.requires}`, disabled: true };
  }
  return { label: `Buy · ${item.price}`, disabled: w.coins < item.price, buy: true };
}

function renderShop() {
  renderCoins();
  const body = $('shop-body');
  body.innerHTML = '';
  for (const cat of ['Melee', 'Upgrades', 'Supplies']) {
    const section = document.createElement('div');
    section.className = 'shop-cat';
    section.innerHTML = `<h3>${cat === 'Melee' ? 'Melee & throwing' : cat}</h3><div class="shop-grid"></div>`;
    const grid = section.querySelector('.shop-grid');
    for (const item of SHOP.filter((x) => x.cat === cat)) {
      const st = shopState(item);
      const card = document.createElement('div');
      card.className = 'shop-item' + (st.equipped ? ' equipped' : st.owned ? ' owned' : '');
      const short = st.buy && st.disabled ? `<span class="have">Need ${(item.price - state.wallet.coins).toLocaleString()} more coins</span>` : '';
      const have = item.kind === 'supply' ? `<span class="have">You have ${st.have} of ${item.max}</span>` : '';
      card.innerHTML = `<h4>${item.name}</h4><div class="shop-stat">${item.stat}</div><p>${item.desc}</p>${have}
        <button class="btn ${st.buy ? 'btn-primary' : ''}" ${st.disabled ? 'disabled' : ''}>${st.buy ? '<span class="coin"></span>' : ''}${st.label}</button>${short}`;
      card.querySelector('button').addEventListener('click', () => shopAction(item, st));
      grid.appendChild(card);
    }
    body.appendChild(section);
  }
  $('coin-rules').textContent = `${COINS.kill} per elimination · +${COINS.headshot} headshot · +${COINS.melee} melee · +${COINS.backstab} backstab · +${COINS.throw} knife throw · +${COINS.grenade} grenade · streak bonus from your 3rd kill in a row. Easy bots pay half, hard bots pay 1.5x, and real players pay 1.5x.`;
}

function shopAction(item, st) {
  const w = state.wallet;
  let msg = '';
  if (st.equip) {
    w.melee = item.id;
    msg = `${item.name} equipped.`;
  } else if (st.buy && w.coins >= item.price) {
    w.coins -= item.price;
    if (item.kind === 'supply') w[item.id] = (w[item.id] | 0) + 1;
    else w.owned[item.id] = true;
    if (item.kind === 'melee') w.melee = item.id; // equip new blades right away
    msg = `Bought ${item.name}.`;
  } else return;
  saveWallet();
  if (state.game) state.game.applyLoadout();
  $('shop-msg').textContent = msg;
  renderShop();
}

function openShop() {
  if (document.pointerLockElement) document.exitPointerLock();
  $('shop-msg').textContent = state.game && state.online ? 'The match keeps going while you shop.' : '';
  renderShop();
  $('shop').hidden = false;
}

function closeShop() {
  $('shop').hidden = true;
  if (state.game) state.game.updateSlotHUD();
}

$('shop-close').addEventListener('click', closeShop);
document.addEventListener('keydown', (e) => {
  if (!$('shop').hidden && (e.code === 'Escape' || e.code === 'KeyB')) {
    e.stopPropagation();
    closeShop();
  }
}, true);
for (const b of document.querySelectorAll('[data-open-shop]')) b.addEventListener('click', openShop);

// ---------------------------------------------------------------- boot
renderCoins();
window.strikezone = state; // handy for debugging in the browser console
renderFriends();
show('home');
if (location.hash === '#solo') $('btn-solo').click();
net.connect().then((ok) => {
  if (ok) onConnected();
  else setServerStatus('', 'Offline · bots only (run the server for online play)');
});
