// Offline checks of the Discord bot: request signatures, command replies and DM pages.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { POST } from '../api/discord';
import { COMMANDS, handle, reminderMessage } from '../server/discord/commands';
import type { RaidDigest } from '../server/discord/digest';
import { personalPage, raidSummary } from '../server/discord/pages';
import { activeOver, raidFeedback } from '../server/raidFeedback';
import { auditLine, describe } from '../server/discord/audit';

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
const siteButton = (summary.components![1] as any).components.at(-1);
assert.equal(siteButton.style, 5);
assert.equal(siteButton.url, 'https://guildlog.uk/?log=' + encodeURIComponent('https://fresh.warcraftlogs.com/reports/ABC'));
assert.ok((summary.components![1] as any).components.length <= 5);

// /help lists every command, only to the person who asked
const help: any = await handle({ type: 2, token: 't', user: { id: '1', username: 'suy' }, data: { name: 'help' } });
assert.equal(help.response.data.flags, 64);
const helpText = JSON.stringify(help.response.data.embeds);
for (const c of COMMANDS) assert.ok(helpText.includes(`/${c.name}`) || c.name === 'help', `/help is missing /${c.name}`);
assert.ok(help.response.data.embeds[0].fields.every((f: any) => f.value.length <= 1024));

// Activity log: who, what and where, never what they typed
const typed = { type: 2, token: 't', guild_id: 'g', channel_id: '55', member: { user: { id: '7', username: 'suy' }, roles: [] },
  data: { name: 'remind', options: [{ name: 'message', type: 3, value: 'secret plans' }, { name: 'time', type: 3, value: '19:45' }] } } as any;
const line = auditLine(typed, 'ok', 1200);
assert.ok(line.includes('/remind (options: message, time)') && line.includes('<@7> (suy)') && line.includes('in <#55>') && line.includes('ok, 1.2s'));
assert.ok(!line.includes('secret plans') && !line.includes('19:45'), 'typed values stay private');
assert.equal(describe({ type: 2, token: 't', data: { name: 'info', options: [{ name: 'lookup', type: 1, options: [{ name: 'search', type: 3, value: 'x' }] }] } } as any), '/info lookup (options: search)');
assert.equal(describe({ type: 3, token: 't', data: { custom_id: 'raid:summary:fresh.warcraftlogs.com:AbC' } } as any), 'Button: Quick summary (fresh/AbC)');
assert.ok(auditLine({ ...typed, guild_id: undefined }, 'failed', 500, 'boom').includes('in DMs · **FAILED** after 0.5s: boom'));

console.log('All bot checks passed.');
