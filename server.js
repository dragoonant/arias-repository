// StrikeZone Arena server
// - Serves the game files from ./public
// - Runs a WebSocket lobby: online presence for friends, invites, rooms,
//   and relays in-game messages between players in the same room.
//
// Gameplay itself (movement, bots, scoring) runs in the browsers. The first
// player in a room is the "host": they simulate bots and keep the scoreboard.
// If the host leaves, the next player takes over.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let nextId = 1;
const clients = new Map(); // id -> { ws, name, roomCode }
const rooms = new Map(); // code -> room

const ROLES = ['assault', 'scout', 'heavy', 'sniper', 'medic'];
const MAPS = ['rustyard', 'dune', 'neon', 'frost'];
const MODES = ['ffa', 'tdm'];

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Player';
}

function roomInfo(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    settings: room.settings,
    players: [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, role: p.role, team: p.team })),
  };
}

function broadcastRoom(room, msg, exceptId) {
  for (const id of room.players.keys()) {
    if (id === exceptId) continue;
    const c = clients.get(id);
    if (c) send(c.ws, msg);
  }
}

function pushRoom(room) {
  broadcastRoom(room, { t: 'room', room: roomInfo(room) });
}

function pickTeam(room) {
  let red = 0, blue = 0;
  for (const p of room.players.values()) p.team === 'red' ? red++ : blue++;
  return red <= blue ? 'red' : 'blue';
}

function leaveRoom(id) {
  const c = clients.get(id);
  if (!c || !c.roomCode) return;
  const room = rooms.get(c.roomCode);
  c.roomCode = null;
  if (!room) return;
  room.players.delete(id);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === id) {
    room.hostId = room.players.keys().next().value;
  }
  broadcastRoom(room, { t: 'left', id, hostId: room.hostId });
  pushRoom(room);
}

function joinRoom(id, room) {
  const c = clients.get(id);
  leaveRoom(id);
  c.roomCode = room.code;
  room.players.set(id, { name: c.name, role: c.role || 'assault', team: pickTeam(room) });
  pushRoom(room);
  if (room.started) {
    send(c.ws, { t: 'start', room: roomInfo(room) });
  }
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const client = { ws, name: 'Player', roomCode: null, role: 'assault' };
  clients.set(id, client);
  send(ws, { t: 'welcome', id });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const room = client.roomCode ? rooms.get(client.roomCode) : null;

    switch (msg.t) {
      case 'hello':
        client.name = cleanName(msg.name);
        if (ROLES.includes(msg.role)) client.role = msg.role;
        break;

      case 'presence': {
        // Which of these friend names are online right now?
        const wanted = new Set((msg.names || []).map((n) => cleanName(n).toLowerCase()));
        const online = [];
        for (const [otherId, other] of clients) {
          if (otherId !== id && wanted.has(other.name.toLowerCase())) {
            online.push({ name: other.name, inRoom: !!other.roomCode });
          }
        }
        send(ws, { t: 'presence', online });
        break;
      }

      case 'invite': {
        if (!room) break;
        const target = cleanName(msg.name).toLowerCase();
        let found = false;
        for (const [otherId, other] of clients) {
          if (otherId !== id && other.name.toLowerCase() === target) {
            send(other.ws, { t: 'invite', from: client.name, code: room.code });
            found = true;
          }
        }
        send(ws, { t: 'inviteResult', name: msg.name, ok: found });
        break;
      }

      case 'create': {
        const code = makeCode();
        const s = msg.settings || {};
        const newRoom = {
          code,
          hostId: id,
          started: false,
          settings: {
            map: MAPS.includes(s.map) ? s.map : 'rustyard',
            mode: MODES.includes(s.mode) ? s.mode : 'ffa',
            bots: Math.max(0, Math.min(10, s.bots | 0)),
            killLimit: Math.max(5, Math.min(100, s.killLimit | 0 || 20)),
            timeLimit: Math.max(2, Math.min(30, s.timeLimit | 0 || 8)),
            difficulty: ['easy', 'normal', 'hard'].includes(s.difficulty) ? s.difficulty : 'normal',
          },
          players: new Map(),
        };
        rooms.set(code, newRoom);
        joinRoom(id, newRoom);
        break;
      }

      case 'join': {
        const target = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!target) {
          send(ws, { t: 'error', message: 'No room with that code. Check the code and try again.' });
          break;
        }
        if (target.players.size >= 12) {
          send(ws, { t: 'error', message: 'That room is full (12 players max).' });
          break;
        }
        joinRoom(id, target);
        break;
      }

      case 'leave':
        leaveRoom(id);
        break;

      case 'setRole':
        if (ROLES.includes(msg.role)) {
          client.role = msg.role;
          if (room) {
            room.players.get(id).role = msg.role;
            pushRoom(room);
          }
        }
        break;

      case 'setTeam':
        if (room && (msg.team === 'red' || msg.team === 'blue')) {
          room.players.get(id).team = msg.team;
          pushRoom(room);
        }
        break;

      case 'settings':
        if (room && room.hostId === id && !room.started) {
          const s = msg.settings || {};
          if (MAPS.includes(s.map)) room.settings.map = s.map;
          if (MODES.includes(s.mode)) room.settings.mode = s.mode;
          if (s.bots !== undefined) room.settings.bots = Math.max(0, Math.min(10, s.bots | 0));
          if (s.killLimit !== undefined) room.settings.killLimit = Math.max(5, Math.min(100, s.killLimit | 0));
          if (s.timeLimit !== undefined) room.settings.timeLimit = Math.max(2, Math.min(30, s.timeLimit | 0));
          if (['easy', 'normal', 'hard'].includes(s.difficulty)) room.settings.difficulty = s.difficulty;
          pushRoom(room);
        }
        break;

      case 'start':
        if (room && room.hostId === id && !room.started) {
          room.started = true;
          broadcastRoom(room, { t: 'start', room: roomInfo(room) });
        }
        break;

      case 'end':
        if (room && room.hostId === id && room.started) {
          room.started = false;
          broadcastRoom(room, { t: 'end', results: msg.results || null });
          pushRoom(room);
        }
        break;

      case 'relay':
        // In-game traffic. `to` is a player id, "host", or omitted for everyone else.
        if (!room) break;
        if (msg.to === undefined || msg.to === null) {
          broadcastRoom(room, { t: 'relay', from: id, data: msg.data }, id);
        } else {
          const targetId = msg.to === 'host' ? room.hostId : msg.to;
          if (room.players.has(targetId)) {
            const target = clients.get(targetId);
            if (target) send(target.ws, { t: 'relay', from: id, data: msg.data });
          }
        }
        break;

      case 'chat':
        if (room) {
          const text = String(msg.text || '').slice(0, 120);
          if (text) broadcastRoom(room, { t: 'chat', from: client.name, text });
        }
        break;
    }
  });

  ws.on('close', () => {
    leaveRoom(id);
    clients.delete(id);
  });
});

server.listen(PORT, () => {
  console.log(`StrikeZone Arena running at http://localhost:${PORT}`);
  console.log('Friends on the same Wi-Fi can join using your computer\'s local IP address and this port.');
});
