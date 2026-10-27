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
  /** Highest parse. */
  best: number | null;
  deaths: number;
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

const COLS = 'report_code,start_time,encounter_name,name,class_name,spec_name,role,healer,parse,hps_parse,deaths,item_level';

/** Everyone's kills over the range (or in one stored raid), from kill_stats. */
export async function performanceRows(range: PerfRange | { code: string }): Promise<Row[]> {
  if (!dbEnabled()) return [];
  let code = typeof range === 'object' ? range.code : null;
  if (range === 'raid') {
    const last: { report_code: string }[] = (await rest('kill_stats?select=report_code&order=start_time.desc&limit=1')) ?? [];
    code = last[0]?.report_code ?? null;
    if (!code) return [];
  }
  if (code) return (await rest(`kill_stats?report_code=eq.${q(code)}&select=${COLS}&order=start_time.asc&limit=2000`)) ?? [];
  const since = new Date(Date.now() - (range === '4w' ? 4 : 8) * 7 * 86_400_000).toISOString();
  return (await rest(`kill_stats?start_time=gte.${q(since)}&select=${COLS}&order=start_time.asc&limit=10000`)) ?? [];
}

export async function performance(range: PerfRange): Promise<PerfData> {
  return summarize(await performanceRows(range), RANGE_SCOPE[range].minKills);
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
      best: parses.length ? Math.round(Math.max(...parses)) : null,
      deaths: list.reduce((t, r) => t + (r.deaths ?? 0), 0),
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
    why.push(`${p.kills > 1 ? 'average ' : ''}${p.role === 'healer' ? 'healing ' : ''}parse ${p.parse}${p.kills > 1 && p.best !== null ? ` (highest ${p.best})` : ''}`);
    help.push(p.role === 'healer'
      ? 'look at overhealing and spell choice in their Damage breakdown (healing view); check whether they had a tank or raid assignment'
      : 'look at Active time and Rotation & cooldowns on their fights: gaps with nothing cast and unused cooldowns are the usual cause');
  }
  if (p.deathsPerKill >= DEATHS_LOW) {
    why.push(died(p));
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

/** "died 2 times in 3 kills" */
const died = (p: PerfPlayer) => `died ${p.deaths === 1 ? 'once' : `${p.deaths} times`} in ${p.kills} kill${p.kills === 1 ? '' : 's'}`;

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
  // Doing well: their parses and any deaths. Could use a hand: the reasons say it all.
  const parseText = (p: PerfPlayer) => (p.kills > 1 ? `average parse ${p.parse} (highest ${p.best})` : `parse ${p.parse}`);
  const line = (p: PerfPlayer) => `**${p.name}** (${p.spec}) \u00b7 ${parseText(p)}${p.deaths ? ` \u00b7 ${died(p)}` : ''}`;
  const lowLine = (p: PerfPlayer) => `**${p.name}** (${p.spec})${p.parse !== null && p.parse >= LOW ? ` \u00b7 ${parseText(p)}` : ''}`;

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
        { name: `Doing well (${scope.minKills > 1 || kills > 1 ? 'average ' : ''}parse ${HIGH}+, few deaths)`, value: clip(high.length ? high.map(line).join('\n') : 'Nobody averaged a parse of ' + HIGH + ' or more. The best: ' + [...ranked].sort((a, b) => b.parse! - a.parse!).slice(0, 3).map((p) => `${p.name} (${parseText(p)})`).join(', ') + '.') },
        { name: 'Could use a hand', value: clip(low.length ? low.map((x) => `${lowLine(x.p)}\n> ${x.why.join('; ')}\n> Try: ${x.help.join('; ')}.`).join('\n') : 'Nobody stands out: parses, deaths and item level all look fine.') },
      ],
    },
  ];
  if (watch.length) embeds.push({ title: 'Things to watch for', color: BRAND, description: clip(watch.map((w) => `• ${w}`).join('\n'), 4000) });
  embeds.push({
    title: 'Keeping track',
    color: BRAND,
    description: clip([
      `• **Average parse over 4+ weeks**, not one night. Around 50 is typical; ${HIGH}+ is strong. Run \`/performance range:4 weeks\` every couple of raids and compare.`,
      '• **Deaths**: dying no more than once every four kills is good. Deaths cost more damage than almost anything else.',
      '• **Trend**: each player’s profile and `/check` show their parse over the last 8 weeks, so improvement is easy to see.',
      '• **Against the guild**: on the site, each fight compares them with the guild’s own kills in the same spec.',
      `• Set one clear goal per person (e.g. “no more than one death a raid” or “Active time over 90%”) and check it after two raids. Full details: ${site}`,
    ].join('\n'), 4000),
    footer: CAVEAT,
  });
  return { embeds };
}

const CAVEAT = { text: 'Just an overview: the numbers can\u2019t see extra mechanics, assignments, kiting, interrupts, buffs or other utility someone was doing, so talk to them before drawing conclusions.' };

/** One character's breakdown, in the same shape as the raid overview: boss by boss. */
export function characterMessage(scope: PerfScope, rows: Row[], character: string, site: string): MessageBody {
  const key = character.trim().toLowerCase();
  const mine = rows.filter((r) => r.name.toLowerCase() === key);
  if (!mine.length) {
    return { embeds: [{ title: `Performance: ${character}`.slice(0, 256), color: BRAND, description: `${character} isn\u2019t in any boss kill read for ${scope.label}. Check the spelling, or pick them from the list.` }] };
  }
  const raid = summarize(rows, 1);
  const p = summarize(mine, 1).players[0];
  const healer = p.role === 'healer';
  const parseOf = (r: Row) => (p.role === 'tank' ? null : healer ? r.hps_parse : r.parse);
  // Same role in the raid, to compare with
  const peers = raid.players.filter((x) => x.role === p.role && x.parse !== null && x.name !== p.name);
  const peerAvg = avg(peers.map((x) => x.parse!));

  const good: string[] = [];
  const work: string[] = [];
  const tips = new Set<string>();
  for (const r of mine) {
    const v = parseOf(r);
    const parts = [v !== null && v !== undefined ? `parse ${Math.round(Number(v))}` : null, r.deaths ? (r.deaths === 1 ? 'died once' : `died ${r.deaths} times`) : null].filter(Boolean);
    const text = `**${r.encounter_name}**${parts.length ? ` \u00b7 ${parts.join(' \u00b7 ')}` : ''}`;
    const low = v !== null && v !== undefined && Number(v) < LOW;
    if (low || r.deaths) {
      work.push(text);
      if (low) tips.add(healer ? 'look at overhealing and spell choice in the healing view; check whether they had a tank or raid assignment' : 'look at Active time and Rotation & cooldowns: gaps with nothing cast and unused cooldowns are the usual cause');
      if (r.deaths) tips.add('go through the death recaps on Survival: what hit them in the last 10 seconds, and whether a defensive or healthstone was used');
    } else if (v === null || v === undefined || Number(v) >= HIGH) good.push(text);
  }

  const { why, help } = concerns(p, raid.itemLevel);
  const watch: string[] = [];
  for (const w of why.filter((w) => /item level|vary/.test(w))) watch.push(w.charAt(0).toUpperCase() + w.slice(1) + '.');
  for (const h of help.filter((h) => /gear|compare/.test(h))) tips.add(h);
  if (p.parse !== null && peerAvg !== null && peers.length) watch.push(`The raid\u2019s other ${healer ? 'healers' : 'damage dealers'} averaged a parse of ${Math.round(peerAvg)}; ${p.name}: ${p.parse}.`);
  if (p.role === 'tank') watch.push('Tanks are judged on deaths and item level here: parses say little about tanking.');
  if (scope.oneNight) watch.push('This is one night. Picking `range:4 weeks` with their name gives a fairer picture.');

  const parseText = p.parse === null ? 'tank' : p.kills > 1 ? `average parse ${p.parse} (highest ${p.best})` : `parse ${p.parse}`;
  const embeds: Embed[] = [
    {
      title: `Performance: ${p.name} \u00b7 ${scope.label}`.slice(0, 256),
      color: BRAND,
      description: `${p.spec} \u00b7 ${parseText} \u00b7 ${p.deaths ? died(p) : `no deaths in ${p.kills} kill${p.kills === 1 ? '' : 's'}`}${p.itemLevel ? ` \u00b7 item level ${p.itemLevel}${raid.itemLevel ? ` (raid ${raid.itemLevel})` : ''}` : ''}. For officers only: please don\u2019t share this in channels.`,
      fields: [
        { name: `Doing well (parse ${HIGH}+, no deaths)`, value: clip(good.length ? good.join('\n') : 'No boss stood out yet.') },
        { name: 'Could use a hand', value: clip(work.length ? `${work.join('\n')}\n> Try: ${[...tips].join('; ')}.` : tips.size ? `> Try: ${[...tips].join('; ')}.` : 'Nothing stands out: parses and deaths look fine.') },
      ],
    },
  ];
  if (watch.length) embeds.push({ title: 'Things to watch for', color: BRAND, description: clip(watch.map((w) => `\u2022 ${w}`).join('\n'), 4000) });
  embeds.push({
    title: 'Keeping track',
    color: BRAND,
    description: clip([
      `\u2022 **Average parse over 4+ weeks**, not one night. Around 50 is typical; ${HIGH}+ is strong. \`/performance range:4 weeks character:${p.name}\` shows the longer view.`,
      '\u2022 **Deaths**: dying no more than once every four kills is good.',
      `\u2022 **Trend**: \`/check ${p.name}\` and their profile show their parse over the last 8 weeks.`,
      '\u2022 **Against the guild**: on the site, each of their fights compares them with the guild\u2019s own kills in the same spec.',
      `\u2022 Agree one clear goal with them (e.g. \u201cno more than one death a raid\u201d or \u201cActive time over 90%\u201d) and check it after two raids. Full details: ${site}`,
    ].join('\n'), 4000),
    footer: CAVEAT,
  });
  return { embeds };
}
