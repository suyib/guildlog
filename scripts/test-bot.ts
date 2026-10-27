// Offline checks of the Discord bot: request signatures, command replies and DM pages.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { POST } from '../api/discord';
import { COMMANDS, handle, reminderMessage } from '../server/discord/commands';
import type { RaidDigest } from '../server/discord/digest';
import { personalPage, raidSummary } from '../server/discord/pages';
import { activeOver, raidFeedback } from '../server/raidFeedback';
import { auditLine, describe } from '../server/discord/audit';
import { rest } from '../server/db';
import { gql } from '../server/wcl';
import { buildCard } from '../server/archive';
import { forThisGuild, readSession, sessionCookie, sign as signValue } from '../server/auth';
import { isSiteAdmin } from '../server/officers';
import { assignable, can, canEdit, discordRank, effectiveRank } from '../server/ranks';
import { applyEdit } from '../server/users';

// Signed requests: Discord's PING gets a PONG, a bad signature is refused
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.DISCORD_PUBLIC_KEY = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex');
async function call(body: unknown, tamper = false) {
  const text = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(ts + text), privateKey).toString('hex');
  return POST(new Request('https://guildlog.uk/api/discord', {
    method: 'POST', body: tamper ? text + ' ' : text,
    headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts },
  }));
}
assert.deepEqual(await (await call({ type: 1 })).json(), { type: 1 });
assert.equal((await call({ type: 1 }, true)).status, 401);

// /info consumables replies only to the person who asked
const infoRes: any = await (await call({ type: 2, token: 't', user: { id: '1', username: 'suy' }, data: { name: 'info', options: [{ name: 'consumables', type: 1, options: [{ name: 'role', type: 3, value: 'physical' }] }] } })).json();
assert.equal(infoRes.type, 4);
assert.equal(infoRes.data.flags, 64);
assert.ok(infoRes.data.embeds[0].fields.some((f: any) => f.value.includes('Relentless Assault')));

// Officer-only commands refuse everyone else
const remind: any = await handle({ type: 2, token: 't', guild_id: 'g', channel_id: 'c', member: { user: { id: '2', username: 'x' }, roles: [], permissions: '0' }, data: { name: 'remind', options: [] } });
assert.match(remind.response.data.content, /Only officers/);

// Claim names are checked before anything is stored
const bad: any = await handle({ type: 2, token: 't', user: { id: '3', username: 'y' }, data: { name: 'claim', options: [{ name: 'character', type: 3, value: 'x1!' }] } });
assert.match(bad.response.data.content, /doesn.t look like a character name/);

// Command definitions stay within Discord's limits
for (const c of COMMANDS) {
  assert.ok(/^[a-z]{1,32}$/.test(c.name) && c.description.length <= 100, `bad command ${c.name}`);
  for (const o of (c as { options?: unknown[] }).options ?? []) assert.ok((o as any).description.length <= 100, `long option description on /${c.name} ${(o as any).name}`);
}

// Reminder message uses Discord timestamps so everyone sees their own local time
const rm = reminderMessage({ message: 'Gruul tonight', place: 'Outside Gruul', consumes: true, gatherAt: '2026-10-23T19:00:00Z', roleId: '99' });
assert.equal(rm.content, '<@&99>');
assert.ok(rm.embeds![0].fields![0].value.includes('<t:1792782000:t>'));

// Raid summary in the channel has no individual numbers; the DM pages do
const player = (name: string, dps: number, parse: number) => ({
  id: 1, name, server: 'Thunderstrike', className: 'Hunter', specName: 'BeastMastery', role: 'dps' as const, total: dps * 180, dps, parse, itemLevel: 115, activePct: 97,
  abilities: [{ name: 'Steady Shot', total: dps * 60 }, { name: 'Auto Shot', total: dps * 50 }], casts: [{ name: 'Steady Shot', count: 60 }],
  cooldowns: [{ name: 'Bestial Wrath', uses: 1, possible: 2 }], deaths: [], taken: 20000, avoidable: 3000, avoidableTop: [{ name: 'Fire', total: 3000 }],
  gear: [{ slot: 0, slotName: 'Head', id: 5, name: 'Beast Lord Helm', icon: null, itemLevel: 120, quality: 4, enchant: null, enchantId: null, enchantable: true, gems: [] }],
  stats: [{ name: 'Agility', value: '800' }],
});
const digest = {
  host: 'fresh.warcraftlogs.com', code: 'ABC', pending: 0,
  meta: { code: 'ABC', title: 'Gruul + Maggy', startTime: Date.UTC(2026, 9, 15, 19), zone: null, masterData: { actors: [] },
    fights: [
      { id: 1, encounterID: 1, name: 'High King Maulgar', startTime: 0, endTime: 180000, kill: true, size: 25, difficulty: 3 },
      { id: 2, encounterID: 2, name: 'Gruul', startTime: 200000, endTime: 300000, kill: false, size: 25, difficulty: 3 },
      { id: 3, encounterID: 2, name: 'Gruul', startTime: 400000, endTime: 700000, kill: true, size: 25, difficulty: 3 },
    ] },
  fights: [
    { id: 1, name: 'High King Maulgar', encounterID: 1, kill: true, startTime: 0, endTime: 180000, seconds: 180, players: [player('Suy', 1500, 90)] },
    { id: 3, name: 'Gruul', encounterID: 2, kill: true, startTime: 400000, endTime: 700000, seconds: 300, players: [player('Suy', 1600, 80)] },
  ],
} as unknown as RaidDigest;
const summary = raidSummary(digest, '42');
assert.ok(summary.embeds![0].description!.includes('Gruul**: killed in 5:00 (1 wipe)'));
assert.ok(!JSON.stringify(summary.embeds).includes('Suy'), 'no player names in the channel summary');
// Raid-wide highlights in plain language
const fields = Object.fromEntries(summary.embeds![0].fields!.map((f) => [f.name, f.value]));
assert.ok(fields['What went well'].includes('Nobody died'));
assert.ok(fields['What to work on'].includes('1 wipe along the way'));
assert.ok(!fields['What to work on'].includes('enchant'), 'enchants stay in the DMs');
// The site's version names nobody in what to work on, only in what went well
const site = raidFeedback(digest.fights, { bloodlust: [] });
assert.ok(site.work.every((p) => !p.who), 'no naming in what to work on');
assert.deepEqual(site.good.find((p) => p.title.includes('strong'))!.who, ['Suy']);
assert.ok(site.work.some((p) => p.title === 'No Bloodlust or Heroism'));
// Active time: a 24-second kill (mostly run-in) and fights someone died in don't flag them as idle
const shortFight = { ...digest.fights[0], seconds: 24, players: [{ ...player('Suy', 1500, 90), activePct: 70 }] };
const longFight = { ...digest.fights[1], seconds: 300, players: [{ ...player('Suy', 1600, 80), activePct: 96 }] };
const diedFight = { ...digest.fights[1], id: 9, seconds: 200, players: [{ ...player('Suy', 1600, 80), activePct: 50, deaths: [{ seconds: 100, by: 'Shatter' }] }] };
assert.equal(activeOver([shortFight, longFight, diedFight].map((f) => ({ fight: f, p: f.players[0] }))), 96);
assert.ok(!raidFeedback([shortFight, longFight, diedFight] as any).work.some((p) => p.title.includes('not attacking')));
assert.equal(activeOver([{ fight: shortFight, p: shortFight.players[0] }] as any), null);
// DM pages: headline numbers side by side, then bold-titled points, within Discord's limits
const fieldsOf = (page: Parameters<typeof personalPage>[0]) => Object.fromEntries(personalPage(page, digest, 'suy', null)!.embeds![0].fields!.map((f) => [f.name, f.value]));
assert.equal(fieldsOf('overview')['Average parse'], '85', 'old My overview buttons open the quick summary');
assert.ok(fieldsOf('damage')['Boss by boss'].includes('1,500 DPS · parse 90'), 'boss by boss: DPS and parse');
assert.ok(!fieldsOf('damage')['Boss by boss'].includes('damage'), 'no totals per boss');
assert.ok(fieldsOf('gear')['What to work on'].includes('No enchant on: head'));
assert.equal(fieldsOf('gear')['Enchants'], '0 of 1');
assert.ok(fieldsOf('rotation')['Cooldowns (all kills)'].includes('**Bestial Wrath**: 2 of 4 · room for 2 more'));
assert.ok(fieldsOf('damage')['Top abilities'].includes('**Steady Shot**'));
assert.ok(fieldsOf('survival')['What went well'].includes('No deaths'));
for (const page of ['summary', 'damage', 'rotation', 'gear', 'survival'] as const) {
  const e = personalPage(page, digest, 'suy', null)!.embeds![0];
  assert.ok(e.fields!.length <= 25 && e.fields!.every((f) => f.value.length <= 1024 && f.value.length > 0), `${page} fits Discord`);
}
assert.equal(personalPage('overview', digest, 'Nobody', null), null);
// Potions are only judged once at least half the bosses have been read in full
{
  const pots = { used: [{ name: 'Haste', seconds: 20 }], prePot: false };
  const night = (read: number) => ({ ...digest, fights: Array.from({ length: 4 }, (_, i) => ({ ...digest.fights[0], id: i + 1, name: `Boss ${i + 1}`, players: [{ ...player('Suy', 1500, 90), ...(i < read ? { potions: pots } : {}) }] })) }) as unknown as RaidDigest;
  const text = (read: number) => JSON.stringify(personalPage('summary', night(read), 'Suy', null));
  assert.ok(!text(1).includes('Potions'), 'one boss of four isn\u2019t enough to judge');
  assert.ok(text(2).includes('Used on every boss (2 of 4 bosses checked)'));
  assert.ok(text(4).includes('Used on every boss.'));
}

// A boss where they did nothing (Chess Event, or dead at the pull) doesn't count against them
{
  const chess = { id: 5, name: 'Chess Event', encounterID: 9, kill: true, startTime: 800000, endTime: 900000, seconds: 100, players: [{ ...player('Suy', 0, 0), total: 0 }] };
  const withChess = { ...digest, fights: [...digest.fights, chess] } as unknown as RaidDigest;
  const q = Object.fromEntries(personalPage('summary', withChess, 'Suy', null)!.embeds![0].fields!.map((f) => [f.name, f.value]));
  assert.equal(q['Average parse'], '85', 'not dragged down by a 0');
  assert.ok(!q['What to work on'].includes('Chess Event'), 'not the weakest boss');
  const d = Object.fromEntries(personalPage('damage', withChess, 'Suy', null)!.embeds![0].fields!.map((f) => [f.name, f.value]));
  assert.ok(!d['Boss by boss'].includes('Chess Event'));
}

// Quick summary: the at-a-glance page with what went well and what to work on
const quick = personalPage('summary', digest, 'Suy', null)!;
const quickFields = Object.fromEntries(quick.embeds![0].fields!.map((f) => [f.name, f.value]));
assert.ok(quickFields['What went well'].includes('**No deaths**'));
assert.ok(quickFields['What to work on'].includes('Bestial Wrath 2/4'), 'under-used cooldowns are listed');
assert.ok(quickFields['What to work on'].includes('No enchant on: head'));
// Six page buttons, split across two rows (Discord allows five per row)
assert.equal(summary.components!.length, 2);
// ...plus a link that opens the log on the site
const siteButton = (summary.components![1] as any).components.at(-2);
assert.equal(siteButton.style, 5);
assert.equal(siteButton.url, 'https://guildlog.uk/?log=' + encodeURIComponent('https://fresh.warcraftlogs.com/reports/ABC'));
assert.ok((summary.components![1] as any).components.length <= 5);

// /help lists every command, only to the person who asked
const help: any = await handle({ type: 2, token: 't', user: { id: '1', username: 'suy' }, data: { name: 'help' } });
assert.equal(help.response.data.flags, 64);
const helpText = JSON.stringify(help.response.data.embeds);
for (const c of COMMANDS) assert.ok(helpText.includes(`/${c.name}`) || c.name === 'help', `/help is missing /${c.name}`);
assert.ok(help.response.data.embeds[0].fields.every((f: any) => f.value.length <= 1024));

// Credit only in the raid summary's footer
assert.ok(summary.embeds![0].footer!.text.endsWith('Made by suy'));
const helpReply: any = await (await call({ type: 2, token: 't', user: { id: '1', username: 'suy' }, data: { name: 'help' } })).json();
assert.ok(!JSON.stringify(helpReply).includes('Made by suy'));
assert.equal(helpReply.data.components[0].components[0].custom_id, 'bug:open');

// Report a bug: the button opens a form; sending it needs somewhere to go
const form: any = await handle({ type: 3, token: 't', user: { id: '1', username: 'suy' }, data: { custom_id: 'bug:open:fresh.warcraftlogs.com:ABC' } });
assert.equal(form.response.type, 9);
assert.equal(form.response.data.custom_id, 'bug:submit:fresh.warcraftlogs.com:ABC');
assert.equal(form.response.data.components.length, 2);
assert.equal((summary.components![1] as any).components.at(-1).custom_id, 'bug:open:fresh.warcraftlogs.com:ABC');
assert.equal(describe({ type: 5, token: 't', data: { custom_id: 'bug:submit' } } as any), 'Sent a bug report');

// Bug reports are kept for the Admin page: fixed (telling the reporter by DM), and deleted by guild masters only
{
  const { applyBugEdit, listBugs, saveBug } = await import('../server/bugs');
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  process.env.DISCORD_BOT_TOKEN = 'bot';
  const realFetch = globalThis.fetch;
  const rows: any[] = [];
  const dms: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'discord.com') {
      if (u.pathname.endsWith('/users/@me/channels')) return new Response('{"id":"dm1"}', { status: 200 });
      dms.push(JSON.parse(String(init.body)).content);
      return new Response('{}', { status: 200 });
    }
    const id = u.searchParams.get('id')?.replace('eq.', '');
    if (init.method === 'POST') rows.push({ id: '11111111-2222-3333-4444-555555555555', created_at: '2026-10-26T12:21:00Z', status: 'open', note: null, resolved_by: null, resolved_at: null, ...JSON.parse(String(init.body)) });
    if (init.method === 'PATCH') Object.assign(rows.find((r) => r.id === id), JSON.parse(String(init.body)));
    if (init.method === 'DELETE') rows.splice(rows.findIndex((r) => r.id === id), 1);
    return new Response(JSON.stringify(init.method ? [] : id ? rows.filter((r) => r.id === id) : rows), { status: 200 });
  }) as typeof fetch;
  await saveBug({ discordId: '7', username: 'suy', place: '#tbc-test-raid-log', raid: { host: 'fresh.warcraftlogs.com', code: 'ABC' }, what: 'Potions said all 1 boss', doing: 'Quick summary' });
  const [bug] = await listBugs();
  assert.deepEqual([bug.status, bug.username, bug.place, bug.raid?.code, bug.what], ['open', 'suy', '#tbc-test-raid-log', 'ABC', 'Potions said all 1 boss']);
  const officer = { id: '9', name: 'Officer', rank: 'officer' as const };
  const done = await applyBugEdit({ action: 'bug', id: bug.id, status: 'resolved', note: 'Fixed in v0.27.1', tell: true }, officer);
  assert.ok(done.startsWith('marked the bug report from suy') && done.endsWith('and told them by DM'));
  assert.ok(dms[0].includes('Potions said all 1 boss') && dms[0].includes('Fixed in v0.27.1'), 'the reporter hears back, with the note');
  assert.equal((await listBugs())[0].status, 'resolved');
  await assert.rejects(applyBugEdit({ action: 'bugDelete', id: bug.id }, officer), /Only guild masters and admins/);
  await applyBugEdit({ action: 'bugDelete', id: bug.id }, { ...officer, rank: 'guild_master' });
  assert.equal((await listBugs()).length, 0);
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DISCORD_BOT_TOKEN;
}

// Activity log: who, what and where, never what they typed
const typed = { type: 2, token: 't', guild_id: 'g', channel_id: '55', member: { user: { id: '7', username: 'suy' }, roles: [] },
  data: { name: 'remind', options: [{ name: 'message', type: 3, value: 'secret plans' }, { name: 'time', type: 3, value: '19:45' }] } } as any;
const line = auditLine(typed, 'ok', 1200);
assert.ok(line.includes('/remind (options: message, time)') && line.includes('<@7> (suy)') && line.includes('in <#55>') && line.includes('ok, 1.2s'));
assert.ok(!line.includes('secret plans') && !line.includes('19:45'), 'typed values stay private');
assert.equal(describe({ type: 2, token: 't', data: { name: 'info', options: [{ name: 'lookup', type: 1, options: [{ name: 'search', type: 3, value: 'x' }] }] } } as any), '/info lookup (options: search)');
assert.equal(describe({ type: 3, token: 't', data: { custom_id: 'raid:summary:fresh.warcraftlogs.com:AbC' } } as any), 'Button: Quick summary (fresh/AbC)');
assert.ok(auditLine({ ...typed, guild_id: undefined }, 'failed', 500, 'boom').includes('in DMs · **FAILED** after 0.5s: boom'));

// Slow database: reads are retried once, writes aren't (they may already have been saved)
{
  const realFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    return new Response('[{"ok":true}]', { status: 200 });
  }) as typeof fetch;
  assert.deepEqual(await rest('bot_claims'), [{ ok: true }]);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(rest('bot_claims', { method: 'POST', body: '{}' }), /slow to answer/);
  assert.equal(calls, 1);
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Warcraft Logs sign-in after idle: one shared sign-in for parallel requests, retried if it's briefly down
{
  const realFetch = globalThis.fetch;
  process.env.WCL_CLIENT_ID = 'id';
  process.env.WCL_CLIENT_SECRET = 'secret';
  let tokenCalls = 0;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/oauth/token')) {
      tokenCalls++;
      return tokenCalls === 1 ? new Response('busy', { status: 503 }) : new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  }) as typeof fetch;
  const results = await Promise.all([1, 2, 3].map(() => gql('fresh.warcraftlogs.com', '{x}', {})));
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(tokenCalls, 2, 'one 503, then one shared sign-in on the next site');
  globalThis.fetch = realFetch;
}

// Past raids: the raid card (bosses, wipes, attendance) from the saved report and summaries
{
  const meta: any = {
    code: 'ABC', title: 'Gruul + Maggy', startTime: Date.UTC(2026, 9, 15, 19), zone: null,
    fights: [
      { id: 1, encounterID: 1, name: 'High King Maulgar', startTime: 0, endTime: 180000, kill: true, friendlyPlayers: [1, 2] },
      { id: 2, encounterID: 2, name: 'Gruul', startTime: 200000, endTime: 300000, kill: false, friendlyPlayers: [1, 2, 3] },
      { id: 3, encounterID: 2, name: 'Gruul', startTime: 400000, endTime: 700000, kill: true, friendlyPlayers: [1, 2] },
      { id: 4, encounterID: 3, name: 'Magtheridon', startTime: 800000, endTime: 900000, kill: false, friendlyPlayers: [1, 2] },
    ],
    masterData: { actors: [{ id: 1, name: 'Suy', type: 'Player', subType: 'Hunter' }, { id: 2, name: 'Luke', type: 'Player', subType: 'Warrior' }, { id: 3, name: 'Alt', type: 'Player', subType: 'Mage' }, { id: 9, name: 'Town', type: 'Player', subType: 'Rogue' }] },
  };
  const luke = { ...player('Luke', 900, 50), id: 2, className: 'Warrior', specName: 'Protection', role: 'tank' as const };
  const card = buildCard(meta, [
    { ...digest.fights[0], id: 1, players: [{ ...player('Suy', 1500, 90), id: 1 }, luke] },
    { ...digest.fights[1], id: 3, players: [{ ...player('Suy', 1600, 80), id: 1 }, luke] },
  ] as any);
  assert.equal(card.kills, 2);
  assert.deepEqual(card.bosses.map((b) => [b.name, b.kill, b.seconds, b.wipes]), [['High King Maulgar', true, 180, 0], ['Gruul', true, 300, 1], ['Magtheridon', false, null, 1]]);
  assert.equal(card.wipes, 2);
  assert.equal(card.raidSeconds, 900);
  assert.deepEqual(card.raiders.map((r) => [r.name, r.bosses, r.role]), [['Alt', 0, null], ['Luke', 2, 'tank'], ['Suy', 2, 'dps']], 'only people in boss fights, with kills attended');
  assert.ok(card.feedback.work.some((p) => p.title.includes('wipe')));
  assert.equal(card.summarized, 2);
  // Before any kill is read: bosses, wipes and attendance already there, no feedback yet
  const early = buildCard(meta, []);
  assert.equal(early.summarized, 0);
  assert.equal(early.kills, 2);
  assert.deepEqual(early.raiders.map((r) => r.name), ['Alt', 'Luke', 'Suy']);
  assert.deepEqual(early.feedback, { good: [], work: [] });
}

// Healers: DM pages in terms of healing
{
  const healerP = (name: string, hps: number, parse: number) => ({
    ...player(name, 200, 10), className: 'Priest', specName: 'Holy', role: 'healer' as const,
    healing: { total: hps * 180, hps, overhealPct: 30, parse, activePct: 90, abilities: [{ name: 'Circle of Healing', total: hps * 100, overhealPct: 70 }, { name: 'Renew', total: hps * 80, overhealPct: 20 }] },
  });
  const hd = { ...digest, fights: digest.fights.map((f: any) => ({ ...f, players: [healerP('Healz', 1500, 85), healerP('Other', 1200, 60)] })) } as any;
  const q = personalPage('summary', hd, 'Healz', null)!.embeds![0];
  const qf = Object.fromEntries(q.fields!.map((f) => [f.name, f.value]));
  assert.equal(qf['Healing parse'], '85');
  assert.equal(qf['Average HPS'], '1,125', 'healing on kills over time on kills');
  assert.ok(qf['What went well'].includes('Top healer'));
  assert.ok(qf['What to work on'].includes('Circle of Healing overheals'));
  const hb = personalPage('damage', hd, 'Healz', null)!.embeds![0];
  assert.ok(hb.title!.startsWith('Healing breakdown'));
  assert.ok(hb.fields!.some((f) => f.value.includes('**Circle of Healing**')));
  assert.ok(hb.fields!.some((f) => f.name === 'Boss by boss' && f.value.includes('HPS · parse 85')));
  // The raid summary counts healers by their healing parse
  assert.ok(raidFeedback(hd.fights).good.some((p) => p.title.includes('strong performance') && p.who?.includes('Healz')));
}

// Sign-in: Discord sessions carry who you are and the server; older password cookies still work
{
  const secret = 'test-secret';
  process.env.DISCORD_GUILD_ID = 'G1';
  const cookie = (await sessionCookie(secret, { kind: 'discord', uid: '7', name: 'Suy', avatar: null, gid: 'G1', officer: true })).split(';')[0];
  const s = await readSession(cookie, secret);
  assert.equal(s?.uid, '7');
  assert.equal(s?.officer, true);
  assert.ok(forThisGuild(s!));
  assert.equal(await readSession(cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), secret), null, 'tampered cookie refused');
  const other = (await sessionCookie(secret, { kind: 'discord', uid: '7', name: 'Suy', gid: 'G2', officer: true })).split(';')[0];
  assert.ok(!forThisGuild((await readSession(other, secret))!), 'a session for another server doesn\u2019t open this one');
  // The pre-v0.18.0 password cookie: "<expiry>.<signature>"
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const legacy = `gl_session=${await signValue(secret, exp)}`;
  assert.equal((await readSession(legacy, secret))?.kind, 'password');
  // The middleware agrees
  process.env.SESSION_SECRET = secret;
  const mw = (await import('../middleware')).default;
  const at = (c?: string) => mw(new Request('https://guildlog.uk/', { headers: c ? { cookie: c } : {} }));
  assert.equal((await at(cookie)).headers.get('x-middleware-next'), '1');
  assert.equal((await at(legacy)).headers.get('x-middleware-next'), '1');
  assert.equal((await at(other)).status, 401);
  assert.equal((await at()).status, 401);
  process.env.DISCORD_CLIENT_SECRET = 'x';
  process.env.DISCORD_APP_ID = 'app';
  assert.ok((await (await at()).text()).includes('Sign in with Discord'));
  // Shared analysis links open for anyone; nothing else does
  const open = (path: string) => mw(new Request(`https://guildlog.uk${path}`));
  const id = '0b7e5a52-3c1d-4b8e-9f00-1234567890ab';
  assert.equal((await open(`/a/${id}`)).headers.get('x-middleware-next'), '1', 'a shared link opens');
  assert.equal((await open(`/api/history?id=${id}`)).headers.get('x-middleware-next'), '1', 'and its analysis loads');
  assert.equal((await open('/api/history')).status, 401, 'the list of analyses stays private');
  assert.equal((await open('/api/history?id=nope')).status, 401);
  assert.equal((await open('/a/not-an-id')).status, 401);
  assert.equal((await open('/api/snapshot')).status, 401, 'no analyzing without signing in');
  assert.equal((await open('/#/raids')).status, 401);
  delete process.env.DISCORD_CLIENT_SECRET;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.SESSION_SECRET;
}

// Someone who leaves the guild's Discord is refused, even with a sign-in that hasn't expired
{
  const { requireSession, sessionCookie: mk } = await import('../server/auth');
  process.env.SESSION_SECRET = 's';
  process.env.DISCORD_GUILD_ID = 'G1';
  process.env.DISCORD_BOT_TOKEN = 'bot';
  const realFetch = globalThis.fetch;
  const members = new Set(['1']);
  let discordDown = false;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/members/')) {
      if (discordDown) return new Response('oops', { status: 500 });
      return members.has(u.split('/members/')[1]) ? new Response('{}', { status: 200 }) : new Response('{"message":"Unknown Member"}', { status: 404 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const req = async (uid: string) => new Request('https://guildlog.uk/api/x', { headers: { cookie: (await mk('s', { kind: 'discord', uid, name: 'X', gid: 'G1', officer: false })).split(';')[0] } });
  assert.equal(await requireSession(await req('1')), null, 'a member gets in');
  const refused = (await requireSession(await req('2')))!;
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).notMember, true, 'the page can send them to the explanation');
  discordDown = true;
  assert.equal(await requireSession(await req('3')), null, 'Discord unreachable: people carry on');
  globalThis.fetch = realFetch;
  delete process.env.SESSION_SECRET;
  delete process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_BOT_TOKEN;
}

// Admin: only the Discord IDs in SITE_ADMIN_IDS, and never the guild password
process.env.SITE_ADMIN_IDS = '7, 9';
assert.ok(isSiteAdmin({ kind: 'discord', uid: '9', officer: false, exp: 0 }));
assert.ok(!isSiteAdmin({ kind: 'discord', uid: '8', officer: true, exp: 0 }));
assert.ok(!isSiteAdmin({ kind: 'password', officer: false, exp: 0 }));
delete process.env.SITE_ADMIN_IDS;

// Ranks: each rank edits and promotes only below itself; admins come from SITE_ADMIN_IDS
assert.ok(canEdit('guild_master', 'officer') && canEdit('officer', 'raider') && canEdit('admin', 'admin'));
assert.ok(!canEdit('officer', 'officer') && !canEdit('officer', 'guild_master') && !canEdit('guild_master', 'guild_master'));
assert.deepEqual(assignable('admin'), ['raider', 'loot_council', 'raid_assist', 'raid_leader', 'officer', 'guild_master']);
assert.deepEqual(assignable('guild_master'), ['raider', 'loot_council', 'raid_assist', 'raid_leader', 'officer']);
assert.deepEqual(assignable('officer'), ['raider', 'loot_council', 'raid_assist', 'raid_leader']);
assert.deepEqual(assignable('raid_leader'), ['raider', 'loot_council', 'raid_assist']);
// What each rank may do: raid leaders as officers, raid assists run raids, loot council looks people up
assert.ok(can('raid_leader', 'officer') && can('raid_leader', 'raid') && can('raid_leader', 'lookup'));
assert.ok(can('raid_assist', 'raid') && !can('raid_assist', 'lookup') && !can('raid_assist', 'officer'));
assert.ok(can('loot_council', 'lookup') && !can('loot_council', 'raid') && !can('loot_council', 'officer'));
assert.ok(!can('raider', 'lookup') && !can(null, 'raid'));
process.env.SITE_ADMIN_IDS = '1';
assert.equal(effectiveRank('1', 'raider', 'raider'), 'admin');
assert.equal(effectiveRank('2', 'officer', 'raider'), 'officer', 'a rank set on the Admin page wins over Discord');
assert.equal(effectiveRank('2', null, 'guild_master'), 'guild_master');
assert.equal(discordRank({ owner: true, officer: true }), 'guild_master');
// Editing is checked on the server too: an officer can't change another officer
{
  const realFetch = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  const sent: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push(`${init?.method ?? 'GET'} ${url}`);
    if (String(url).includes('site_users?order')) return new Response(JSON.stringify([
      { discord_id: '5', username: 'off', name: 'Off', rank: null, discord_rank: 'officer', officer: true, sign_ins: 1, first_seen: '', last_seen: '' },
      { discord_id: '6', username: 'rai', name: 'Rai', rank: null, discord_rank: 'raider', officer: false, sign_ins: 1, first_seen: '', last_seen: '' },
    ]), { status: 200 });
    if (String(url).includes('bot_claims?select')) return new Response('[]', { status: 200 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  await assert.rejects(applyEdit({ action: 'rank', id: '5', rank: 'raider' }, { id: '7', name: 'X', rank: 'officer' }), /only change people below/);
  await assert.rejects(applyEdit({ action: 'rank', id: '6', rank: 'officer' }, { id: '7', name: 'X', rank: 'officer' }), /can\u2019t give the Officer rank/);
  assert.match(await applyEdit({ action: 'rank', id: '6', rank: 'officer' }, { id: '8', name: 'GM', rank: 'guild_master' }), /set Rai .* rank to Officer/);
  assert.ok(sent.some((x) => x.startsWith('PATCH') && x.includes('site_users?discord_id=eq.6')));
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}
delete process.env.SITE_ADMIN_IDS;

// The guild page: progress per raid from Past raids, the roster, and Warcraft Logs ranks
{
  const { roster, wclGuild, zoneProgress } = await import('../server/guildPage');
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  process.env.WCL_CLIENT_ID = 'id';
  process.env.WCL_CLIENT_SECRET = 'secret';
  process.env.WCL_GUILD_ID = '773392';
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('fight_packs')) return new Response(JSON.stringify([{ report_code: 'K1', zone: { id: 1007, name: 'Karazhan' } }, { report_code: 'K2', zone: { id: 1007, name: 'Karazhan' } }]), { status: 200 });
    if (u.includes('/oauth/token')) return new Response('{"access_token":"t","expires_in":3600}', { status: 200 });
    const query = JSON.parse(String(init.body)).query as string;
    asked.push(query);
    if (query.includes('zoneRanking')) return new Response(JSON.stringify({ data: { guildData: { guild: { z1007: { progress: { worldRank: { number: 1234, color: 'rare' }, regionRank: { number: 321, color: 'rare' }, serverRank: { number: 4, color: 'legendary' } }, speed: null } } } } }), { status: 200 });
    return new Response(JSON.stringify({ data: { guildData: { guild: { id: 773392, name: 'lol', faction: { name: 'Horde' }, server: { name: 'Spineshatter', region: { slug: 'eu' } } } } } }), { status: 200 });
  }) as typeof fetch;
  const raid = (code: string, start: string, kills: [string, number | null][]) => ({
    code, host: 'fresh.warcraftlogs.com', title: code, startTime: start, endTime: start, loggerName: null, source: 'discord', status: 'saved', saved: 1, total: 1,
    card: { bosses: kills.map(([name, secs], i) => ({ name, encounterId: i + 1, fightId: i + 10, kill: secs !== null, seconds: secs, wipes: 0 })), raidSeconds: 1, wipes: 0, deaths: 0, avgItemLevel: null,
      raiders: [{ name: 'Suy', className: 'Hunter', specName: 'BeastMastery', role: 'dps', bosses: 2 }, ...(code === 'K2' ? [{ name: 'Luke', className: 'Warrior', specName: 'Protection', role: 'tank', bosses: 2 }] : [])], kills: 2, summarized: 2, feedback: { good: [], work: [] } },
  });
  const recent = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const raids: any[] = [raid('K2', recent(3), [['Attumen', 100], ['Moroes', null]]), raid('K1', recent(10), [['Attumen', 120], ['Moroes', 150]])];
  const zones = await zoneProgress(raids);
  assert.equal(zones.length, 1);
  assert.deepEqual([zones[0].name, zones[0].killed, zones[0].total], ['Karazhan', 2, 2]);
  const att = zones[0].bosses[0];
  assert.deepEqual([att.kills, att.best?.seconds, att.best?.code, att.firstKill], [2, 100, 'K2', raids[1].startTime], 'fastest kill and first kill');
  assert.deepEqual(roster(raids).map((p) => [p.name, p.raids, p.of]), [['Suy', 2, 2], ['Luke', 1, 2]]);
  const g = await wclGuild([1007]);
  assert.equal(g.guild?.url, 'https://fresh.warcraftlogs.com/guild/id/773392');
  assert.equal(g.guild?.region, 'EU');
  assert.deepEqual(g.ranks.get(1007)?.progress?.server, { number: 4, color: 'legendary' });
  const n = asked.length;
  await wclGuild([1007]);
  assert.equal(asked.length, n, 'Warcraft Logs asked at most once an hour');
  globalThis.fetch = realFetch;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WCL_CLIENT_ID', 'WCL_CLIENT_SECRET', 'WCL_GUILD_ID']) delete process.env[k];
}


// ---------- /performance ----------
{
  const { summarize, performanceMessage } = await import('../server/discord/performance.js');
  const perfDenied: any = await handle({ type: 2, token: 't', guild_id: 'g', channel_id: 'c', member: { user: { id: '2', username: 'x' }, roles: [], permissions: '0' }, data: { name: 'performance', options: [] } });
  assert.match(perfDenied.response.data.content, /Only officers/, '/performance is officers only');
  const row = (name: string, boss: string, parse: number, extra: any = {}) => ({ report_code: 'R1', start_time: `2026-10-0${boss.length % 9}T20:00:00Z`, encounter_name: boss, name, class_name: 'Mage', spec_name: 'Fire', role: 'dps', healer: false, parse, hps_parse: null, deaths: 0, item_level: 120, ...extra });
  const rows = [
    row('Star', 'Gruul', 95), row('Star', 'Maulgar', 88),
    row('Slow', 'Gruul', 12, { deaths: 1, item_level: 100 }), row('Slow', 'Maulgar', 20, { deaths: 1, item_level: 100 }),
    row('Tank', 'Gruul', 0, { role: 'tank', class_name: 'Warrior', spec_name: 'Protection' }), row('Tank', 'Maulgar', 0, { role: 'tank', class_name: 'Warrior', spec_name: 'Protection' }),
    row('Once', 'Gruul', 50),
  ];
  const data = summarize(rows as any);
  assert.equal(data.skipped, 1, 'one-kill players are left out');
  assert.equal(data.players.find((p) => p.name === 'Tank')!.parse, null, 'tanks aren’t judged on parses');
  const msg = performanceMessage({ label: 'the last 4 weeks', oneNight: false, minKills: 2 }, data, 'https://guildlog.uk');
  const text = JSON.stringify(msg);
  assert.match(msg.embeds![0].fields![0].value, /Star/, 'high performer listed');
  assert.match(msg.embeds![0].fields![1].value, /Slow[\s\S]*average parse 16 \(highest 20\)[\s\S]*died 2 times in 2 kills[\s\S]*item level/, 'low performer with reasons');
  assert.doesNotMatch(msg.embeds![0].fields![1].value, /Tank/, 'tank not listed for a low parse');
  assert.match(text, /Just an overview/, 'has the caveat');
  for (const e of msg.embeds!) for (const f of e.fields ?? []) assert.ok(f.value.length <= 1024, 'field within Discord limits');
  assert.ok(text.length < 6000, 'message within Discord limits');
  const { rowsFromDigests } = await import('../server/discord/performance.js');
  const fromLink = rowsFromDigests('R2', 0, [{ id: 3, name: 'Gruul', encounterID: 649, kill: true, startTime: 1000, endTime: 61000, seconds: 60, players: [{ name: 'Star', className: 'Mage', specName: 'Fire', role: 'dps', parse: 90, deaths: [], itemLevel: 120, total: 1, healing: undefined }] }, { id: 4, name: 'Trash', encounterID: 0, kill: false, players: [] }] as any);
  assert.equal(fromLink.length, 1, 'a pasted raid counts boss kills only');
  assert.equal(summarize(fromLink, 1).players.length, 1, 'a single fight counts with one kill');
  // Picking a past raid: every raid on Past raids, searchable, plus a pasted link
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { report_code: 'NEW1', host: 'fresh.warcraftlogs.com', title: 'Kara 2', start_time: '2026-10-20T19:00:00Z' },
    { report_code: 'OLD9', host: 'fresh.warcraftlogs.com', title: 'Gruul + Mag', start_time: '2026-04-22T18:47:00Z' },
  ]), { status: 200 })) as typeof fetch;
  const ask = (value: string) => handle({ type: 4, token: 't', data: { name: 'performance', options: [{ name: 'raid', type: 3, value, focused: true }] } } as any) as any;
  const all = (await ask('')).response.data.choices;
  assert.deepEqual(all.map((c: any) => c.value), ['fresh.warcraftlogs.com:NEW1', 'fresh.warcraftlogs.com:OLD9'], 'every past raid, newest first');
  assert.match(all[1].name, /Gruul \+ Mag · Wed, Apr 22, 2026/);
  assert.deepEqual((await ask('gruul')).response.data.choices.map((c: any) => c.value), ['fresh.warcraftlogs.com:OLD9'], 'searchable');
  assert.equal((await ask('https://fresh.warcraftlogs.com/reports/ABC?fight=3')).response.data.choices[0].name, 'Use this Warcraft Logs link');
  globalThis.fetch = realFetch;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

// /performance character: one person's breakdown, boss by boss, and who to pick from
{
  const { characterMessage } = await import('../server/discord/performance.js');
  const row = (name: string, boss: string, parse: number | null, extra: any = {}) => ({ report_code: 'R1', start_time: '2026-10-01T20:00:00Z', encounter_name: boss, name, class_name: 'Priest', spec_name: 'Shadow', role: 'dps', healer: false, parse, hps_parse: null, deaths: 0, item_level: 114, ...extra });
  const rows = [row('Aerdre', 'Maulgar', 88), row('Aerdre', 'Gruul', 30, { deaths: 1 }), row('Ilrox', 'Maulgar', 96), row('Ilrox', 'Gruul', 92)];
  const m = characterMessage({ label: 'ID 10', oneNight: true, minKills: 1 }, rows as any, 'aerdre', 'https://guildlog.uk');
  assert.match(m.embeds![0].description!, /average parse 59 \(highest 88\) · died once in 2 kills/);
  assert.match(m.embeds![0].fields![0].value, /\*\*Maulgar\*\* · parse 88/);
  assert.match(m.embeds![0].fields![1].value, /\*\*Gruul\*\* · parse 30 · died once[\s\S]*Try:/);
  assert.match(m.embeds![1].description!, /other damage dealers averaged a parse of 94; Aerdre: 59/);
  assert.match(JSON.stringify(m), /Just an overview/);
  assert.match(characterMessage({ label: 'ID 10', oneNight: true, minKills: 1 }, rows as any, 'Nobody', '').embeds![0].description!, /isn\u2019t in any boss kill/);
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  const realFetch = globalThis.fetch;
  let asked = '';
  globalThis.fetch = (async (url: string) => {
    asked = String(url);
    return new Response(JSON.stringify(rows.map((r) => ({ ...r, report_code: 'OLD9' }))), { status: 200 });
  }) as typeof fetch;
  const pick = await handle({ type: 4, token: 't', data: { name: 'performance', options: [{ name: 'raid', type: 3, value: 'fresh.warcraftlogs.com:OLD9' }, { name: 'character', type: 3, value: 'ae', focused: true }] } } as any) as any;
  assert.ok(asked.includes('report_code=eq.OLD9'), 'lists who was in the chosen raid');
  assert.deepEqual(pick.response.data.choices, [{ name: 'Aerdre (Shadow Priest)', value: 'Aerdre' }]);
  globalThis.fetch = realFetch;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

// /check <character>: anyone's character for officers (by DM), only your own for everyone else
{
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  process.env.DISCORD_BOT_TOKEN = 'bot';
  process.env.SITE_ADMIN_IDS = '42';
  const realFetch = globalThis.fetch;
  const dms: any[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'discord.com') {
      if (u.pathname.endsWith('/users/@me/channels')) return new Response('{"id":"dm1"}', { status: 200 });
      if (u.pathname.includes('/channels/dm1/messages')) dms.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    }
    if (u.pathname.endsWith('/bot_claims') && !u.searchParams.get('discord_id')?.includes('5') && u.searchParams.has('discord_id')) return new Response('[]', { status: 200 });
    if (u.pathname.endsWith('/bot_claims')) return new Response(JSON.stringify([{ character: 'Luke', realm: 'Spineshatter', discord_name: 'luke', status: 'approved', discord_id: '5' }]), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const ask = (id: string) => handle({ type: 2, token: 't', guild_id: 'g', channel_id: 'c', member: { user: { id, username: 'x' }, roles: [], permissions: '0' }, data: { name: 'check', options: [{ name: 'character', type: 3, value: 'luke' }] } } as any);
  const raider: any = await ask('2');
  await raider.after();
  assert.equal(dms.length, 0, 'raiders can’t look up other people');
  const officer: any = await ask('42');
  await officer.after();
  assert.equal(dms.length, 1, 'officers get it by DM');
  assert.equal(dms[0].embeds[0].title, 'Luke');
  assert.match(dms[0].embeds[0].footer.text, /Claimed by luke/);
  globalThis.fetch = realFetch;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DISCORD_BOT_TOKEN', 'SITE_ADMIN_IDS']) delete process.env[k];
}

// The new ranks in Discord: loot council looks people up, raid assists run the raid
{
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_x';
  const realFetch = globalThis.fetch;
  const ranks: Record<string, string> = { '51': 'loot_council', '52': 'raid_assist' };
  globalThis.fetch = (async (url: string) => {
    const u = new URL(String(url));
    const id = u.searchParams.get('discord_id')?.replace('eq.', '');
    if (u.pathname.endsWith('/site_users') && id) return new Response(JSON.stringify(ranks[id] ? [{ discord_id: id, rank: ranks[id], blocked: false }] : []), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const run = (id: string, name: string, options: any[] = []) => handle({ type: 2, token: 't', guild_id: 'g', channel_id: 'c', member: { user: { id, username: 'x' }, roles: [], permissions: '0' }, data: { name, options } } as any) as any;
  assert.equal((await run('51', 'performance')).response.type, 5, 'loot council can use /performance');
  assert.match((await run('51', 'remind', [{ name: 'message', type: 3, value: 'x' }, { name: 'time', type: 3, value: '19:45' }])).response.data.content, /Only officers, raid leaders and raid assists/);
  assert.match((await run('52', 'performance')).response.data.content, /Only officers, raid leaders and loot council/);
  assert.doesNotMatch(JSON.stringify((await run('52', 'remind', [{ name: 'message', type: 3, value: 'x' }, { name: 'time', type: 3, value: '19:45' }])).response), /Only officers/, 'raid assists can use /remind');
  globalThis.fetch = realFetch;
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

console.log('All bot checks passed.');
