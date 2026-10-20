// Offline checks of the Discord bot: request signatures, command replies and DM pages.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { POST } from '../api/discord';
import { COMMANDS, handle, reminderMessage } from '../server/discord/commands';
import type { RaidDigest } from '../server/discord/digest';
import { personalPage, raidSummary } from '../server/discord/pages';

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
const overview = personalPage('overview', digest, 'suy', null)!;
assert.ok(overview.embeds![0].description!.includes('average parse **85**'));
assert.ok(personalPage('gear', digest, 'Suy', 'Thunderstrike')!.embeds![0].description!.includes('no enchant on: head'));
assert.equal(personalPage('overview', digest, 'Nobody', null), null);

// Quick summary: the at-a-glance page with what went well and what to work on
const quick = personalPage('summary', digest, 'Suy', null)!;
const [goodField, workField] = quick.embeds![0].fields!;
assert.equal(goodField.name, 'What went well');
assert.ok(goodField.value.includes('No deaths'));
assert.ok(workField.value.includes('Bestial Wrath 2/4'), 'under-used cooldowns are listed');
assert.ok(workField.value.includes('No enchant on: head'));
// Six page buttons, split across two rows (Discord allows five per row)
assert.equal(summary.components!.length, 2);

console.log('All bot checks passed.');
