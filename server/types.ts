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
  /** Game icon file name from Warcraft Logs, e.g. ability_hunter_steadyshot.jpg */
  icon?: string;
}

export interface BuffRow { name: string; id: number; uptimePct: number; uses: number; icon?: string }
export interface CooldownUse { name: string; cooldownSec: number; uses: number; possible: number; times: number[]; icon?: string }
export interface Gap { start: number; end: number; seconds: number }

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
  deaths: { seconds: number; by: string }[];
  damageTaken: { name: string; total: number }[];
}

export type ComparisonKind = 'same-report' | 'chosen-player' | 'top-parse' | 'previous-kill';

/** What the user picked in the "Compare with" dropdown. */
export type CompareChoice =
  | { kind: 'auto' }
  | { kind: 'player'; playerId: number }
  | { kind: 'top' }
  | { kind: 'previous' };

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
  /** False when the comparison is a different class: only general stats are compared. */
  sameClass: boolean;
}

export interface Finding {
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface AnalysisResult {
  id?: string;
  /** Which comparison was chosen: 'auto' | 'top' | 'previous' | 'p:<player name>'. */
  compareKey?: string;
  createdAt?: string;
  player: PlayerSnapshot;
  comparisons: Comparison[];
  findings: Finding[];
  notes: string[]; // non-fatal problems (e.g. a comparison that couldn't be loaded)
}

export interface ReportSummary {
  host: string;
  code: string;
  title: string;
  fights: { id: number; name: string; encounterId: number; kill: boolean; seconds: number; startTime: number; endTime: number }[];
  players: { id: number; name: string; className: string; server: string | null }[];
  suggestedFight?: number;
  suggestedPlayer?: number;
}

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
