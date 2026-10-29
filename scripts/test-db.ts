// Checks for running on plain Postgres (DATABASE_URL, e.g. Neon): the schema loads, and the app's
// PostgREST-style requests work as SQL, through the real data functions, on an in-memory Postgres.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { toSql } from '../server/pgrest.js';

// The translation itself
assert.deepEqual(toSql('guild_raids?report_code=eq.ABC&status=in.(partial,saved)&select=card'), {
  text: 'SELECT "card" FROM "guild_raids" WHERE "report_code" = $1 AND "status" IN ($2, $3)', params: ['ABC', 'partial', 'saved'], returns: true,
});
assert.equal(toSql('fight_packs?fight_id=eq.0&select=report_code,zone:digest->zone').text, 'SELECT "report_code", "digest"->\'zone\' AS "zone" FROM "fight_packs" WHERE "fight_id" = $1');
assert.equal(toSql('bot_reminders?select=payload&payload->>gatherAt=gt.2026-01-01&order=send_at.asc&limit=1').text,
  'SELECT "payload" FROM "bot_reminders" WHERE "payload"->>\'gatherAt\' > $1 ORDER BY "send_at" ASC LIMIT 1');
assert.equal(toSql('guild_raids?status=in.(queued,saving)&order=start_time.desc.nullsfirst&limit=5').text,
  'SELECT * FROM "guild_raids" WHERE "status" IN ($1, $2) ORDER BY "start_time" DESC NULLS FIRST LIMIT 5');
assert.equal(toSql('bot_raids?ended_at=not.is.null').text, 'SELECT * FROM "bot_raids" WHERE NOT ("ended_at" IS NULL)');
assert.match(toSql('site_users?on_conflict=discord_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: '{"discord_id":"1","name":"x"}' }).text, /ON CONFLICT \("discord_id"\) DO NOTHING$/);
assert.match(toSql('site_users?on_conflict=discord_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: '{"discord_id":"1","name":"x"}' }).text, /DO UPDATE SET "name" = EXCLUDED."name"$/);
assert.throws(() => toSql('guild_raids; drop table x'), /unexpected name/, 'names are checked, never pasted in');
assert.throws(() => toSql("guild_raids?select=card->'x'"), /unexpected column/);

// The app on an in-memory Postgres
process.env.DATABASE_URL = 'postgres://test';
const db = new PGlite();
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
const { usePostgresForTests, rest, dbEnabled } = await import('../server/db.js');
usePostgresForTests((text, params) => db.query(text, params as any[]) as any);
assert.ok(dbEnabled());

// Claims (insert returning, filters, order, update, delete)
const store = await import('../server/discord/store.js');
const claim = await store.createClaim({ discord_id: '7', discord_name: 'suy', character: 'Suy', realm: 'Nightslayer' });
assert.ok(claim.id && claim.status === 'pending', 'insert returns the new row');
await store.decideClaim(claim.id, 'approved', 'officer');
assert.equal((await store.approvedClaimsFor('7'))[0].character, 'Suy');
assert.equal((await store.claimOnCharacter('suy', null))?.id, claim.id);
await store.removeClaim('7', 'Suy');
assert.equal((await store.claimsFor('7')).length, 0);

// Raids from /raidstart (upsert returning, is null, order)
const raid = await store.createRaid({ host: 'fresh.warcraftlogs.com', report_code: 'R1', title: 'Kara', started_by: '7', logger_id: null });
assert.equal(raid.report_code, 'R1');
assert.equal((await store.latestRaidStartedBy('7'))?.report_code, 'R1');
await store.endRaid('R1');
assert.equal(await store.latestOpenRaid(), null);
assert.equal((await store.recentRaids(5)).length, 1);

// Reminders (json path filter, timestamps back as text)
await store.createReminder({ channel_id: 'c', created_by: '7', send_at: '2000-01-01T00:00:00Z', payload: { message: 'Gruul', gatherAt: '2999-01-01T19:00:00Z' } });
const due = await store.dueReminders();
assert.equal(due.length, 1);
assert.equal(typeof due[0].send_at, 'string', 'timestamps come back as text, as from Supabase');
await store.markReminderSent(due[0].id);
assert.equal((await store.dueReminders()).length, 0);

// Guild details (upsert merge on a json column)
const { applyGuildEdit, guildSettings } = await import('../server/guildSettings.js');
await applyGuildEdit({ action: 'guild', name: 'Vita Nova', icon: null, about: 'Hi' }, { name: 'suy', rank: 'admin' });
await applyGuildEdit({ action: 'guild', name: 'Vita Nova', icon: null, about: 'Hello' }, { name: 'suy', rank: 'admin' });
assert.deepEqual(await guildSettings(), { name: 'Vita Nova', icon: null, about: 'Hello' });

// Bug reports
const bugs = await import('../server/bugs.js');
await bugs.saveBug({ discordId: '7', username: 'suy', place: 'DMs', raid: null, what: 'It broke', doing: null });
const [bug] = await bugs.listBugs();
await bugs.updateBug(bug.id, { status: 'resolved', note: 'Fixed', by: 'suy' });
assert.equal((await bugs.getBug(bug.id))?.status, 'resolved');
await bugs.deleteBug(bug.id);
assert.equal((await bugs.listBugs()).length, 0);

// Kill stats: many rows at once, numbers back as numbers
await rest('kill_stats?on_conflict=report_code,fight_id,name_key', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([
    { report_code: 'R1', fight_id: 3, name_key: 'suy', encounter_id: 649, encounter_name: 'Gruul', start_time: '2026-10-01T20:00:00Z', seconds: 120, name: 'Suy', class_name: 'Hunter', spec_name: 'BeastMastery', role: 'dps', healer: false, dps: 1200, hps: 0, parse: 91.5, hps_parse: null, deaths: 0, item_level: 113.4 },
    { report_code: 'R1', fight_id: 3, name_key: 'lizen', encounter_id: 649, encounter_name: 'Gruul', start_time: '2026-10-01T20:00:00Z', seconds: 120, name: 'Lizen', class_name: 'Priest', spec_name: 'Holy', role: 'healer', healer: true, dps: 0, hps: 900, parse: null, hps_parse: 98, deaths: 1, item_level: 115 },
  ]),
});
const { performance, performanceRows } = await import('../server/discord/performance.js');
const rows = await performanceRows({ code: 'R1' });
assert.equal(rows.length, 2);
assert.equal(rows.find((r) => r.name === 'Suy')!.parse, 91.5, 'numeric columns come back as numbers');
assert.equal(typeof (await performance('8w')).kills, 'number');

// Guild raids and a stored fight with a json path in the select
await rest('guild_raids', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ report_code: 'R1', host: 'fresh.warcraftlogs.com', title: 'Kara', start_time: '2026-10-01T19:00:00Z', source: 'site', status: 'saved', card: { kills: 1 } }) });
await rest('fight_packs?on_conflict=report_code,fight_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ report_code: 'R1', fight_id: 0, host: 'fresh.warcraftlogs.com', stage: 'meta-final', pack: 'x', digest: { zone: { id: 1007, name: 'Karazhan' }, pv: 3 } }) });
const zones = await rest('fight_packs?fight_id=eq.0&report_code=in.(R1)&select=report_code,zone:digest->zone');
assert.deepEqual(zones, [{ report_code: 'R1', zone: { id: 1007, name: 'Karazhan' } }]);
const { listRaids, deleteRaid } = await import('../server/archive.js');
assert.equal((await listRaids()).raids[0].code, 'R1');
await deleteRaid('R1');
assert.equal((await listRaids()).raids.length, 0, 'deleting a raid removes it');
assert.equal((await rest('kill_stats?report_code=eq.R1')).length, 0, 'and its kills');

console.log('All database checks passed.');
