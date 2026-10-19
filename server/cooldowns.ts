// Major cooldowns to audit, by cast name. Cooldown in seconds.
// Edit this list as Forever's real values are confirmed from logs.
// Names are matched against cast names in the log, so TBC/Classic-era and Forever names can live together.

export const COOLDOWNS: Record<string, number> = {
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

// Casts that don't count as "doing something" for gap detection.
export const IGNORE_FOR_GAPS = new Set(['Auto Shot', 'Shoot', 'Melee', 'Auto Attack', 'Attack']);

// A gap is any stretch with no non-auto casts longer than this many seconds.
export const GAP_SECONDS = 4;
