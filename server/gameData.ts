// GAME CONTENT: spell lists and rules that depend on the game version. Swap these for WoW
// Forever's when it arrives. IDs are Warcraft Logs ability IDs (the game's spell IDs).

/** Combat potions and runes. A potion's buff usually has the same ID as the potion's spell. */
export const POTION_IDS = new Set([
  // Burning Crusade
  28507, // Haste Potion
  28508, // Destruction Potion
  28494, // Insane Strength Potion
  28506, // Heroic Potion
  28515, // Ironshield Potion
  28499, // Super Mana Potion ("Restore Mana")
  28495, // Super Healing Potion
  38929, // Fel Mana Potion
  28517, // Major Rejuvenation Potion
  45051, // Mad Alchemist's Potion
  41617, // Cenarion Mana Salve
  41618, // Bottled Nethergon Energy
  27869, // Dark Rune
  16666, // Demonic Rune
  // Mists of Pandaria (TESTING ONLY: remove before raiding)
  105702, // Potion of the Jade Serpent
  105697, // Virmen's Bite
  105706, // Potion of Mogu Power
  105709, // Master Mana Potion
  105708, // Master Healing Potion
  105698, // Potion of the Mountains
  105704, // Alchemist's Rejuvenation
]);

export const isPotion = (id: number, name?: string) => POTION_IDS.has(id) || /\bpotion\b|\brune\b/i.test(name ?? '');

/**
 * Debuffs the raid keeps on the boss, grouped by effect (any one of a group counts). Only groups
 * someone applied during the fight are judged, so a raid without that class isn't marked down.
 */
export const MAINTENANCE: { label: string; names: string[] }[] = [
  { label: 'Armor reduction (Sunder / Expose Armor)', names: ['Sunder Armor', 'Expose Armor', 'Weakened Armor'] },
  { label: 'Faerie Fire', names: ['Faerie Fire', 'Faerie Fire (Feral)'] },
  { label: 'Curse of Recklessness', names: ['Curse of Recklessness'] },
  { label: 'Spell damage taken (Curse of the Elements)', names: ['Curse of the Elements', 'Master Poisoner', 'Fire Breath', 'Lightning Breath'] },
  { label: 'Misery', names: ['Misery'] },
  { label: 'Shadow Weaving', names: ['Shadow Weaving'] },
  { label: 'Improved Scorch', names: ['Fire Vulnerability'] },
  { label: 'Judgement of Wisdom', names: ['Judgement of Wisdom'] },
  { label: 'Judgement of Light', names: ['Judgement of Light'] },
  { label: "Hunter's Mark", names: ["Hunter's Mark"] },
  { label: 'Attack power reduction (Demoralizing Shout / Roar)', names: ['Demoralizing Shout', 'Demoralizing Roar'] },
  { label: 'Attack speed reduction (Thunder Clap)', names: ['Thunder Clap', 'Weakened Blows'] },
  { label: 'Physical damage taken (Blood Frenzy / Mangle)', names: ['Blood Frenzy', 'Physical Vulnerability'] },
  { label: 'Mangle', names: ['Mangle (Bear)', 'Mangle (Cat)', 'Mangle', 'Trauma'] },
  { label: 'Expose Weakness', names: ['Expose Weakness'] },
  { label: 'Healing taken reduction (Mortal Wounds)', names: ['Mortal Wounds'] },
];

/**
 * Ticking damage that isn't a damage-over-time spell you keep up (channels, ground effects and
 * passive procs), so its "uptime" says nothing about how you played.
 */
export const NOT_A_DOT = new Set([
  'Mind Flay', 'Drain Life', 'Drain Soul', 'Drain Mana', 'Arcane Missiles', 'Blizzard', 'Rain of Fire', 'Hurricane', 'Volley',
  'Consecration', 'Hellfire', 'Hellfire Effect', 'Death and Decay', 'Flamestrike', 'Explosive Trap Effect', 'Immolation Trap Effect',
  'Deep Wounds', 'Ignite', 'Seed of Corruption', 'Mind Sear', 'Fists of Fury', 'Spinning Crane Kick', 'Crackling Jade Lightning', 'Malefic Grasp',
]);

/**
 * Tanks: being critically hit by a boss's melee means the tank is under the defense cap
 * (490 defense skill in Burning Crusade). Later expansions removed crits on tanks.
 */
export const tankCanBeCritCapped = (host: string) => host === 'fresh.warcraftlogs.com';
export const DEFENSE_CAP_NOTE = 'You need 490 defense skill to stop bosses critting you.';

/** A boss's auto attack. */
export const MELEE_ID = 1;
