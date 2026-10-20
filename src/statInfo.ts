// What each character stat does, shown as a tooltip on "Stats at the pull".
// GAME CONTENT (Burning Crusade for now; replace with WoW Forever's values once they're known).
// Rating numbers are for level 70.

type ClassName = 'Hunter' | 'Rogue' | 'Warrior' | 'Paladin' | 'Shaman' | 'Druid' | 'Mage' | 'Warlock' | 'Priest';

const CASTERS = new Set(['Mage', 'Warlock', 'Priest']);
const HYBRID_CASTERS = new Set(['Paladin', 'Shaman', 'Druid']);

/** Agility needed for 1% crit at level 70, by class. */
const AGI_PER_CRIT: Partial<Record<ClassName, number>> = { Hunter: 40, Rogue: 40, Warrior: 33, Druid: 25, Shaman: 25, Paladin: 25 };

function strength(cls: string): string {
  if (cls === 'Warrior' || cls === 'Paladin' || cls === 'Shaman' || cls === 'Druid') {
    return `Each point gives 2 melee attack power${cls === 'Warrior' || cls === 'Paladin' ? ', plus a little block value with a shield' : ''}${cls === 'Druid' ? ' (in Cat and Bear Form)' : ''}.`;
  }
  if (cls === 'Hunter') return 'Each point gives 1 melee attack power. It does nothing for your shots, so it’s a low priority.';
  if (cls === 'Rogue') return 'Each point gives 1 attack power. Agility is better: it gives the same attack power plus crit.';
  return 'Gives a small amount of melee attack power, which you don’t use. Not useful for you.';
}

function agility(cls: string): string {
  const crit = AGI_PER_CRIT[cls as ClassName];
  const critPart = crit ? ` About ${crit} Agility gives 1% crit.` : '';
  if (cls === 'Hunter') return `Your best stat. Each point gives 1 ranged attack power and 1 melee attack power.${critPart} Also adds armor and dodge.`;
  if (cls === 'Rogue') return `Each point gives 1 attack power.${critPart} Also adds armor and dodge.`;
  if (cls === 'Druid') return `In Cat Form each point gives 1 attack power.${critPart} Also adds armor and dodge, which matters in Bear Form.`;
  if (cls === 'Warrior' || cls === 'Paladin' || cls === 'Shaman') return `Adds crit chance, armor and dodge.${critPart}`;
  return 'Adds armor and a little dodge. Not useful for your damage.';
}

function intellect(cls: string): string {
  if (cls === 'Hunter') return 'Each point gives 15 mana, so you can keep shooting longer. Marksmanship hunters with Careful Aim also gain ranged attack power from it.';
  if (cls === 'Warrior' || cls === 'Rogue') return 'Does nothing for you.';
  return 'Each point gives 15 mana and adds spell crit (about 80 Intellect for 1% at level 70).';
}

function spirit(cls: string): string {
  if (CASTERS.has(cls) || HYBRID_CASTERS.has(cls)) return 'Regenerates mana while you aren’t casting (outside the five seconds after a spell), and health out of combat.';
  return 'Regenerates health and mana out of combat. Very little value in a raid for you.';
}

const RATING: Record<string, (cls: string) => string> = {
  Strength: strength,
  Agility: agility,
  Intellect: intellect,
  Spirit: spirit,
  Stamina: () => 'Each point gives 10 health. Helps you survive damage you can’t avoid.',
  Armor: () => 'Reduces physical damage you take.',
  'Attack Power': (cls) =>
    cls === 'Hunter'
      ? 'Melee attack power: only matters for Raptor Strike and melee swings. Ranged attack power is what powers your shots.'
      : 'Increases melee damage: 14 attack power adds 1 damage per second to your weapon, and many abilities scale with it.',
  'Ranged Attack Power': () => 'Powers every shot: 14 ranged attack power adds 1 damage per second, and Steady Shot and Arcane Shot scale with it directly.',
  'Spell Power': () => 'Increases the damage (and usually healing) of your spells.',
  'Spell Damage': () => 'Increases the damage of your spells.',
  Healing: () => 'Increases the healing done by your spells.',
  Crit: (cls) =>
    CASTERS.has(cls)
      ? 'Melee and ranged crit chance. Spell crit is the one that matters for you.'
      : 'Chance for attacks to deal double damage. At level 70, about 22 crit rating gives 1%.',
  'Spell Crit': () => 'Chance for spells to deal 150% damage (or healing). At level 70, about 22 spell crit rating gives 1%.',
  Hit: (cls) =>
    CASTERS.has(cls)
      ? 'Melee and ranged hit. Spell hit is the one that matters for you.'
      : `Reduces misses. At level 70, about 16 hit rating gives 1%; around 142 rating (9%) stops ${cls === 'Hunter' ? 'shots' : 'special attacks'} missing raid bosses, minus any hit from talents.`,
  'Spell Hit': () => 'Reduces resisted spells. At level 70, about 12.6 spell hit rating gives 1%; around 202 rating (16%) caps it against raid bosses, minus any hit from talents.',
  Haste: (cls) =>
    cls === 'Hunter'
      ? 'Makes Auto Shot fire faster. At level 70, about 16 haste rating gives 1%.'
      : 'Makes you attack faster. At level 70, about 16 haste rating gives 1%.',
  'Spell Haste': () => 'Shortens cast times. At level 70, about 16 spell haste rating gives 1%.',
  Expertise: () => 'Reduces the chance your melee attacks are dodged or parried. About 4 expertise rating gives 1 expertise, and each point removes 0.25%.',
  'Armor Penetration': () => 'Ignores some of the target’s armor, so physical attacks hit harder.',
  Mp5: () => 'Mana restored every 5 seconds, even while casting.',
  Defense: () => 'Tank stat: reduces the chance to be crit, hit, and adds dodge, parry and block. Tanks need 490 defense to stop bosses critting them.',
  Dodge: () => 'Chance to dodge melee attacks.',
  Parry: () => 'Chance to parry melee attacks from the front.',
  Block: () => 'Chance to block melee attacks with a shield.',
  Resilience: () => 'Player-versus-player stat: reduces crits and damage from other players. Does nothing against bosses.',
};

/** Tooltip text for a stat, tailored to the class where it matters. Null when there's nothing useful to say. */
export function statTooltip(stat: string, className: string, withLevel70Numbers = true): string | null {
  const fn = RATING[stat] ?? RATING[stat.replace(/ Rating$/i, '')];
  if (!fn) return null;
  const text = fn(className);
  if (withLevel70Numbers) return text;
  // TESTING ONLY (Mists of Pandaria logs): the level-70 numbers would be wrong, so keep only the
  // sentences without numbers. Remove this and the parameter when raiding starts.
  const kept = text
    .split(/(?<=\.)\s+/)
    .map((s) => s.replace(/\s*\((about|around) [^)]*\d[^)]*\)/gi, ''))
    .filter((s) => !/\d/.test(s));
  return kept.join(' ').trim() || null;
}
