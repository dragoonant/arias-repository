// Melee weapons, throwables, supplies, the Armory shop catalogue and coin rewards.

export const MELEE = {
  knife: {
    id: 'knife',
    name: 'Combat Knife',
    damage: 55,
    backstab: 2.5, // hits from behind deal 2.5x (an instant kill on most roles)
    reach: 2.3,
    arc: 0.65, // radians either side of where you're looking
    delay: 0.42,
    lunge: 0,
    cleave: false,
    moveBonus: 1.12,
    blade: { length: 0.3, width: 0.05, color: 0xcfd6e0, glow: 0 },
  },
  katana: {
    id: 'katana',
    name: 'Katana',
    damage: 85,
    backstab: 1.6,
    reach: 3.2,
    arc: 0.8,
    delay: 0.6,
    lunge: 14,
    cleave: true, // hits everyone in the arc
    moveBonus: 1.08,
    blade: { length: 0.95, width: 0.045, color: 0xe4e9f0, glow: 0 },
  },
  dragon: {
    id: 'dragon',
    name: 'Dragon Katana',
    damage: 115,
    backstab: 1.6,
    reach: 3.6,
    arc: 0.85,
    delay: 0.5,
    lunge: 17,
    cleave: true,
    moveBonus: 1.12,
    blade: { length: 1.05, width: 0.05, color: 0xff5a2e, glow: 0.9 },
  },
};

export const THROWING = {
  name: 'Throwing Knives',
  damage: 65,
  count: 3, // refilled every time you respawn
  speed: 34,
  gravity: 9,
  delay: 0.45,
};

export const GRENADE = {
  name: 'Frag Grenade',
  damage: 120,
  radius: 6.5,
  fuse: 1.6,
  speed: 17,
  max: 5,
};

export const MEDKIT = {
  name: 'Med Kit',
  heal: 60,
  max: 5,
};

// Everything the Armory sells. `kind`:
//   melee    – a melee weapon you equip (one at a time)
//   gear     – a permanent unlock
//   supply   – a consumable you can stack up to `max`
export const SHOP = [
  { id: 'knife', kind: 'melee', cat: 'Melee', name: 'Combat Knife', price: 0, stat: '55 dmg · fast · backstabs deal 2.5x', desc: 'Everyone starts with one. Sneak up behind someone for a one-hit takedown.' },
  { id: 'katana', kind: 'melee', cat: 'Melee', name: 'Katana', price: 600, stat: '85 dmg · long reach · hits everyone in front', desc: 'Lunges forward on every swing and cuts through groups.' },
  { id: 'dragon', kind: 'melee', cat: 'Melee', name: 'Dragon Katana', price: 1500, requires: 'katana', stat: '115 dmg · faster swings · longer lunge', desc: 'A glowing blade for players who live up close.' },
  { id: 'throwing', kind: 'gear', cat: 'Melee', name: 'Throwing Knives', price: 450, stat: '65 dmg · 3 per life · headshots x2', desc: 'Adds a third weapon slot. Knives arc a little, so aim slightly high at range.' },
  { id: 'mags', kind: 'gear', cat: 'Upgrades', name: 'Extended Mags', price: 400, stat: '+50% magazine size', desc: 'Works on every role\'s gun.' },
  { id: 'quick', kind: 'gear', cat: 'Upgrades', name: 'Quick Hands', price: 350, stat: '35% faster reloads', desc: 'Get back in the fight sooner.' },
  { id: 'hollow', kind: 'gear', cat: 'Upgrades', name: 'Hollow-Point Rounds', price: 800, stat: '+15% gun damage', desc: 'Every bullet hits harder, on every role.' },
  { id: 'kevlar', kind: 'gear', cat: 'Upgrades', name: 'Kevlar Vest', price: 700, stat: '+25 max health', desc: 'Survive one more hit.' },
  { id: 'boots', kind: 'gear', cat: 'Upgrades', name: 'Light Boots', price: 500, stat: '+10% move speed', desc: 'Faster on every role.' },
  { id: 'grenade', kind: 'supply', cat: 'Supplies', name: 'Frag Grenade', price: 150, max: GRENADE.max, stat: '120 dmg blast · 6.5 m radius', desc: 'Press G to throw. Bounces off walls and explodes after 1.6 seconds.' },
  { id: 'medkit', kind: 'supply', cat: 'Supplies', name: 'Med Kit', price: 100, max: MEDKIT.max, stat: `Restores ${MEDKIT.heal} health`, desc: 'Press H to heal instantly.' },
];

// Coins for an elimination. Bonuses stack.
export const COINS = {
  kill: 100,
  headshot: 50,
  melee: 75,
  backstab: 100,
  throw: 60,
  grenade: 50,
  streakStep: 25, // per kill beyond the 2nd in a row
  streakCap: 100,
  startBalance: 250,
  // multiplier by who you eliminated
  vsBot: { easy: 0.5, normal: 1, hard: 1.5 },
  vsPlayer: 1.5,
};

export function newWallet() {
  return { coins: COINS.startBalance, owned: {}, melee: 'knife', grenade: 1, medkit: 1 };
}
