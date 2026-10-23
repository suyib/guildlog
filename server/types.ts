// Shared between the API and the UI (imported with `import type` in src/).

export interface AbilityRow {
  name: string;
  id: number;
  total: number;
  share: number; // 0..1 of the player's damage
  casts: number;
  hits: number;
  critPct: number | null; // 0..100
  missPct: number | null; // 0..100
  avgHit: number | null;
  isPet: boolean;
  /** Which pet did it, when known (hunter and warlock pets). */
  petName?: string;
  /** Game icon file name from Warcraft Logs, e.g. ability_hunter_steadyshot.jpg */
  icon?: string;
}

export interface BuffRow { name: string; id: number; uptimePct: number; uses: number; icon?: string }
export interface CooldownUse { name: string; cooldownSec: number; uses: number; possible: number; times: number[]; icon?: string }
export interface Gap { start: number; end: number; seconds: number }
export interface BuffWindow { name: string; start: number; end: number; kind: 'lust' | 'cooldown'; icon?: string }

export interface PlayerSnapshot {
  /** Realm name, used to look up the character portrait. */
  server?: string | null;
  host: string;
  reportCode: string;
  fightId: number;
  encounterId: number;
  encounterName: string;
  kill: boolean;
  fightSeconds: number;
  name: string;
  className: string;
  specName: string;
  dps: number;
  total: number;
  parsePercent: number | null;
  activePct: number | null;
  itemLevel: number | null;
  abilities: AbilityRow[];
  castsPerMinute: Record<string, number>;
  castCounts: Record<string, number>;
  buffs: BuffRow[];
  cooldowns: CooldownUse[];
  gaps: Gap[];
  castSeconds: number[]; // non-auto cast times, seconds from pull (for timelines)
  /** Every cast with its name, auto attacks marked, for the timeline (missing on analyses saved before v0.11.2). */
  casts?: { t: number; name: string; auto?: boolean }[];
  /** When Bloodlust/Heroism and your own big cooldowns were up, seconds from pull. */
  windows?: BuffWindow[];
  deaths: { seconds: number; by: string }[];
  damageTaken: { name: string; total: number }[];
  /** Healing for the fight (no over-time line), so healers can be compared on healing. Missing before v0.17.0. */
  healing?: Healing;
}

export type ComparisonKind = 'chosen-player' | 'other-log';

/** What the user picked in the "Compare with" dropdown. */
export type CompareChoice =
  | { kind: 'none' }
  /** Someone in the same fight. */
  | { kind: 'player'; playerId: number }
  /** Someone in a different report: you pick the log, fight and player. */
  | { kind: 'log'; host: string; code: string; fight: FightRef; actor: ActorRef };

/** Just enough about a fight to fetch a player's data without re-reading the whole report. */
export interface FightRef { id: number; encounterID: number; name: string; startTime: number; endTime: number; kill: boolean }
export interface ActorRef { id: number; name: string; className: string }

/** One player's fight-wide numbers, fetched once per fight for everyone (damage table + rankings + details). */
export interface FightPlayerRow {
  id: number;
  name: string;
  className: string;
  specName: string;
  icon: string;
  total: number;
  activeTime: number | null;
  rankPercent: number | null;
  itemLevel: number | null;
  server: string | null;
}

/** A player whose snapshot the browser should fetch as a comparison. */
export interface SnapshotTarget { kind: ComparisonKind; label: string; host: string; code: string; fight: FightRef; actor: ActorRef; sameClass: boolean; row?: FightPlayerRow }

export interface Comparison {
  kind: ComparisonKind;
  label: string;
  snapshot: PlayerSnapshot;
  /** False when the comparison is a different class or spec (say Balance vs Feral): only general stats are compared. */
  sameClass: boolean;
}

/** Something that went well (the positive counterpart to a Finding). */
export interface Strength {
  title: string;
  detail: string;
}

export interface Finding {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface GearItem {
  slot: number;
  slotName: string;
  id: number;
  name: string | null;
  icon: string | null;
  itemLevel: number | null;
  /** 0 poor … 5 legendary */
  quality: number | null;
  enchant: string | null;
  enchantId: number | null;
  /** Whether this slot normally takes a permanent enchant. */
  enchantable: boolean;
  gems: { id: number; icon: string | null; itemLevel: number | null }[];
}

/** Extra personal data shown when nothing is compared ("Just my stats"). */
/** One point on a chart over the fight: seconds from the pull, a per-second value, and an optional note for the tooltip. */
export interface SeriesPoint { t: number; dps: number; note?: string }

export interface HealingAbility {
  name: string;
  id: number;
  /** Healing that landed (overheal not included). */
  total: number;
  share: number; // 0..1 of the player's healing
  overheal: number;
  overhealPct: number | null; // 0..100 of everything the spell tried to heal
  casts: number;
  hits: number;
  critPct: number | null;
  avgHeal: number | null;
  isPet: boolean;
  petName?: string;
  icon?: string;
}

/** The player's healing for the fight, shown on the Healing tab. */
export interface Healing {
  total: number;
  hps: number;
  overheal: number;
  overhealPct: number | null;
  /** Healing parse (percentile for the spec), when Warcraft Logs ranks it. */
  parse: number | null;
  activePct: number | null;
  /** Place among the raid's healers by healing done. */
  rank: { place: number; of: number } | null;
  abilities: HealingAbility[];
  /** Healing per second across the fight. */
  hpsSeries: SeriesPoint[];
}

export interface Dashboard {
  gear: GearItem[];
  stats: { name: string; value: string }[];
  /** DPS across the fight, seconds from the pull. */
  dpsSeries: SeriesPoint[];
  /** Healing done (missing on analyses saved before v0.16.0). */
  healing?: Healing;
  /** Damage taken per second across the fight, with what hit hardest each moment. */
  takenSeries?: SeriesPoint[];
  /** Damage taken against the rest of the raid (missing when Warcraft Logs doesn't break it down). */
  survival?: Survival;
}

export interface Survival {
  total: number;
  /** Damage from abilities that hit fewer than half of the non-tanks. */
  avoidableTotal: number;
  /** Median damage taken by the raid (other tanks if you're a tank, everyone else if not). */
  raidMedianTotal: number;
  /** 1 = took the least damage among the players compared. */
  rank: number;
  compared: number;
  isTank: boolean;
  abilities: {
    name: string;
    icon?: string;
    total: number;
    playersHit: number;
    raidSize: number;
    /** Median damage from this ability among the players it hit. */
    raidMedian: number;
    avoidable: boolean;
  }[];
}

export interface AnalysisResult {
  /** Present for "Just my stats" analyses. */
  dashboard?: Dashboard;
  id?: string;
  /** Which comparison was chosen: 'none', 'p:<player name>' or 'l:<host>:<code>:<fight>:<player name>'. */
  compareKey?: string;
  createdAt?: string;
  player: PlayerSnapshot;
  comparisons: Comparison[];
  findings: Finding[];
  /** What went well. Missing on analyses saved before v0.7.0. */
  strengths?: Strength[];
  notes: string[]; // non-fatal problems (e.g. a comparison that couldn't be loaded)
}

export interface ReportSummary {
  host: string;
  code: string;
  title: string;
  /** When the log started, ms since epoch. */
  startTime?: number;
  /** playerIds: who was in that fight (empty when Warcraft Logs doesn't say, so everyone is shown). */
  fights: { id: number; name: string; encounterId: number; kill: boolean; seconds: number; startTime: number; endTime: number; playerIds: number[] }[];
  players: { id: number; name: string; className: string; server: string | null }[];
  suggestedFight?: number;
  suggestedPlayer?: number;
  /** Set when Warcraft Logs was unavailable and this came from the saved copy of the raid. */
  offline?: Offline;
}

/** A saved copy was used because Warcraft Logs didn't answer. */
export interface Offline { savedAt: string }

/** One raid night at a glance, for the Past raids calendar (built from the saved raid). */
export interface RaidCard {
  bosses: { name: string; encounterId: number; fightId: number | null; kill: boolean; seconds: number | null; wipes: number }[];
  /** From the first pull to the end of the last boss fight. */
  raidSeconds: number;
  wipes: number;
  /** Deaths on kills. */
  deaths: number;
  avgItemLevel: number | null;
  /** Everyone in at least one boss fight. bosses: how many of the kills they were in. */
  raiders: { name: string; className: string; specName: string; role: 'tank' | 'healer' | 'dps' | null; bosses: number }[];
  kills: number;
  feedback: RaidFeedback;
}

/** A raid on the Past raids page. */
export interface SavedRaid {
  code: string;
  host: string;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  loggerName: string | null;
  source: 'discord' | 'site' | 'auto';
  /** queued: waiting; saving: in progress; saved: everything stored; partial: some parts couldn't be read; empty: no boss fights. */
  status: 'queued' | 'saving' | 'saved' | 'partial' | 'empty';
  saved: number;
  total: number;
  card: RaidCard | null;
}

export interface RaidsList { raids: SavedRaid[]; archiveDays: number }

export interface HistoryRow {
  id: string;
  created_at: string;
  report_code: string;
  fight_id: number;
  encounter_name: string;
  player_name: string;
  class_name: string;
  spec_name: string;
  dps: number;
  parse_percent: number | null;
  compare_key: string;
}

/** Whole-raid breakdown of one fight (no player chosen). */
export interface FightBreakdown {
  fight: { id: number; name: string; kill: boolean; seconds: number; encounterID: number };
  totals: { damage: number; dps: number; healing: number; hps: number; taken: number; deaths: number; raidSize: number; avgItemLevel: number | null };
  players: {
    id: number;
    name: string;
    className: string;
    specName: string;
    role: 'tank' | 'healer' | 'dps';
    total: number;
    dps: number;
    /** Damage parse, or healing parse for healers. */
    parse: number | null;
    itemLevel: number | null;
    activePct: number | null;
    healing: number;
    hps: number;
    overhealPct: number | null;
    taken: number;
    avoidable: number;
    deaths: number;
    interrupts: number;
    dispels: number;
  }[];
  deaths: { seconds: number; name: string; className: string; by: string }[];
  takenByAbility: { name: string; icon?: string; total: number; playersHit: number; avoidable: boolean }[];
  bloodlust: { seconds: number; by: string; name: string }[];
  /** Raid DPS across the fight, seconds from the pull (empty if Warcraft Logs didn't return a graph). */
  dpsSeries: { t: number; dps: number }[];
  /** Plain-language "what went well / what to work on" for the whole raid. */
  feedback: RaidFeedback;
  offline?: Offline;
}

export interface RaidPoint {
  title: string;
  detail: string;
  /** Who earned it (praise only). Shown on the site; left out of Discord channel posts. */
  who?: string[];
}

export interface RaidFeedback { good: RaidPoint[]; work: RaidPoint[] }

// ---------- Admin ----------

export interface AdminUser {
  discord_id: string;
  username: string;
  name: string;
  avatar: string | null;
  guild_id: string | null;
  guild_name: string | null;
  officer: boolean;
  first_seen: string;
  last_seen: string;
  sign_ins: number;
}

export interface AdminSignIn {
  id: string;
  at: string;
  kind: 'discord' | 'password';
  result: 'ok' | 'not_member' | 'wrong_password' | 'error';
  discord_id: string | null;
  username: string | null;
  guild_id: string | null;
  guild_name: string | null;
  detail: string | null;
}

export interface AdminOverview {
  users: AdminUser[];
  signIns: AdminSignIn[];
  /** Bot use by Discord account: when they first claimed a character, and their characters. */
  bot: Record<string, { name: string; firstClaim: string; characters: { name: string; realm: string | null; status: string }[] }>;
  signInLogDays: number;
}
