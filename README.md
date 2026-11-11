# StrikeZone Arena

A 3D arena shooter that runs in the browser and that you can play with friends. Pick a **role**, pick a **map**, add your **friends**, and battle online or against bots.

**▶ Play now: https://dragoonant.github.io/arias-repository/**

The GitHub Pages version is static hosting, so it supports **Play vs bots** only. For online play with friends, run the server (see below).

To update the Pages site, copy the contents of `public/` to the `gh-pages` branch.

## Emberwood (role-playing game)

The site also has a second game: **Emberwood**, a top-down action RPG. Open it from **More games** on the StrikeZone home screen, or go to `/emberwood/`.

- **Create a hero**: name them and choose **Warrior** (sword, Whirlwind, Battle Cry), **Ranger** (bow, Multishot, Roll) or **Mage** (staff, Fireball, Frost Nova), plus a tunic color.
- **Talk to the villagers**: Elder Maren, Mira, Hunter Tom, Bran the blacksmith, Ivy the herbalist, Rosa at the inn and more. A gold **!** over someone's head means they have a quest; a green **?** means you can turn one in.
- **Quests unlock the world**: clear the slimes in Sunfield Meadow, then the north gate opens to the Whispering Woods (wolves, a lost amulet). Finish the wolf hunt to enter the dark Ashen Cave, where the **Cinder Warden** boss slams, charges, rains fire and summons bats.
- **Grow stronger**: earn XP and gold, level up, spend attribute points on Strength, Vitality, Intellect and Agility, buy and equip better weapons and armor, sell loot, rest at the inn.
- **Saves automatically** in your browser. Works with keyboard and mouse or touch controls.

| Key | Action |
|---|---|
| W A S D | Move |
| Click / Space | Attack (aims at the mouse; on phones it aims at the nearest enemy) |
| Q · E | Class skills |
| F | Talk, open chests |
| 1 · 2 | Health / mana potion |
| C · I · L | Character, inventory, quest log |

## Hopscape (3D obby)

A third-person 3D obstacle course. Open it from **More games**, or go to `/obby/`.

- **Four courses**: Sunny Steps (Easy, 10 stages), Lava Leap (Medium, 12), Neon Tower (Hard, 13) and Frost Summit (Expert, 14).
- **Obstacles**: gaps, narrow beams, staircases, moving platforms, elevators, vanishing platforms, blinking platforms, spinning kill bars, sliding sweepers, kill stripes, jump pads, conveyor belts, tiny pillars and slippery ice.
- **Checkpoint flags** at every stage. Falling or touching a glowing hazard sends you back to the last flag. Progress, best times and your avatar color are saved in your browser.
- **Controls**: WASD to run (relative to the camera), Space to jump (hold for a full jump, tap for a short hop), mouse to turn the camera, scroll to zoom, R to return to your checkpoint, Esc to pause. Phones get a joystick, a jump button and drag-to-look.

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

- **Melee and throwables**: everyone carries a Combat Knife (press 2, or V for a quick swing). Hit someone from behind for a backstab. Unlock a **Katana** that lunges and hits everyone in front of you, then the **Dragon Katana**. **Throwing Knives** add a third slot, and **Frag Grenades** (G) bounce and explode.
- **Live leaderboard**: the top 3 players by kills are shown at the top of the screen, and the leader wears a gold crown that everyone can see. You get a message whenever the lead changes.
- **Coins and the Armory**: every elimination earns coins, with bonuses for headshots, melee kills, backstabs, knife throws, grenades and kill streaks. Spend them in the Armory (main menu, or press B mid-match) on blades, permanent upgrades (bigger mags, faster reloads, more damage, body armor, faster boots) and supplies (grenades, med kits). Coins and unlocks are saved in your browser.
- **4 maps**: Rust Yard (shipping containers and a crane tower), Dune Outpost (desert fort ruins), Neon District (a city at night) and Frost Peak (snowy plateaus).
- **2 modes**: Free-for-all, or Team battle (Red vs Blue).
- **Spawn points**: every map has named spawn spots marked by glowing pads. In Team battle each team has its own three bases. When you're eliminated, pick where to respawn with the number keys (or tap on a phone), or leave it on *Auto* to land at the spot farthest from enemies.
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
| 1 / 2 / 3 or mouse wheel | Gun / melee / throwing knives |
| V | Quick melee swing |
| G | Throw a grenade |
| H | Use a med kit |
| B | Open the Armory |
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
public/js/weapons.js melee weapons, throwables, Armory items and coin rewards
public/js/net.js     WebSocket client
public/vendor/       Three.js (bundled so the game also works offline)
public/emberwood/    Emberwood RPG (index.html, js/data.js, js/world.js, js/game.js)
public/obby/         Hopscape 3D obby (index.html, js/courses.js, js/game.js)
```

### Adding your own map

Add an entry to `MAPS` in `public/js/maps.js` with a `theme` (sky, fog, lights) and a `build()` function that returns a list of boxes, then add its id to `MAP_ORDER` and to the `MAPS` list in `server.js`.
