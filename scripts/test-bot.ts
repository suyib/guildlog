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
import { assignable, canEdit, discordRank, effectiveRank } from '../server/ranks';
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
assert.equal(fieldsOf('overview')['Average parse'], '85');
assert.ok(fieldsOf('overview')['Boss by boss'].includes('#1 of 1 in the raid'));
assert.ok(fieldsOf('gear')['What to work on'].includes('No enchant on: head'));
assert.equal(fieldsOf('gear')['Enchants'], '0 of 1');
assert.ok(fieldsOf('rotation')['Cooldowns (all kills)'].includes('**Bestial Wrath**: 2 of 4 · room for 2 more'));
assert.ok(fieldsOf('damage')['Top abilities (share of your damage)'].includes('**Steady Shot**'));
assert.ok(fieldsOf('survival')['What went well'].includes('No deaths'));
for (const page of ['summary', 'overview', 'damage', 'rotation', 'gear', 'survival'] as const) {
  const e = personalPage(page, digest, 'suy', null)!.embeds![0];
  assert.ok(e.fields!.length <= 25 && e.fields!.every((f) => f.value.length <= 1024 && f.value.length > 0), `${page} fits Discord`);
}
assert.equal(personalPage('overview', digest, 'Nobody', null), null);

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
  assert.ok(personalPage('overview', hd, 'Healz', null)!.embeds![0].fields!.some((f) => f.value.includes('#1 of 2 healers')));
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
assert.deepEqual(assignable('admin'), ['raider', 'officer', 'guild_master']);
assert.deepEqual(assignable('guild_master'), ['raider', 'officer']);
assert.deepEqual(assignable('officer'), ['raider']);
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

console.log('All bot checks passed.');
