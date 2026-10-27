// /performance (officers, by DM): who's doing well and who could use a hand, from the guild's kills
// in Past raids (kill_stats), with what to watch for, how to help, and how to keep track. Tanks are
// judged on deaths and item level only, as parses say little about tanking.
import { dbEnabled, rest } from '../db.js';
import { type FightDigest, healsMost } from '../fightDigest.js';
import { BRAND, type Embed, type MessageBody } from './api.js';

export type PerfRange = 'raid' | '4w' | '8w';
/** What's being looked at: its name, whether it's a single night (or fight), and the kills a player needs. */
export interface PerfScope { label: string; oneNight: boolean; minKills: number }
export const RANGE_SCOPE: Record<PerfRange, PerfScope> = {
  raid: { label: 'the last raid', oneNight: true, minKills: 2 },
  '4w': { label: 'the last 4 weeks', oneNight: false, minKills: 2 },
  '8w': { label: 'the last 8 weeks', oneNight: false, minKills: 2 },
};

export interface Row {
  report_code: string;
  start_time: string;
  encounter_name: string;
  name: string;
  class_name: string;
  spec_name: string;
  role: string | null;
  healer: boolean;
  parse: number | null;
  hps_parse: number | null;
  deaths: number;
  item_level: number | null;
}

export interface PerfPlayer {
  name: string;
  spec: string;
  role: 'tank' | 'healer' | 'dps';
  kills: number;
  /** Average parse (healing parse for healers); null for tanks or with no parses. */
  parse: number | null;
  /** Spread between best and worst parse. */
  spread: number | null;
  deathsPerKill: number;
  itemLevel: number | null;
}

/** Thresholds, in one place so they're easy to tune. */
const HIGH = 75;
const LOW = 35;
const DEATHS_LOW = 0.5; // deaths per kill
const SHOW = 6;

const q = encodeURIComponent;
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
const round = (v: number | null) => (v === null ? null : Math.round(v));

/** Everyone's numbers over the range, from kill_stats. */
export type PerfData = ReturnType<typeof summarize>;

export async function performance(range: PerfRange): Promise<PerfData> {
  const empty: PerfData = { players: [], kills: 0, raids: 0, bossDeaths: [], itemLevel: null, skipped: 0 };
  if (!dbEnabled()) return empty;
  const cols = 'report_code,start_time,encounter_name,name,class_name,spec_name,role,healer,parse,hps_parse,deaths,item_level';
  let rows: Row[];
  if (range === 'raid') {
    const last: { report_code: string }[] = (await rest('kill_stats?select=report_code&order=start_time.desc&limit=1')) ?? [];
    if (!last.length) return empty;
    rows = (await rest(`kill_stats?report_code=eq.${q(last[0].report_code)}&select=${cols}&limit=2000`)) ?? [];
  } else {
    const since = new Date(Date.now() - (range === '4w' ? 4 : 8) * 7 * 86_400_000).toISOString();
    rows = (await rest(`kill_stats?start_time=gte.${q(since)}&select=${cols}&order=start_time.asc&limit=10000`)) ?? [];
  }
  return summarize(rows, RANGE_SCOPE[range].minKills);
}

/** The same rows from a report's fight summaries (a pasted link; one fight if it names one). */
export function rowsFromDigests(code: string, startTime: number, fights: FightDigest[]): Row[] {
  return fights.filter((f) => f.kill).flatMap((f) => f.players.map((p) => ({
    report_code: code,
    start_time: new Date(startTime + f.startTime).toISOString(),
    encounter_name: f.name,
    name: p.name,
    class_name: p.className,
    spec_name: p.specName,
    role: p.role,
    healer: healsMost(p),
    parse: p.parse,
    hps_parse: p.healing?.parse ?? null,
    deaths: p.deaths.length,
    item_level: p.itemLevel,
  })));
}

export function summarize(rows: Row[], minKills = 2) {
  const byName = new Map<string, Row[]>();
  for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const kills = new Set(rows.map((r) => `${r.report_code}:${r.encounter_name}:${r.start_time}`)).size;
  const raids = new Set(rows.map((r) => r.report_code)).size;
  const bossDeaths = new Map<string, number>();
  for (const r of rows) if (r.deaths) bossDeaths.set(r.encounter_name, (bossDeaths.get(r.encounter_name) ?? 0) + r.deaths);

  const players: PerfPlayer[] = [];
  let skipped = 0;
  for (const [name, list] of byName) {
    if (list.length < minKills) {
      skipped++;
      continue;
    }
    const last = list[list.length - 1];
    const role: PerfPlayer['role'] = list.some((r) => r.healer) || last.role === 'healer' ? 'healer' : last.role === 'tank' ? 'tank' : 'dps';
    const parses = role === 'tank' ? [] : list.map((r) => (role === 'healer' ? r.hps_parse : r.parse)).filter((v): v is number => v !== null).map(Number);
    const ilvls = list.map((r) => r.item_level).filter((v): v is number => !!v).map(Number);
    players.push({
      name,
      spec: `${(last.spec_name || '').replace(/([a-z])([A-Z])/g, '$1 $2')} ${last.class_name}`.trim(),
      role,
      kills: list.length,
      parse: round(avg(parses)),
      spread: parses.length > 1 ? Math.round(Math.max(...parses) - Math.min(...parses)) : null,
      deathsPerKill: list.reduce((t, r) => t + (r.deaths ?? 0), 0) / list.length,
      itemLevel: ilvls.length ? Math.round(ilvls[ilvls.length - 1] * 10) / 10 : null,
    });
  }
  const itemLevel = avg(players.map((p) => p.itemLevel).filter((v): v is number => v !== null));
  return { players, kills, raids, bossDeaths: [...bossDeaths].sort((a, b) => b[1] - a[1]), itemLevel: itemLevel === null ? null : Math.round(itemLevel * 10) / 10, skipped };
}

/** Why someone's on the "could use a hand" list, and what would help. */
function concerns(p: PerfPlayer, raidIlvl: number | null): { why: string[]; help: string[] } {
  const why: string[] = [];
  const help: string[] = [];
  if (p.parse !== null && p.parse < LOW) {
    why.push(`average ${p.role === 'healer' ? 'healing ' : ''}parse ${p.parse}`);
    help.push(p.role === 'healer'
      ? 'look at overhealing and spell choice in their Damage breakdown (healing view); check whether they had a tank or raid assignment'
      : 'look at Active time and Rotation & cooldowns on their fights: gaps with nothing cast and unused cooldowns are the usual cause');
  }
  if (p.deathsPerKill >= DEATHS_LOW) {
    why.push(`${p.deathsPerKill.toFixed(1)} deaths per kill`);
    help.push('go through the death recaps on Survival together: what hit them in the last 10 seconds, and whether a defensive or healthstone was used');
  }
  const gap = raidIlvl && p.itemLevel ? raidIlvl - p.itemLevel : 0;
  if (raidIlvl && gap >= Math.max(3, raidIlvl * 0.03)) {
    why.push(`item level ${p.itemLevel} (raid ${raidIlvl})`);
    // GAME CONTENT: TBC upgrade sources
    help.push('gear is holding them back: point them at upgrades (badges, crafted, reputation) and consider them for loot');
  }
  if (p.spread !== null && p.spread >= 50 && p.parse !== null && p.parse < 60) {
    why.push(`parses vary a lot (${p.spread} points between best and worst)`);
    help.push('compare their best and worst kill of the same boss on the site to see what changed');
  }
  return { why, help };
}

const clip = (s: string, max = 1024) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The DM for an officer. */
export function performanceMessage(scope: PerfScope, data: PerfData, site: string): MessageBody {
  const { players, kills, raids, bossDeaths, itemLevel, skipped } = data;
  if (!players.length) {
    return { embeds: [{ title: 'Raid performance', color: BRAND, description: `Not enough kills read in ${scope.label} yet${scope.minKills > 1 ? ` (each player needs at least ${scope.minKills})` : ''}. Raids are read after \`/raidend\`, or from Past raids on the site.` }] };
  }
  const ranked = players.filter((p) => p.parse !== null);
  const high = ranked.filter((p) => p.parse! >= HIGH && p.deathsPerKill < DEATHS_LOW).sort((a, b) => b.parse! - a.parse!).slice(0, SHOW);
  const low = players
    .map((p) => ({ p, ...concerns(p, itemLevel) }))
    .filter((x) => x.why.length)
    .sort((a, b) => b.why.length - a.why.length || (a.p.parse ?? 100) - (b.p.parse ?? 100))
    .slice(0, SHOW);
  const line = (p: PerfPlayer) => `**${p.name}** (${p.spec}) · ${p.parse !== null ? `parse ${p.parse}` : 'tank'} · ${p.kills} kill${p.kills === 1 ? '' : 's'}${p.deathsPerKill ? ` · ${p.deathsPerKill.toFixed(1)} deaths/kill` : ''}`;

  const watch: string[] = [];
  if (bossDeaths[0] && bossDeaths[0][1] >= 3) watch.push(`Most deaths on **${bossDeaths[0][0]}** (${bossDeaths[0][1]}${bossDeaths[1] ? `; then ${bossDeaths[1][0]}, ${bossDeaths[1][1]}` : ''}). Worth a quick talk about that fight’s mechanics.`);
  const tanks = players.filter((p) => p.role === 'tank' && p.deathsPerKill >= DEATHS_LOW);
  if (tanks.length) watch.push(`Tank deaths: ${tanks.map((t) => t.name).join(', ')}. Check whether healers were assigned and cooldowns were called.`);
  const healers = players.filter((p) => p.role === 'healer');
  if (healers.length && healers.every((h) => (h.parse ?? 100) < 50)) watch.push('All healers parsed low. That often just means the raid took little damage, not that they healed badly.');
  if (skipped) watch.push(`${skipped} player${skipped === 1 ? '' : 's'} with only one kill ${skipped === 1 ? 'was' : 'were'} left out: one fight isn’t enough to judge.`);
  if (scope.oneNight) watch.push('This is one night. A single raid can be off for many reasons; `/performance range:4 weeks` gives a fairer picture.');

  const embeds: Embed[] = [
    {
      title: `Raid performance: ${scope.label}`.slice(0, 256),
      color: BRAND,
      description: `${raids} raid${raids === 1 ? '' : 's'}, ${kills} boss kill${kills === 1 ? '' : 's'}, ${players.length} players${itemLevel ? `, average item level ${itemLevel}` : ''}. For officers only: please don’t share this in channels.`,
      fields: [
        { name: `Doing well (parse ${HIGH}+, few deaths)`, value: clip(high.length ? high.map(line).join('\n') : 'Nobody averaged a parse of ' + HIGH + ' or more. The best: ' + [...ranked].sort((a, b) => b.parse! - a.parse!).slice(0, 3).map((p) => `${p.name} (${p.parse})`).join(', ') + '.') },
        { name: 'Could use a hand', value: clip(low.length ? low.map((x) => `${line(x.p)}\n> ${x.why.join('; ')}\n> Try: ${x.help.join('; ')}.`).join('\n') : 'Nobody stands out: parses, deaths and item level all look fine.') },
      ],
    },
  ];
  if (watch.length) embeds.push({ title: 'Things to watch for', color: BRAND, description: clip(watch.map((w) => `• ${w}`).join('\n'), 4000) });
  embeds.push({
    title: 'Keeping track',
    color: BRAND,
    description: clip([
      `• **Average parse over 4+ weeks**, not one night. Around 50 is typical; ${HIGH}+ is strong. Run \`/performance range:4 weeks\` every couple of raids and compare.`,
      '• **Deaths per kill**: under 0.25 is good. Deaths cost more damage than almost anything else.',
      '• **Trend**: each player’s profile and `/check` show their parse over the last 8 weeks, so improvement is easy to see.',
      '• **Against the guild**: on the site, each fight compares them with the guild’s own kills in the same spec.',
      `• Set one clear goal per person (e.g. “no more than one death a raid” or “Active time over 90%”) and check it after two raids. Full details: ${site}`,
    ].join('\n'), 4000),
    footer: { text: 'Just an overview: the numbers can’t see extra mechanics, assignments, kiting, interrupts, buffs or other utility someone was doing, so talk to them before drawing conclusions.' },
  });
  return { embeds };
}
