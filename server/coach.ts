// The site's and the Discord bot's coaching in one place: the limits that decide when something is
// worth pointing out, and the words used to say it. Every "what went well", "what to work on",
// "room to improve" and "what this means" builds its points from here, so a raider reads the same
// advice whether it comes from a DM, the officers' /performance, an analysis or a raid page.
// Safe to use in the browser too (no server-only imports).

/** When something is worth pointing out. GAME CONTENT where noted. */
export const LIMITS = {
  /** A pause in casting longer than this (seconds) counts as a gap. */
  gapSeconds: 4,
  /** Active time (damage): praised at or above, pointed out below. */
  activeGood: 95,
  activeLow: 90,
  /** Healers have quiet moments, so their bar is lower. */
  healerActiveGood: 85,
  healerActiveLow: 60,
  /** Raid-wide: a player below this much active time "spent a lot of time not attacking". */
  raidIdle: 85,
  /** Fights at least this long (seconds) need a potion; this long, a pre-pot as well. GAME CONTENT */
  potionFight: 90,
  prePotFight: 150,
  /** Damage over time that's at least this share of your damage (percent) is checked. */
  dotShare: 5,
  dotLow: 80,
  dotGood: 90,
  /** Overhealing (percent of what you cast): overall, and for one spell that's a real share of your healing. */
  overhealHigh: 45,
  overhealLow: 25,
  overhealSpell: 60,
  overhealSpellShare: 0.1,
  /** "Room to improve" (officers) looks for gains even when things are already good, so it uses the
   * "good" bars above (active time, damage over time) and this lower one for overhealing. */
  overhealPolish: 35,
  /** Misses on a spell you cast at least this often. */
  missPct: 4,
  missCasts: 10,
  /** Parses. */
  parseStrong: 75,
  parseTop: 95,
  parseWeak: 25,
  /** Your weakest boss is called out when it's this far under your average. */
  weakBossGap: 15,
} as const;

/** The advice that follows each kind of point, worded once. */
export const ADVICE = {
  active: 'Fewer gaps (casting while moving, being in place before the boss moves you) is usually the easiest damage to win back.',
  activeHealer: 'Keeping a heal-over-time or shield rolling on the tank, or adding damage in quiet moments, helps.',
  cooldowns: 'Use them at the pull and again as soon as they’re ready, unless a big damage window is due within a few seconds.',
  cooldownsLate: 'On most bosses using them at the pull gives an extra use by the end.',
  potion: (healer: boolean) => `One before the pull and one during the fight is free ${healer ? 'healing (a mana potion)' : 'damage'}.`,
  prePot: 'Drinking one just before the pull gives you a second potion in a fight this long.',
  flask: 'A flask, or a battle and guardian elixir, lasts the whole fight. `/info consumables` lists what fits each role.',
  food: 'It’s the cheapest buff there is.',
  dots: 'Refresh it just before it runs out.',
  overheal: 'Waiting a moment longer, or switching to a smaller heal, saves mana for when it’s needed.',
  overhealSpell: 'Cast it a little later, a smaller rank, or on someone lower.',
  misses: 'More hit rating turns those into damage: check whether you’re at the hit cap for boss-level targets.',
  enchants: 'Cheap, permanent damage and survival.',
  avoidable: 'Moving out sooner keeps you casting and saves your healers mana.',
  death: 'Everything after that is lost damage, so surviving comes first.',
  gaps: 'Check whether they were forced (movement, a phase change) or avoidable.',
  opener: 'A short fight, so the opener matters most: cooldowns and your strongest spells right at the pull.',
} as const;

export interface Point { title: string; detail: string }

const pc = (v: number) => `${Math.round(v)}%`;

/** "a, b and c" */
export const listed = (xs: string[]) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs.join(' and '));


/** The points themselves: a specific title, then the shared advice. */
export const say = {
  activeLow: (active: string, healer = false): Point => ({
    title: `Active ${active}`,
    detail: `Aim for ${healer ? LIMITS.healerActiveGood : LIMITS.activeGood}% or more. ${healer ? ADVICE.activeHealer : ADVICE.active}`,
  }),
  activeGood: (active: string): Point => ({ title: `Active ${active}`, detail: 'Almost no time spent not casting.' }),
  cooldownsMissed: (list: string[]): Point => ({ title: `Cooldowns left unused: ${listed(list)}`, detail: ADVICE.cooldowns }),
  cooldownsOnTime: (detail = 'Every tracked cooldown used as often as the fight allowed.'): Point => ({ title: 'Cooldowns on time', detail }),
  potionMissed: (where: string | null, healer: boolean): Point => ({ title: where ? `No potion on ${where}` : 'No potion used', detail: ADVICE.potion(healer) }),
  prePot: (): Point => ({ title: 'Potion before the pull too', detail: ADVICE.prePot }),
  flaskMissing: (where: string | null): Point => ({ title: where ? `No flask or elixir on ${where}` : 'No flask or elixir', detail: ADVICE.flask }),
  foodMissing: (where: string | null): Point => ({ title: where ? `No food buff on ${where}` : 'No food buff', detail: ADVICE.food }),
  dotsLow: (list: { name: string; up: number }[]): Point => ({
    title: list.length === 1 ? `${list[0].name} up ${pc(list[0].up)} of the time` : 'Damage over time not kept up',
    detail: `${list.length === 1 ? '' : `${list.map((d) => `${d.name} ${pc(d.up)}`).join(', ')}. `}Aim for ${LIMITS.dotGood}%+. ${ADVICE.dots}`,
  }),
  dotsGood: (list: { name: string; up: number }[]): Point => ({ title: 'Damage over time kept up', detail: `${list.map((d) => `${d.name} ${pc(d.up)}`).join(', ')}.` }),
  overhealHigh: (pct: number): Point => ({ title: `${pc(pct)} overhealing`, detail: ADVICE.overheal }),
  overhealLow: (pct: number): Point => ({ title: `Only ${pc(pct)} overhealing`, detail: 'Very little of your healing was wasted on full health bars.' }),
  overhealSpell: (name: string, pct: number, share: number): Point => ({
    title: `${name}: ${pc(pct)} overheal`,
    detail: `It’s ${pc(share * 100)} of your healing but mostly lands on people who are already full. ${ADVICE.overhealSpell}`,
  }),
  misses: (name: string, pct: number): Point => ({ title: `${pc(pct)} misses on ${name}`, detail: ADVICE.misses }),
  enchantsMissing: (slots: string[]): Point => ({ title: 'Missing enchants', detail: `No enchant on: ${slots.join(', ')}. ${ADVICE.enchants}` }),
  enchantsFull: (count?: number): Point => ({ title: 'Fully enchanted', detail: count ? `All ${count} enchantable slots have an enchant.` : 'Every slot that takes an enchant has one.' }),
  died: (title: string, what: string): Point => ({ title, detail: `${what} ${ADVICE.death}`.trim() }),
};

/** One point as a single line, for lists like the officers' "room to improve". */
export const asLine = (p: Point) => `${p.title}. ${p.detail}`;

