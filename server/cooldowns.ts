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

/** Names compared without case or curly apostrophes ("Nature’s Vigil" = "Nature's Vigil"). */
const key = (name: string) => name.toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
const BY_NAME = new Map(Object.entries(TBC).map(([n, s]) => [key(n), s]));

/** Cooldown in seconds for a cast, or undefined if it isn't a tracked cooldown. */
export function cooldownFor(name: string): number | undefined {
  return BY_NAME.get(key(name));
}

// Casts that don't count as "doing something" for gap detection.
export const IGNORE_FOR_GAPS = new Set(['Auto Shot', 'Shoot', 'Melee', 'Auto Attack', 'Attack']);

// A gap is any stretch with no non-auto casts longer than this many seconds.
export const GAP_SECONDS = 4;
