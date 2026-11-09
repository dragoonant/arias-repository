# StrikeZone Arena

A 3D arena shooter that runs in the browser and that you can play with friends. Pick a **role**, pick a **map**, add your **friends**, and battle online or against bots.

## Features

- **3D first-person combat** built with Three.js: hitscan weapons, headshots, recoil, reloads, a killfeed, a minimap and a scoreboard.
- **5 roles**, each with its own health, speed, weapon and ability:

  | Role | Weapon | Ability (press Q) |
  |---|---|---|
  | Assault | AR-7 Rifle (automatic) | **Adrenaline**: fire and move faster |
  | Scout | Viper SMG | **Dash**: burst forward |
  | Heavy | Breaker Shotgun | **Fortify**: take 60% less damage |
  | Sniper | Longbow Rifle (right-click to scope) | **Cloak**: turn nearly invisible |
  | Medic | Pulse Pistol | **Heal Burst**: heals you and nearby teammates |

- **4 maps**: Rust Yard (shipping containers and a crane tower), Dune Outpost (desert fort ruins), Neon District (a city at night) and Frost Peak (snowy plateaus).
- **2 modes**: Free-for-all, or Team battle (Red vs Blue).
- **Bots** in 3 difficulty levels fill out the match. Bots play the same roles you do.
- **Friends**: add friends by callsign, see when they're online, invite them to your room, or share a 5-letter room code. The room also has a chat.
- **Phones and tablets** get on-screen touch controls.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

- **Play vs bots** works right away.
- **Play with friends**: click *Play with friends* → *Create room*, then share the room code. You can also invite friends from your friends list.

### Playing with friends on the same Wi-Fi

Run `npm start` on one computer and find that computer's local IP address (for example `192.168.1.20`). Friends open `http://192.168.1.20:3000` in their browser.

### Playing with friends over the internet

The server is a single Node.js app (`server.js`), so you can host it on any Node host that supports WebSockets, such as Render, Railway or Fly.io. Set the start command to `npm start`. The server reads the port from the `PORT` environment variable.

## Controls

| Key | Action |
|---|---|
| W A S D | Move (hold Shift to sprint) |
| Mouse | Aim |
| Left click | Shoot |
| Right click | Zoom / scope |
| Space | Jump |
| R | Reload |
| Q | Use your role's ability |
| Tab | Scoreboard |
| Esc | Pause menu (leave match) |

## How it works

- `server.js` serves the game files and runs a small WebSocket lobby. It tracks who is online (for the friends list), handles rooms, invites and chat, and relays game messages between players in a room.
- Each browser simulates its own player. The room's host (whoever created it) also runs the bots and keeps the scoreboard. If the host leaves, the next player takes over automatically.
- The shooter's browser decides what was hit, and the victim's browser applies the damage. That's fine for playing with friends, but it isn't cheat-proof.

```
server.js            lobby, rooms, friends presence, message relay
public/index.html    menus, lobby and HUD
public/js/main.js    menu logic, friends list, lobby, match lifecycle
public/js/game.js    3D engine: world, physics, bots, combat, networking
public/js/roles.js   role and weapon stats
public/js/maps.js    map layouts and lighting
public/js/net.js     WebSocket client
public/vendor/       Three.js (bundled so the game also works offline)
```

### Adding your own map

Add an entry to `MAPS` in `public/js/maps.js` with a `theme` (sky, fog, lights) and a `build()` function that returns a list of boxes, then add its id to `MAP_ORDER` and to the `MAPS` list in `server.js`.
