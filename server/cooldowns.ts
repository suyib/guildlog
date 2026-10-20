// GAME CONTENT (Burning Crusade for now; replace with WoW Forever's values once they're known).
// Major cooldowns to audit, by cast name, with the cooldown in seconds.
const TBC: Record<string, number> = {
  // Hunter
  'Bestial Wrath': 120,
  'Rapid Fire': 300,
  'Readiness': 300,
  // Paladin
  'Avenging Wrath': 180,
  'Divine Favor': 120,
  'Divine Illumination': 180,
  // Warrior / rogue / others (common)
  'Recklessness': 1800,
  'Death Wish': 180,
  'Adrenaline Rush': 300,
  'Blade Flurry': 120,
  'Icy Veins': 180,
  'Arcane Power': 180,
  'Combustion': 180,
  'Presence of Mind': 180,
  'Elemental Mastery': 180,
  'Inner Focus': 180,
  'Power Infusion': 180,
  // Racials
  'Blood Fury': 120,
  'Berserking': 180,
  // Common on-use trinkets (cast name)
  'Lust for Battle': 120, // Bloodlust Brooch
  'Kiss of the Spider': 120,
  'Earthstrike': 120,
  'Badge of the Swarmguard': 180,
  'Jom Gabbar': 120,
};

// TESTING ONLY: Mists of Pandaria Classic (classic.warcraftlogs.com) cooldowns, so test logs from that
// site show cooldowns. Delete this list, MOP_HOST and the host check below when raiding starts.
const MOP_HOST = 'classic.warcraftlogs.com';
const MOP: Record<string, number> = {
  // Druid
  'Celestial Alignment': 180,
  'Incarnation: Chosen of Elune': 180,
  'Incarnation: King of the Jungle': 180,
  'Incarnation: Son of Ursoc': 180,
  'Incarnation: Tree of Life': 180,
  'Starfall': 90,
  'Berserk': 180,
  "Nature's Vigil": 90,
  'Heart of the Wild': 360,
  // Death Knight
  'Pillar of Frost': 60,
  'Summon Gargoyle': 180,
  'Unholy Frenzy': 180,
  'Empower Rune Weapon': 300,
  'Dancing Rune Weapon': 90,
  // Hunter
  'Bestial Wrath': 60,
  'Stampede': 300,
  // Mage
  'Icy Veins': 180,
  'Arcane Power': 90,
  'Presence of Mind': 90,
  'Mirror Image': 180,
  'Alter Time': 180,
  // Monk
  'Invoke Xuen, the White Tiger': 180,
  'Energizing Brew': 60,
  // Paladin
  'Avenging Wrath': 180,
  'Guardian of Ancient Kings': 300,
  'Holy Avenger': 120,
  // Priest
  'Shadowfiend': 180,
  'Mindbender': 60,
  'Power Infusion': 120,
  // Rogue
  'Shadow Blades': 180,
  'Adrenaline Rush': 180,
  'Vendetta': 120,
  'Shadow Dance': 60,
  'Killing Spree': 120,
  // Shaman
  'Ascendance': 180,
  'Fire Elemental Totem': 300,
  'Feral Spirit': 120,
  'Elemental Mastery': 90,
  'Stormlash Totem': 300,
  // Warlock
  'Dark Soul: Misery': 120,
  'Dark Soul: Instability': 120,
  'Dark Soul: Knowledge': 120,
  'Summon Doomguard': 600,
  'Summon Infernal': 600,
  // Warrior
  'Recklessness': 180,
  'Avatar': 180,
  'Bloodbath': 60,
  'Skull Banner': 180,
  // Racials
  'Berserking': 180,
  'Blood Fury': 120,
};

/** Names compared without case or curly apostrophes ("Nature’s Vigil" = "Nature's Vigil"). */
const key = (name: string) => name.toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
const index = (table: Record<string, number>) => new Map(Object.entries(table).map(([n, s]) => [key(n), s]));
const BY_NAME = index(TBC);
const MOP_BY_NAME = index(MOP);

/** Cooldown in seconds for a cast, or undefined if it isn't a tracked cooldown. `host` picks the testing-only list. */
export function cooldownFor(name: string, host?: string): number | undefined {
  return (host?.toLowerCase() === MOP_HOST ? MOP_BY_NAME : BY_NAME).get(key(name));
}

// Casts that don't count as "doing something" for gap detection.
export const IGNORE_FOR_GAPS = new Set(['Auto Shot', 'Shoot', 'Melee', 'Auto Attack', 'Attack']);

// A gap is any stretch with no non-auto casts longer than this many seconds.
export const GAP_SECONDS = 4;
