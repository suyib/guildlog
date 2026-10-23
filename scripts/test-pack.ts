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
const abilities = [ability(34120, 'Steady Shot'), ability(75, 'Auto Shot'), ability(1, 'Melee'), ability(25213, 'Greater Heal'), ability(25222, 'Renew'), ability(16, 'Gruul Slam'), ability(99, 'Cave In'), ability(2825, 'Bloodlust'), ability(3045, 'Rapid Fire'), ability(17, 'Bite')];

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
  healing: { data: { entries: [{ id: 2, name: 'Healz', type: 'Priest', total: 168_000, overheal: 40_000, activeTime: 110_000, abilities: [{ name: 'Greater Heal', total: 120_000, overheal: 40_000 }, { name: 'Renew', total: 48_000 }] }] } },
  interrupts: { data: { entries: [{ entries: [{ details: [{ name: 'Tanky', total: 2 }] }] }] } },
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
  if (ev0) {
    const list = ev[ev0[1]].filter((e) => e.timestamp >= vars.st && e.timestamp < vars.et).sort((a, b) => a.timestamp - b.timestamp);
    // Pages of 50 events, so paging is exercised too
    report.events = { data: list.slice(0, 50), nextPageTimestamp: list.length > 50 ? list[50].timestamp : null };
    return { reportData: { report } };
  }
  if (query.includes('masterData{abilities')) return { reportData: { report: { masterData: { abilities } } } };
  if (query.includes('code title startTime')) return { reportData: { report: meta } };
  for (const m of query.matchAll(/(\w+): table\(dataType:(\w+), fightIDs:\$fid(?:, sourceID:(\d+))?\)/g)) {
    const [, alias, kind, source] = m;
    if (kind === 'Buffs') report[alias] = { data: { totalTime: 120_000, auras: Number(source) === 1
      ? [{ name: 'Rapid Fire', guid: 3045, totalUptime: 15_000, totalUses: 1, bands: [{ startTime: START + 6_000, endTime: START + 21_000 }] }, { name: 'Bloodlust', guid: 2825, totalUptime: 40_000, totalUses: 1, bands: [{ startTime: START + 5_000, endTime: START + 45_000 }] }, { name: 'Leader of the Pack', guid: 24932, totalUptime: 120_000, totalUses: 1, bands: [{ startTime: START, endTime: END }] }]
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
const names: any[] = [];
const dbAsk: string[] = [];
function db(url: URL, init: RequestInit) {
  const path = url.pathname.replace('/rest/v1/', '');
  const p = url.searchParams;
  const method = init.method ?? 'GET';
  dbAsk.push(`${method} ${path}`);
  const eq = (k: string) => p.get(k)?.replace(/^eq\./, '');
  if (path === 'fight_packs') {
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
assert.deepEqual(suy.deaths, [{ seconds: 100, by: 'Cave In' }]);
assert.ok(suy.buffs.some((b) => b.name === 'Leader of the Pack' && b.uptimePct === 100));

const dash = dashboardFromPack(pack, 1);
assert.deepEqual(dash.gear.map((g) => [g.name, g.enchant]), [['Beast Lord Helm', 'Glyph of Ferocity'], ['Choker of Vile Intent', null]], 'gear with item names');
assert.equal(dash.dpsSeries.length, 120);
assert.ok(Math.abs(dash.dpsSeries.reduce((t, p) => t + p.dps, 0) / 120 - total(1) / 120) < 2, 'line averages the real DPS');
assert.equal(dash.takenSeries![30].note, 'Mostly Cave In');
assert.equal(dash.stats[0].name, 'Agility');

const healer = dashboardFromPack(pack, 2).healing!;
assert.equal(healer.total, 40 * 3000 + 120 * 400);
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

globalThis.fetch = realFetch;
console.log('\nAll fight pack checks passed.');
