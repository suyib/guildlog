// Checks for boss rankings (server/bossRanks.ts) against a fake Warcraft Logs.
import assert from 'node:assert/strict';
process.env.WCL_CLIENT_ID = 'id';
process.env.WCL_CLIENT_SECRET = 'secret';
process.env.WCL_GUILD_ID = '42';
const queries: { query: string; variables: any }[] = [];
const ranking = (n: number, guildId: number, name: string) => ({ guild: { id: guildId, name }, server: { name: 'Nightslayer', region: 'US' }, startTime: 1_780_000_000_000 + n, duration: 300_000 + n * 1000 });
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
  const body = JSON.parse(String(init.body));
  queries.push(body);
  if (body.query.includes('guildData')) return new Response(JSON.stringify({ data: { guildData: { guild: { id: 42, name: 'who', faction: { name: 'Horde' }, server: { name: 'Nightslayer', slug: 'nightslayer', region: { slug: 'us' } } } } } }), { status: 200 });
  const page = body.variables.page;
  const list = Array.from({ length: 100 }, (_, i) => ranking((page - 1) * 100 + i, page === 2 && i === 11 ? 42 : 1000 + i, page === 2 && i === 11 ? 'who' : `Guild ${i}`));
  return new Response(JSON.stringify({ data: { worldData: { encounter: { fightRankings: { page, hasMorePages: true, rankings: list } } } } }), { status: 200 });
}) as typeof fetch;

const { bossRanks } = await import('../server/bossRanks.js');
const r = await bossRanks('fresh.warcraftlogs.com', 652, 'speed', 'realm');
assert.equal(r.top.length, 20, 'shows the top 20');
assert.equal(r.top[0].rank, 1);
assert.deepEqual(r.mine && r.mine.rank, 112, 'finds the guild on page 2');
assert.equal(r.checked, 200, 'stops once the guild is found');
const q = queries.filter((x) => x.query.includes('fightRankings'));
assert.ok(q[0].query.includes('metric:speed') && q[0].query.includes('serverSlug:$slug'), 'asks for the realm by speed');
assert.equal(q[0].variables.slug, 'nightslayer');
assert.equal(q[0].variables.region, 'US');
await bossRanks('fresh.warcraftlogs.com', 652, 'speed', 'realm');
assert.equal(queries.filter((x) => x.query.includes('fightRankings')).length, 2, 'kept for an hour');
await assert.rejects(bossRanks('evil.example.com', 652, 'speed', 'world'));
const w = await bossRanks('fresh.warcraftlogs.com', 652, 'nonsense', 'world');
assert.equal(w.metric, 'progress', 'unknown metrics fall back to first kill');
assert.ok(!queries.at(-1)!.query.includes('serverRegion'), 'world has no region filter');
console.log('All ranking checks passed.');
