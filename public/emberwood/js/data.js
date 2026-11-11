// Emberwood game data: classes, items, enemies, quests and NPCs.

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    tagline: 'Sword and shield, front and center',
    desc: 'Tough and hard-hitting up close. Spins through crowds and shouts enemies into the dirt.',
    base: { str: 8, vit: 8, int: 2, agi: 4 },
    growth: { str: 2, vit: 2, int: 0, agi: 1 },
    attack: { kind: 'melee', range: 1.5, arc: 1.1, cooldown: 0.42, scale: { str: 1.6 } },
    weapon: 'sword_rusty',
    skills: {
      q: { id: 'whirlwind', name: 'Whirlwind', mp: 12, cooldown: 4, desc: 'Spin and hit everything around you for heavy damage.' },
      e: { id: 'battlecry', name: 'Battle Cry', mp: 15, cooldown: 15, desc: '+50% damage and +25% speed for 6 seconds.' },
    },
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    tagline: 'Arrows from a safe distance',
    desc: 'Fast on their feet and deadly at range. Rolls out of trouble and fills the air with arrows.',
    base: { str: 4, vit: 5, int: 3, agi: 9 },
    growth: { str: 1, vit: 1, int: 1, agi: 2 },
    attack: { kind: 'arrow', speed: 13, range: 10, cooldown: 0.38, scale: { agi: 1.3, str: 0.5 } },
    weapon: 'bow_short',
    skills: {
      q: { id: 'multishot', name: 'Multishot', mp: 10, cooldown: 3, desc: 'Fire five arrows in a fan.' },
      e: { id: 'roll', name: 'Roll', mp: 6, cooldown: 2, desc: 'Dash a few steps. You can\'t be hit while rolling.' },
    },
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    tagline: 'Fire and frost',
    desc: 'Fragile but devastating. Blasts groups with fireballs and freezes anything that gets too close.',
    base: { str: 2, vit: 4, int: 10, agi: 5 },
    growth: { str: 0, vit: 1, int: 3, agi: 1 },
    attack: { kind: 'bolt', speed: 10, range: 9, cooldown: 0.48, scale: { int: 1.6 } },
    weapon: 'staff_oak',
    skills: {
      q: { id: 'fireball', name: 'Fireball', mp: 14, cooldown: 2.5, desc: 'Explodes on impact, burning everything nearby.' },
      e: { id: 'frostnova', name: 'Frost Nova', mp: 18, cooldown: 8, desc: 'Freeze the ground around you, damaging and slowing enemies.' },
    },
  },
};

export const ATTRS = {
  str: { name: 'Strength', desc: 'Physical damage (sword and bow)' },
  vit: { name: 'Vitality', desc: 'Max health and a little defense' },
  int: { name: 'Intellect', desc: 'Max mana, mana regen and magic damage' },
  agi: { name: 'Agility', desc: 'Move speed, critical hits and arrow damage' },
};

export const TUNIC_COLORS = ['#c0392b', '#2f6fb5', '#2e8b57', '#8e44ad', '#d68910', '#2c3e50'];

// price = what shops charge; you can sell anything for half (loot sells for its full value).
export const ITEMS = {
  potion_hp: { name: 'Health Potion', type: 'consumable', heal: 60, price: 20, desc: 'Restores 60 health.' },
  potion_mp: { name: 'Mana Potion', type: 'consumable', mana: 50, price: 20, desc: 'Restores 50 mana.' },
  elixir: { name: 'Ember Elixir', type: 'consumable', heal: 999, mana: 999, price: 120, desc: 'Fully restores health and mana.' },

  sword_rusty: { name: 'Rusty Sword', type: 'weapon', cls: 'warrior', atk: 5, price: 10, desc: 'It has seen better days.' },
  sword_iron: { name: 'Iron Sword', type: 'weapon', cls: 'warrior', atk: 11, price: 140, desc: 'Solid village steel.' },
  sword_ember: { name: 'Emberbrand', type: 'weapon', cls: 'warrior', atk: 22, price: 600, desc: 'Still warm from the Warden\'s forge.' },
  bow_short: { name: 'Short Bow', type: 'weapon', cls: 'ranger', atk: 4, price: 10, desc: 'Light and quick.' },
  bow_hunter: { name: 'Hunter\'s Bow', type: 'weapon', cls: 'ranger', atk: 9, price: 140, desc: 'Tom swears by it.' },
  bow_wind: { name: 'Windpiercer', type: 'weapon', cls: 'ranger', atk: 18, price: 600, desc: 'Arrows sing as they fly.' },
  staff_oak: { name: 'Oak Staff', type: 'weapon', cls: 'mage', atk: 5, price: 10, desc: 'A sturdy walking stick that hums.' },
  staff_crystal: { name: 'Crystal Staff', type: 'weapon', cls: 'mage', atk: 11, price: 150, desc: 'Focuses magic into a sharp point.' },
  staff_ember: { name: 'Ember Staff', type: 'weapon', cls: 'mage', atk: 22, price: 600, desc: 'The Warden\'s heart, set in wood.' },

  armor_cloth: { name: 'Cloth Tunic', type: 'armor', def: 1, price: 10, desc: 'Better than nothing.' },
  armor_leather: { name: 'Leather Armor', type: 'armor', def: 4, price: 90, desc: 'Light and flexible.' },
  armor_chain: { name: 'Chainmail', type: 'armor', def: 8, price: 220, desc: 'Heavy rings of iron.' },
  armor_warden: { name: 'Warden Plate', type: 'armor', def: 14, price: 700, desc: 'Forged in the Ashen Cave.' },

  slime_gel: { name: 'Slime Gel', type: 'loot', value: 3, desc: 'Sticky. Ivy buys it for potions.' },
  wolf_pelt: { name: 'Wolf Pelt', type: 'loot', value: 10, desc: 'Warm and valuable.' },
  bone: { name: 'Old Bone', type: 'loot', value: 6, desc: 'Rattles a little.' },
  amulet: { name: 'Mira\'s Amulet', type: 'quest', desc: 'A silver amulet with an ember-red stone.' },
};

export const CLASS_WEAPONS = {
  warrior: ['sword_iron', 'sword_ember'],
  ranger: ['bow_hunter', 'bow_wind'],
  mage: ['staff_crystal', 'staff_ember'],
};

// behavior: hop | erratic | chase | ranged | boss
export const ENEMIES = {
  slime: { name: 'Slime', hp: 24, dmg: 6, def: 0, speed: 1.7, aggro: 5, xp: 9, gold: [2, 5], r: 0.38, behavior: 'hop', color: '#58c46a', drops: [['slime_gel', 0.35], ['potion_hp', 0.08]] },
  bee: { name: 'Thornbee', hp: 14, dmg: 4, def: 0, speed: 3.4, aggro: 6, xp: 6, gold: [1, 3], r: 0.3, behavior: 'erratic', color: '#f1c40f', drops: [['potion_mp', 0.06]] },
  wolf: { name: 'Gray Wolf', hp: 48, dmg: 10, def: 1, speed: 3.7, aggro: 7, xp: 20, gold: [4, 9], r: 0.42, behavior: 'chase', windup: 0.35, reach: 1.1, color: '#8a8f99', drops: [['wolf_pelt', 0.5], ['potion_hp', 0.1]] },
  shroom: { name: 'Sporecap', hp: 34, dmg: 8, def: 0, speed: 1.3, aggro: 7, xp: 16, gold: [3, 7], r: 0.38, behavior: 'ranged', fireEvery: 2.2, color: '#c0504d', drops: [['potion_mp', 0.12]] },
  bat: { name: 'Ash Bat', hp: 26, dmg: 7, def: 0, speed: 4.2, aggro: 7, xp: 13, gold: [2, 6], r: 0.32, behavior: 'erratic', color: '#5b4a6b', drops: [['potion_hp', 0.08]] },
  skeleton: { name: 'Cave Skeleton', hp: 75, dmg: 14, def: 3, speed: 2.4, aggro: 7, xp: 34, gold: [6, 14], r: 0.4, behavior: 'chase', windup: 0.45, reach: 1.2, color: '#e8e2d0', drops: [['bone', 0.5], ['potion_hp', 0.12], ['armor_chain', 0.04]] },
  warden: { name: 'Cinder Warden', hp: 1100, dmg: 20, def: 4, speed: 1.9, aggro: 9, xp: 600, gold: [300, 300], r: 1.0, behavior: 'boss', color: '#e0632a', drops: [['armor_warden', 1], ['elixir', 1]] },
};

export const QUESTS = {
  slimes: {
    title: 'Slime Trouble',
    giver: 'elder',
    desc: 'Slimes are eating the crops in Sunfield Meadow, east of the village. Defeat 6 of them.',
    type: 'kill', target: 'slime', count: 6,
    reward: { xp: 80, gold: 60, items: ['potion_hp', 'potion_hp'] },
  },
  amulet: {
    title: 'Mira\'s Amulet',
    giver: 'mira',
    requires: ['slimes'],
    desc: 'Mira lost her mother\'s amulet while picking mushrooms in the Whispering Woods. Find it and bring it back.',
    type: 'fetch', item: 'amulet',
    reward: { xp: 140, gold: 50, items: ['armor_leather'] },
  },
  wolves: {
    title: 'Wolf Hunt',
    giver: 'tom',
    requires: ['slimes'],
    desc: 'Wolves keep attacking travelers on the forest road. Hunt 5 of them in the Whispering Woods.',
    type: 'kill', target: 'wolf', count: 5,
    reward: { xp: 180, gold: 90, items: ['potion_hp', 'potion_mp'] },
  },
  warden: {
    title: 'The Cinder Warden',
    giver: 'elder',
    requires: ['wolves'],
    desc: 'Ash storms pour out of the Ashen Cave beyond the woods. Find the Cinder Warden at its heart and put out its fire for good.',
    type: 'kill', target: 'warden', count: 1,
    reward: { xp: 400, gold: 200, items: ['elixir'], weapon: true },
  },
};

// NPCs. `quests` are offered in order. `lines` are said when there's nothing quest-related to say.
export const NPCS = {
  elder: {
    name: 'Elder Maren', role: 'Village elder', color: '#7d5ba6', hat: '#e8e2d0',
    quests: ['slimes', 'warden'],
    lines: [
      'Emberwood has stood for three hundred years. With your help, it will stand for three hundred more.',
      'The fire in that cave was once a gift to our village. Something twisted it.',
    ],
    after: 'You have done what no one else could. Emberwood is in your debt, hero.',
  },
  mira: {
    name: 'Mira', role: 'Herb gatherer', color: '#2e8b57', hat: '#a0522d',
    quests: ['amulet'],
    lines: ['The woods used to be so peaceful. Now I hear wolves every night.'],
    before: 'I\'d ask you for a favor, but the woods are too dangerous for a newcomer. Prove yourself to the Elder first.',
  },
  tom: {
    name: 'Hunter Tom', role: 'Hunter', color: '#8b5a2b', hat: '#3d5a2a',
    quests: ['wolves'],
    lines: ['Keep your bow strung and your boots dry. That\'s all the advice I\'ve got.'],
    before: 'The woods are no place for beginners. Clear out those slimes first, then we\'ll talk.',
  },
  bran: {
    name: 'Bran', role: 'Blacksmith', color: '#5d6d7e', hat: '#2c3e50',
    shop: ['sword_iron', 'bow_hunter', 'staff_crystal', 'armor_leather', 'armor_chain'],
    lines: ['Steel doesn\'t lie. Pick something that fits your hand.'],
  },
  ivy: {
    name: 'Ivy', role: 'Herbalist', color: '#16a085', hat: '#f5b7b1',
    shop: ['potion_hp', 'potion_mp', 'elixir'],
    lines: ['Fresh potions! Brewed this morning, mostly from things that didn\'t try to bite me.'],
  },
  rosa: {
    name: 'Rosa', role: 'Innkeeper', color: '#c0392b', hat: '#f4d03f',
    inn: 15,
    lines: ['A warm bed and a hot stew. Rest here and you\'ll wake up good as new. Your journey is saved when you rest.'],
  },
  garrick: {
    name: 'Garrick', role: 'Gate guard', color: '#34495e', hat: '#7f8c8d',
    lines: ['The north road leads to the Whispering Woods.'],
    gate: { requires: 'slimes', locked: 'Orders from the Elder: nobody goes north until they\'ve proven themselves. Help with the slimes first.', open: 'The Elder vouches for you. Mind the wolves out there.' },
  },
  pip: {
    name: 'Pip', role: 'Village kid', color: '#e67e22', hat: '#3498db',
    lines: [
      'I saw a slime eat a whole cabbage! In one bite!',
      'When I grow up I\'m gonna be a hero just like you. Or a baker. Probably a baker.',
      'Did you know you can sell slime gel to Ivy? She makes potions from it. Gross!',
    ],
  },
};
