// Fight packs: one read of a boss fight from Warcraft Logs, stored, and everything worked out from it.
// Warcraft Logs and the database are both faked here.
import assert from 'node:assert/strict';
import { breakdownFromPack } from '../server/breakdown';
import { dashboardFromPack } from '../server/dashboard';
import { raidDigest } from '../server/discord/digest';
import { personalPage, raidSummary } from '../server/discord/pages';
import { overallRaid } from '../server/overall';
import { getMeta, getPack, readPack, reportRegion, storedDigests, trimPack } from '../server/pack';
import { rowsFromPack, snapshotFromPack } from '../server/pipeline';
import { checkRaid, deleteRaid, registerRaid } from '../server/archive';
import { buildFindings, buildStrengths } from '../server/analysis';
import { guildContext, recordKills, trendFor } from '../server/benchmarks';
import { finish } from '../server/pipeline';

const HOST = 'fresh.warcraftlogs.com';
const CODE = 'PackTest1';
const START = 1_000_000; // the fight's start, ms into the log
const END = START + 120_000;
const fightRef = { id: 3, encounterID: 649, name: 'Gruul', startTime: START, endTime: END, kill: true };

// ---------- A fake Warcraft Logs ----------
const meta = {
  code: CODE, title: 'Gruul night', startTime: Date.now() - 30 * 60_000 /* still being logged */, zone: { id: 1, name: 'Gruul' }, region: { slug: 'EU' },
  fights: [{ ...fightRef, size: 25, difficulty: 3, friendlyPlayers: [1, 2, 3, 4] }],
  masterData: { actors: [
    { id: 1, name: 'Suy', type: 'Player', subType: 'Hunter', petOwner: null, server: 'Spineshatter' },
    { id: 2, name: 'Healz', type: 'Player', subType: 'Priest', petOwner: null, server: 'Spineshatter' },
    { id: 3, name: 'Tanky', type: 'Player', subType: 'Warrior', petOwner: null, server: 'Spineshatter' },
    { id: 4, name: 'Shammy', type: 'Player', subType: 'Shaman', petOwner: null, server: 'Spineshatter' },
    { id: 50, name: 'Silah', type: 'Pet', subType: 'Pet', petOwner: 1 },
    { id: 90, name: 'Gruul', type: 'NPC', subType: 'Boss', petOwner: null },
  ] },
};
const ability = (id: number, name: string) => ({ gameID: id, name, icon: `${name.toLowerCase().replace(/ /g, '_')}.jpg` });
const abilities = [ability(34120, 'Steady Shot'), ability(75, 'Auto Shot'), ability(1, 'Melee'), ability(25213, 'Greater Heal'), ability(25222, 'Renew'), ability(16, 'Gruul Slam'), ability(99, 'Cave In'), ability(2825, 'Bloodlust'), ability(3045, 'Rapid Fire'), ability(17, 'Bite'), ability(27016, 'Serpent Sting'), ability(28507, 'Haste')];

const ev: Record<string, any[]> = { DamageDone: [], Healing: [], DamageTaken: [], Casts: [] };
for (let s = 0; s < 120; s++) {
  const t = START + s * 1000;
  // Suy: a Steady Shot every 2s (one in 4 crits, one miss), an Auto Shot swing every second; the pet bites
  if (s % 2 === 0) {
    ev.Casts.push({ timestamp: t, type: 'cast', sourceID: 1, abilityGameID: 34120 });
    ev.DamageDone.push(s === 10 ? { timestamp: t + 300, type: 'damage', sourceID: 1, targetID: 90, abilityGameID: 34120, hitType: 0, amount: 0 }
      : { timestamp: t + 300, type: 'damage', sourceID: 1, targetID: 90, abilityGameID: 34120, hitType: s % 8 === 0 ? 2 : 1, amount: 1000 });
  }
  ev.DamageDone.push({ timestamp: t + 500, type: 'damage', sourceID: 1, targetID: 90, abilityGameID: 75, hitType: 1, amount: 500 });
  ev.DamageDone.push({ timestamp: t + 600, type: 'damage', sourceID: 50, targetID: 90, abilityGameID: 17, hitType: 1, amount: 200 });
  if (s % 4 === 0) ev.Casts.push({ timestamp: t + 600, type: 'cast', sourceID: 50, abilityGameID: 17 });
  // Tanky swings; Gruul hits Tanky, and Cave In lands on Suy at 30s
  ev.DamageDone.push({ timestamp: t + 100, type: 'damage', sourceID: 3, targetID: 90, abilityGameID: 1, hitType: 1, amount: 300, absorbed: 0 });
  ev.DamageTaken.push({ timestamp: t + 200, type: 'damage', sourceID: 90, targetID: 3, abilityGameID: 16, hitType: 1, amount: 2000, absorbed: 500 });
  // Healz: Greater Heal every 3s (overhealing a bit), Renew ticks every second
  // Suy's Serpent Sting ticks every 3s for the first minute only (about half the fight)
  if (s % 3 === 0 && s < 60) ev.DamageDone.push({ timestamp: t + 50, type: 'damage', sourceID: 1, targetID: 90, abilityGameID: 27016, hitType: 1, amount: 600, tick: true });
  // Gruul swings at Tanky every 2s: some dodged, parried, blocked, and a few crits
  if (s % 2 === 0) {
    const k = (s / 2) % 10;
    ev.DamageTaken.push({ timestamp: t + 900, type: 'damage', sourceID: 90, targetID: 3, abilityGameID: 1, hitType: k === 0 ? 7 : k === 1 ? 8 : k === 2 ? 2 : 1, amount: k < 2 ? 0 : 1500, ...(k === 4 ? { blocked: 300 } : {}) });
  }
  if (s % 3 === 0) {
    ev.Casts.push({ timestamp: t, type: 'cast', sourceID: 2, abilityGameID: 25213 });
    ev.Healing.push({ timestamp: t + 1500, type: 'heal', sourceID: 2, targetID: 3, abilityGameID: 25213, hitType: 1, amount: 3000, overheal: 1000 });
  }
  ev.Healing.push({ timestamp: t + 700, type: 'heal', sourceID: 2, targetID: 3, abilityGameID: 25222, hitType: 1, amount: 400, tick: true });
}
ev.DamageTaken.push({ timestamp: START + 30_200, type: 'damage', sourceID: 90, targetID: 1, abilityGameID: 99, hitType: 1, amount: 8000 });
ev.Casts.push({ timestamp: START + 5_000, type: 'cast', sourceID: 4, abilityGameID: 2825 });
ev.Casts.push({ timestamp: START + 6_000, type: 'cast', sourceID: 1, abilityGameID: 3045 });
ev.Casts.push({ timestamp: START + 1_000, type: 'begincast', sourceID: 2, abilityGameID: 25213 });
ev.Casts.push({ timestamp: START + 20_000, type: 'cast', sourceID: 1, abilityGameID: 28507 });
// The last seconds before Suy dies at 1:40
ev.DamageTaken.push({ timestamp: START + 98_000, type: 'damage', sourceID: 90, targetID: 1, abilityGameID: 1, hitType: 1, amount: 3000 });
ev.DamageTaken.push({ timestamp: START + 99_500, type: 'damage', sourceID: 90, targetID: 1, abilityGameID: 99, hitType: 1, amount: 9000 });
ev.Healing.push({ timestamp: START + 97_000, type: 'heal', sourceID: 2, targetID: 1, abilityGameID: 25213, hitType: 1, amount: 1500 });

const total = (src: number) => ev.DamageDone.filter((e) => e.sourceID === src || (src === 1 && e.sourceID === 50)).reduce((t, e) => t + e.amount + (e.absorbed ?? 0), 0);
const gear = [{ id: 28275, slot: 0, quality: 4, itemLevel: 120, permanentEnchant: 3003 }, { id: 29381, slot: 1, quality: 4, itemLevel: 115 }];
const tables = {
  damage: { data: { entries: [
    { id: 1, name: 'Suy', type: 'Hunter', icon: 'Hunter-BeastMastery', total: total(1), activeTime: 118_000, abilities: [{ name: 'Steady Shot', total: 58_000, type: 1 }, { name: 'Auto Shot', total: 60_000, type: 1 }], pets: [{ name: 'Silah', total: 24_000 }] },
    { id: 3, name: 'Tanky', type: 'Warrior', icon: 'Warrior-Protection', total: total(3), activeTime: 120_000, abilities: [{ name: 'Melee', total: 36_000, type: 1 }] },
  ] } },
  casts: { data: { entries: [
    { id: 1, name: 'Suy', type: 'Hunter', icon: 'Hunter-BeastMastery', abilities: [{ name: 'Steady Shot', guid: 34120, total: 60, abilityIcon: 'steady_shot.jpg' }, { name: 'Rapid Fire', guid: 3045, total: 1 }] },
    { id: 2, name: 'Healz', type: 'Priest', icon: 'Priest-Holy', abilities: [{ name: 'Greater Heal', guid: 25213, total: 40 }] },
    { id: 4, name: 'Shammy', type: 'Shaman', icon: 'Shaman-Enhancement', abilities: [{ name: 'Bloodlust', guid: 2825, total: 1 }] },
  ] } },
  taken: { data: { entries: [
    { id: 3, name: 'Tanky', type: 'Warrior', total: 300_000, abilities: [{ name: 'Gruul Slam', total: 300_000 }] },
    { id: 1, name: 'Suy', type: 'Hunter', total: 8000, abilities: [{ name: 'Cave In', total: 8000 }] },
    { id: 2, name: 'Healz', type: 'Priest', total: 0, abilities: [] },
    { id: 4, name: 'Shammy', type: 'Shaman', total: 0, abilities: [] },
  ] } },
  deaths: { data: { entries: [{ id: 1, name: 'Suy', deathTime: START + 100_000, killingBlow: { name: 'Cave In', guid: 99 }, events: new Array(50).fill({ big: 'payload' }) }] } },
  healing: { data: { entries: [{ id: 2, name: 'Healz', type: 'Priest', total: 168_000, overheal: 40_000, activeTime: 110_000, abilities: [{ name: 'Greater Heal', guid: 25213, total: 120_000, overheal: 40_000 }, { name: 'Renew', guid: 25222, total: 48_000 }] }] } },
  interrupts: { data: { entries: [{ entries: [{ details: [{ name: 'Tanky', total: 2 }] }] }] } },
  debuffs: { data: { auras: [{ guid: 25225, name: 'Sunder Armor', totalUptime: 110_000, totalUses: 5, bands: [] }, { guid: 26993, name: 'Faerie Fire', totalUptime: 60_000, totalUses: 1 }, { guid: 1, name: 'Something Else', totalUptime: 5_000 }] } },
  dispels: { data: { entries: [] } },
  rankings: { data: [{ roles: {
    tanks: { characters: [{ name: 'Tanky', class: 'Warrior', spec: 'Protection', rankPercent: 55, server: { name: 'Spineshatter', id: 7 } }] },
    healers: { characters: [{ name: 'Healz', class: 'Priest', spec: 'Holy', rankPercent: 20 }] },
    dps: { characters: [{ name: 'Suy', class: 'Hunter', spec: 'BeastMastery', rankPercent: 91 }, { name: 'Shammy', class: 'Shaman', spec: 'Enhancement', rankPercent: 40 }] },
  } }] },
  hps: { data: [{ roles: { healers: { characters: [{ name: 'Healz', class: 'Priest', spec: 'Holy', rankPercent: 77 }] } } }] },
  details: { data: { playerDetails: {
    tanks: [{ id: 3, name: 'Tanky', type: 'Warrior', server: 'Spineshatter', specs: [{ spec: 'Protection', role: 'tank' }], maxItemLevel: 110, combatantInfo: { stats: { Stamina: { min: 900, max: 900 } }, gear: [] } }],
    healers: [{ id: 2, name: 'Healz', type: 'Priest', server: 'Spineshatter', specs: [{ spec: 'Holy', role: 'healer' }], maxItemLevel: 105, combatantInfo: { stats: {}, gear: [] } }],
    dps: [
      { id: 1, name: 'Suy', type: 'Hunter', server: 'Spineshatter', specs: [{ spec: 'BeastMastery', role: 'dps' }], maxItemLevel: 117, combatantInfo: { stats: { Agility: { min: 800, max: 850 } }, gear, talents: new Array(30).fill(1) } },
      { id: 4, name: 'Shammy', type: 'Shaman', server: 'Spineshatter', specs: [{ spec: 'Enhancement', role: 'dps' }], maxItemLevel: 100, combatantInfo: { stats: {}, gear: [] } },
    ],
  } } },
};

let wclCalls = 0;
let summaryCalls = 0;
const asked: string[] = [];
function wcl(query: string, vars: any) {
  wclCalls++;
  asked.push(query.replace(/\s+/g, ' ').slice(0, 80));
  const report: Record<string, any> = {};
  const ev0 = query.match(/events\(dataType:(\w+)/);
  if (ev0 && eventsDown) throw new Error('Warcraft Logs API error 502: events unavailable');
  if (ev0) {
    const list = ev[ev0[1]].filter((e) => e.timestamp >= vars.st && e.timestamp < vars.et).sort((a, b) => a.timestamp - b.timestamp);
    // Pages of 50 events, so paging is exercised too
    report.events = { data: list.slice(0, 50), nextPageTimestamp: list.length > 50 ? list[50].timestamp : null };
    return { reportData: { report } };
  }
  if (query.includes('masterData{abilities')) return { reportData: { report: { masterData: { abilities: noSpellList ? [] : abilities } } } };
  if (query.includes('code title startTime')) return { reportData: { report: meta } };
  for (const m of query.matchAll(/(\w+): table\(dataType:(\w+), fightIDs:\$fid(?:, sourceID:(\d+))?[^)]*\)/g)) {
    const [, alias, kind, source] = m;
    if (kind === 'Buffs') report[alias] = { data: { totalTime: 120_000, auras: Number(source) === 1
      ? [{ name: 'Rapid Fire', guid: 3045, totalUptime: 15_000, totalUses: 1, bands: [{ startTime: START + 6_000, endTime: START + 21_000 }] }, { name: 'Bloodlust', guid: 2825, totalUptime: 40_000, totalUses: 1, bands: [{ startTime: START + 5_000, endTime: START + 45_000 }] }, { name: 'Leader of the Pack', guid: 24932, totalUptime: 120_000, totalUses: 1, bands: [{ startTime: START, endTime: END }] }, { name: 'Haste', guid: 28507, totalUptime: 30_000, totalUses: 2, bands: [{ startTime: START, endTime: START + 14_000 }, { startTime: START + 20_000, endTime: START + 35_000 }] }]
      : [] } };
    else if (kind === 'Summary') {
      summaryCalls++;
      report[alias] = { data: { gear: Number(source) === 1 ? [{ id: 28275, name: 'Beast Lord Helm', icon: 'helm.jpg', quality: 4, permanentEnchant: 3003, permanentEnchantName: 'Glyph of Ferocity' }, { id: 29381, name: 'Choker of Vile Intent', quality: 4 }] : [] } };
    } else report[alias] = (tables as any)[alias];
  }
  if (query.includes('rankings(fightIDs:$fid, playerMetric:dps)')) report.rankings = tables.rankings;
  if (query.includes('hps: rankings')) report.hps = tables.hps;
  if (query.includes('details: playerDetails')) report.details = tables.details;
  return { reportData: { report } };
}

// ---------- A fake database (just what the packs use) ----------
const packs = new Map<string, any>();
const raidRows = new Map<string, any>();
const kills = new Map<string, any>();
const deletedAnalyses: string[] = [];
const names: any[] = [];
const dbAsk: string[] = [];
function db(url: URL, init: RequestInit) {
  const path = url.pathname.replace('/rest/v1/', '');
  const p = url.searchParams;
  const method = init.method ?? 'GET';
  dbAsk.push(`${method} ${path}`);
  const eq = (k: string) => p.get(k)?.replace(/^eq\./, '');
  if (path === 'fight_packs') {
    if (method === 'DELETE') {
      for (const [k, r] of packs) if (r.report_code === eq('report_code')) packs.delete(k);
      return [];
    }
    if (method === 'POST') {
      const row = JSON.parse(String(init.body));
      packs.set(`${row.report_code}:${row.fight_id}`, { created_at: '2026-10-01T00:00:00Z', ...(packs.get(`${row.report_code}:${row.fight_id}`) ?? {}), ...row });
      return [];
    }
    let rows = [...packs.values()].filter((r) => !eq('report_code') || r.report_code === eq('report_code'));
    if (p.get('fight_id')?.startsWith('eq.')) rows = rows.filter((r) => r.fight_id === Number(eq('fight_id')));
    if (p.get('fight_id') === 'gt.0') rows = rows.filter((r) => r.fight_id > 0);
    if (method === 'PATCH') {
      for (const r of rows) Object.assign(r, JSON.parse(String(init.body)));
      return [];
    }
    return rows.map((r) => ({ ...r }));
  }
  if (path === 'guild_raids') {
    const code = eq('report_code');
    if (method === 'POST') {
      const row = { status: 'queued', runs: 0, saved: 0, total: 0, card: null, title: null, start_time: null, end_time: null, logger_name: null, ...JSON.parse(String(init.body)) };
      raidRows.set(row.report_code, row);
      return [row];
    }
    if (method === 'DELETE') { raidRows.delete(code!); return []; }
    if (method === 'PATCH') { Object.assign(raidRows.get(code!) ?? {}, JSON.parse(String(init.body))); return []; }
    return code ? [...raidRows.values()].filter((r) => r.report_code === code) : [...raidRows.values()];
  }
  if (path === 'kill_stats') {
    if (method === 'POST') {
      for (const row of JSON.parse(String(init.body))) kills.set(`${row.report_code}:${row.fight_id}:${row.name_key}`, row);
      return [];
    }
    let rows = [...kills.values()];
    for (const [k, v] of p) {
      if (k === 'select' || k === 'order' || k === 'limit') continue;
      const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
      rows = rows.filter((r) => (op === 'eq' ? String(r[k]) === val : op === 'gte' ? String(r[k]) >= val : true));
    }
    if (method === 'DELETE') { for (const r of rows) kills.delete(`${r.report_code}:${r.fight_id}:${r.name_key}`); return []; }
    return rows.sort((a, b) => (p.get('order')?.endsWith('desc') ? b.start_time.localeCompare(a.start_time) : a.start_time.localeCompare(b.start_time)));
  }
  if (path === 'analyses' && method === 'DELETE') { deletedAnalyses.push(eq('report_code')!); return []; }
  if (path === 'item_names') {
    if (method === 'POST') names.push(...JSON.parse(String(init.body)));
    return method === 'GET' ? names.filter((n) => n.kind === eq('kind')) : [];
  }
  return [];
}

const realFetch = globalThis.fetch;
process.env.WCL_CLIENT_ID = 'id';
process.env.WCL_CLIENT_SECRET = 'secret';
process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
let wclDown = false;
let eventsDown = false;
let noSpellList = false;
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'db.example') return new Response(JSON.stringify(db(url, init)), { status: 200 });
  if (wclDown) return new Response('down', { status: 503 });
  if (url.pathname.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
  const body = JSON.parse(String(init.body));
  return new Response(JSON.stringify({ data: wcl(body.query, body.variables) }), { status: 200 });
}) as typeof fetch;

// ---------- One read of the fight ----------
const pack = await getPack(HOST, CODE, fightRef, 'full');
assert.equal(pack.stage, 'full');
const callsForOneFight = wclCalls;
console.log(`One boss fight read in ${callsForOneFight} requests (events in pages of 50 here):\n  ${[...new Set(asked)].join('\n  ')}`);
assert.equal(summaryCalls, 1, 'the Summary table only for the one player whose gear had no names');
assert.ok(names.some((n) => n.kind === 'item' && n.name === 'Beast Lord Helm'), 'item names remembered for next time');
assert.ok(names.some((n) => n.kind === 'enchant' && n.name === 'Glyph of Ferocity'));
const row = { ...packs.get(`${CODE}:3`) };
assert.equal(row.stage, 'full');
assert.equal(typeof row.pack, 'string', 'the pack is stored compressed');
assert.ok(!JSON.stringify(row.pack).includes('payload'), 'nothing unused is kept');
assert.equal(row.digest.players.length, 4, 'everyone in the digest, including the healer who did no damage');
console.log(`Stored: ${row.pack.length} bytes for the pack, ${JSON.stringify(row.digest).length} for the digest`);
const decoded = await readPack(CODE, 3);
assert.deepEqual(decoded, pack, 'what’s stored reads back the same');

// Asked again: nothing from Warcraft Logs
const again = await getPack(HOST, CODE, fightRef, 'full');
assert.deepEqual(again, pack);
assert.equal(wclCalls, callsForOneFight, 'a stored fight is never read again');

// ---------- Everything worked out from the stored fight ----------
const rows = rowsFromPack(pack);
assert.deepEqual(rows.map((r) => [r.name, r.rankPercent, r.itemLevel]), [['Suy', 91, 117], ['Tanky', 55, 110]]);

const suy = snapshotFromPack(HOST, CODE, pack, { id: 1, name: 'Suy', className: 'Hunter' });
assert.equal(suy.total, total(1), 'headline total is Warcraft Logs’ own (with the pet)');
assert.equal(suy.parsePercent, 91);
const steady = suy.abilities.find((a) => a.name === 'Steady Shot')!;
assert.equal(steady.hits, 59, '60 shots, one missed');
assert.equal(steady.critPct, Math.round((15 / 59) * 1000) / 10);
assert.equal(steady.missPct, Math.round((1 / 60) * 1000) / 10);
assert.equal(steady.icon, 'steady_shot.jpg');
const bite = suy.abilities.find((a) => a.isPet)!;
assert.equal(bite.petName, 'Silah', 'pet damage labeled as the pet’s');
assert.equal(bite.casts, 30, 'pet uses from its own casts');
assert.ok(suy.casts!.some((c) => c.name === 'Auto Shot' && c.auto), 'auto shots on the timeline from the swings');
assert.equal(suy.casts!.filter((c) => c.name === 'Auto Shot').length, 120);
assert.deepEqual(suy.windows!.map((w) => [w.name, w.start, w.end, w.kind]).sort(), [['Bloodlust', 5, 45, 'lust'], ['Rapid Fire', 6, 21, 'cooldown']]);
assert.equal(suy.deaths.length, 1);
assert.equal(suy.deaths[0].by, 'Cave In');
assert.deepEqual(suy.deaths[0].hits!.map((h) => [h.t, h.name, h.amount, h.from]), [[98, 'Melee', 3000, 'Gruul'], [99.5, 'Cave In', 9000, 'Gruul']], 'the last hits before dying');
assert.equal(suy.deaths[0].healed, 1500);
assert.deepEqual(suy.potions, { used: [{ name: 'Haste', seconds: 20 }], prePot: true }, 'pre-pot and one during the fight');
const sting = suy.dots!.find((d) => d.name === 'Serpent Sting')!;
assert.ok(sting.uptimePct >= 45 && sting.uptimePct <= 55, `Serpent Sting up about half the fight (${sting.uptimePct}%)`);
assert.ok(!suy.dots!.some((d) => d.name === 'Steady Shot'), 'only ticking spells');
assert.deepEqual(suy.raidDebuffs, [{ label: 'Armor reduction (Sunder / Expose Armor)', uptimePct: 92 }, { label: 'Faerie Fire', uptimePct: 50 }]);
const suyFindings = buildFindings(suy, []);
assert.ok(suyFindings.some((f) => f.title === `Serpent Sting up ${sting.uptimePct}% of the fight`));
assert.ok(suyFindings.some((f) => f.title === 'Died at 1:40' && f.detail.includes('Cave In 9k, Melee 3k')), 'death recap in the finding');
assert.ok(buildStrengths(suy, []).some((g) => g.title === 'Pre-potted and used a potion'));
const tanky = snapshotFromPack(HOST, CODE, pack, { id: 3, name: 'Tanky', className: 'Warrior' });
assert.deepEqual(tanky.mitigation, { swings: 60, dodged: 6, parried: 6, missed: 0, blocked: 6, crits: 6, avoidPct: 20 });
assert.ok(buildFindings(tanky, []).some((f) => f.title === 'Crit by the boss 6×' && f.detail.includes('490 defense')));
assert.ok(buildFindings(tanky, []).some((f) => f.title === 'No potion used'));
assert.ok(suy.buffs.some((b) => b.name === 'Leader of the Pack' && b.uptimePct === 100));

const dash = dashboardFromPack(pack, 1);
assert.deepEqual(dash.gear.map((g) => [g.name, g.enchant]), [['Beast Lord Helm', 'Glyph of Ferocity'], ['Choker of Vile Intent', null]], 'gear with item names');
assert.equal(dash.dpsSeries.length, 120);
assert.ok(Math.abs(dash.dpsSeries.reduce((t, p) => t + p.dps, 0) / 120 - total(1) / 120) < 2, 'line averages the real DPS');
assert.equal(dash.takenSeries![30].note, 'Mostly Cave In');
assert.equal(dash.stats[0].name, 'Agility');

const healer = dashboardFromPack(pack, 2).healing!;
assert.equal(healer.total, 40 * 3000 + 120 * 400 + 1500);
assert.equal(healer.parse, 77);
assert.equal(healer.abilities[0].name, 'Greater Heal');
assert.equal(healer.abilities[0].casts, 40);
assert.equal(healer.hpsSeries.length, 120);
assert.equal(snapshotFromPack(HOST, CODE, pack, { id: 2, name: 'Healz', className: 'Priest' }).healing?.hpsSeries.length, 0, 'no line in the snapshot (it’s in the dashboard)');

const bd = breakdownFromPack(HOST, pack);
assert.deepEqual(bd.bloodlust, [{ seconds: 5, by: 'Shammy', name: 'Bloodlust' }]);
assert.equal(bd.dpsSeries.length, 120);
assert.equal(bd.deaths.length, 1);
assert.equal(bd.players.find((p) => p.name === 'Tanky')!.interrupts, 2);
assert.equal(bd.players.find((p) => p.name === 'Healz')!.parse, 77, 'healers by healing parse');

// ---------- The site and Discord tell the same story ----------
const raid = await raidDigest(HOST, CODE);
assert.equal(raid.pending, 0);
assert.equal(wclCalls, callsForOneFight + 1, 'only the report’s fight list was asked for (it’s still recent)');
const night = await overallRaid(HOST, CODE);
const summary = raidSummary(raid, null);
const summaryText = JSON.stringify(summary);
for (const f of night.card.feedback.work) assert.ok(summaryText.includes(f.title), `Discord summary says "${f.title}" like the site`);
const dm = personalPage('summary', raid, 'Suy', null)!.embeds![0];
const fields = Object.fromEntries(dm.fields!.map((f) => [f.name, f.value]));
assert.equal(fields['Average parse'], '91');
assert.equal(night.players.find((p) => p.name === 'Suy')!.avgParse, 91, 'same parse on the site');
const gearDm = JSON.stringify(personalPage('gear', raid, 'Suy', null));
assert.ok(gearDm.includes('Beast Lord Helm'), 'gear DM has item names too');

// ---------- A finished log is read once ----------
meta.startTime = Date.UTC(2026, 0, 1);
const before = wclCalls;
await getMeta(HOST, CODE);
assert.equal(packs.get(`${CODE}:0`).stage, 'meta-final');
await getMeta(HOST, CODE);
await reportRegion(HOST, CODE);
assert.equal(wclCalls, before + 1, 'a finished log’s fight list comes from the stored copy');
assert.equal(await reportRegion(HOST, CODE), 'eu', 'region stored with the report');

// ---------- Warcraft Logs down ----------
wclDown = true;
const offline = await storedDigests(CODE);
assert.equal(offline.length, 1, 'Discord and Home still answer');
const meanwhile = await getPack(HOST, CODE, fightRef, 'full');
assert.equal(meanwhile.stage, 'full');

// ---------- Older raids keep only the tables ----------
await trimPack(CODE, 3);
const trimmed = (await readPack(CODE, 3))!;
assert.equal(trimmed.stage, 'tables');
assert.equal(trimmed.full, undefined);
assert.ok(packs.get(`${CODE}:3`).pack.length < row.pack.length / 2, 'much smaller once trimmed');
const lite = snapshotFromPack(HOST, CODE, trimmed, { id: 1, name: 'Suy', className: 'Hunter' });
assert.equal(lite.total, total(1));
assert.ok(lite.abilities.some((a) => a.name === 'Steady Shot'), 'still a damage breakdown from the tables');
assert.equal(lite.casts!.length, 0);
const liteBd = breakdownFromPack(HOST, trimmed);
assert.equal(liteBd.dpsSeries.length, 0);
assert.equal(liteBd.deaths.length, 1);
// Warcraft Logs down and the fight never read: a clear error
packs.delete(`${CODE}:3`);
await assert.rejects(getPack(HOST, CODE, fightRef, 'tables'), /Warcraft Logs/);
// A request can't store a fight under times the report doesn't have
await assert.rejects(getPack(HOST, CODE, { ...fightRef, id: 9 }, 'tables'), /isn\u2019t in this report/);
wclDown = false;

// ---------- Discord DMs say the same as the site ----------
const dmText = JSON.stringify(personalPage('summary', raid, 'Suy', null));
assert.ok(dmText.includes('Serpent Sting'), 'DoT uptime in the DM');
assert.ok(dmText.includes('Potions'), 'potions in the DM');
const tankDm = JSON.stringify(personalPage('survival', raid, 'Tanky', null));
assert.ok(tankDm.includes('avoided 20% of 60 swings') && tankDm.includes('crit 6'), 'tank mitigation in the DM');
assert.match(JSON.stringify(personalPage('survival', raid, 'Suy', null)), /Cave In 9.0k, Melee 3.0k/, 'death recap in the DM');
const channel = JSON.stringify(raidSummary(raid, null));
assert.ok(channel.includes('Boss debuffs dropping off') && channel.includes('Faerie Fire 50%'), 'boss debuffs in the raid summary');
assert.ok(!channel.includes('Tanky') && !channel.includes('Healz'), 'the channel summary names nobody');
const bdNow = breakdownFromPack(HOST, pack);
assert.ok(bdNow.deaths[0].hits?.length === 2 && bdNow.debuffs?.length === 2);

// ---------- Guild benchmarks and trends ----------
const raidDay = (daysAgo: number) => ({ ...meta, startTime: Date.now() - daysAgo * 86_400_000 }) as any;
const thisKill = raid.fights[0];
const variant = (dps: Record<string, number>, parse: number) => ({ ...thisKill, players: [...thisKill.players.map((p) => ({ ...p, dps: dps[p.name] ?? p.dps, parse })), { ...thisKill.players[0], id: 99, name: 'Muddy', dps: 2000, parse: 99 }] });
await recordKills('OLD1', raidDay(21), [variant({ Suy: 900 }, 40)]);
await recordKills('OLD2', raidDay(14), [variant({ Suy: 1000 }, 55)]);
await recordKills(CODE, raidDay(0), raid.fights);
const g = (await guildContext({ encounterId: 649, encounter: 'Gruul', className: 'Hunter', specName: 'BeastMastery', name: 'Suy', healer: false }))!;
assert.equal(g.players, 2);
assert.equal(g.best!.name, 'Muddy');
assert.equal(g.place, 2);
assert.equal(g.mine.length, 3, 'all three of your kills');
assert.equal(g.mine[0].code, CODE, 'newest first');
const done = await finish({ player: suy, comparisons: [], compareKey: 'none', notes: [] });
assert.equal(done.guild?.best?.name, 'Muddy', 'against the guild on the site');
const lines = JSON.stringify(personalPage('summary', raid, 'Suy', null, ['• **Gruul**: #2 of 2']));
assert.ok(lines.includes('Against the guild'));
const trend = await trendFor('Suy');
assert.equal(trend.length, 3, 'three raid weeks');
assert.deepEqual(trend.map((w) => w.parse), [40, 55, 91], 'oldest first');

// ---------- Checking what's stored ----------
await getPack(HOST, CODE, fightRef, 'full');
await registerRaid({ host: HOST, code: CODE, source: 'site' });
const checked = await checkRaid(CODE);
assert.equal(checked.status, 'queued');
assert.deepEqual(checked.kills.map((k) => [k.boss, k.stage, k.players, k.tanksWithSwings, k.withDots, k.problem]), [['Gruul', 'full', 4, 1, 1, null]]);
assert.ok(checked.benchmarkRows! > 0);
assert.equal(checked.onCalendar, false, 'not read by the job yet');

// A full read that fails: the tables still answer, the reason is kept, and it isn't retried at once
const failRef = { ...fightRef, id: 3 };
packs.delete(`${CODE}:3`);
eventsDown = true;
const before2 = wclCalls;
const halfway = await getPack(HOST, CODE, failRef, 'full');
assert.equal(halfway.stage, 'tables');
assert.match(halfway.fullError!, /events unavailable/);
const partial = snapshotFromPack(HOST, CODE, halfway, { id: 1, name: 'Suy', className: 'Hunter' });
assert.match(partial.partial!, /events unavailable/, 'the page says why');
const callsAfterFail = wclCalls;
await getPack(HOST, CODE, failRef, 'full');
assert.equal(wclCalls, callsAfterFail, 'not tried again straight away');
assert.ok(callsAfterFail > before2);
assert.match((await checkRaid(CODE)).kills[0].problem!, /events unavailable/);
eventsDown = false;
packs.delete(`${CODE}:3`);
await getPack(HOST, CODE, fightRef, 'full');

// Warcraft Logs' spell list comes back empty: names (and icons) come from its tables instead
noSpellList = true;
packs.delete(`${CODE}:3`);
const noList = await getPack(HOST, CODE, fightRef, 'full');
const healNames = dashboardFromPack(noList, 2).healing!.abilities.map((a) => a.name);
assert.deepEqual(healNames, ['Greater Heal', 'Renew'], 'healing spells named from the tables');
noSpellList = false;
packs.delete(`${CODE}:3`);
await getPack(HOST, CODE, fightRef, 'full');

// ---------- Deleting a raid leaves nothing behind; adding it again reads it as new ----------
assert.ok(packs.size > 0 && raidRows.has(CODE));
assert.equal(await deleteRaid(CODE), null);
assert.equal(raidRows.has(CODE), false, 'off Past raids');
assert.equal([...packs.values()].filter((r) => r.report_code === CODE).length, 0, 'no stored fights or fight list left');
assert.deepEqual(deletedAnalyses, [CODE], 'saved analyses of the log removed');
assert.equal([...kills.values()].filter((k) => k.report_code === CODE).length, 0, 'its kills are out of the benchmarks');
await assert.rejects(deleteRaid(CODE), /isn\u2019t on Past raids/);
const readBefore = wclCalls;
const added = await registerRaid({ host: HOST, code: CODE, source: 'site' });
assert.equal(added.status, 'queued', 'added again as a new raid');
await getPack(HOST, CODE, fightRef, 'full');
assert.ok(wclCalls - readBefore >= callsForOneFight - 1, 'read from Warcraft Logs again, not from anything left over');

globalThis.fetch = realFetch;
console.log('\nAll fight pack checks passed.');
