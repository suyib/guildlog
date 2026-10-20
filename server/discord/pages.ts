// What the bot posts: the raid summary in the channel, and each person's own summaries by DM.
import { BRAND, type Embed, type MessageBody, button, env, linkButton, row } from './api.js';
import { activeOver, raidFeedback } from '../raidFeedback.js';
import type { RaidPoint } from '../types.js';
import { type FightDigest, type PlayerDigest, type RaidDigest, playerFights } from './digest.js';

export type Page = 'summary' | 'overview' | 'damage' | 'rotation' | 'gear' | 'survival';

export const PAGES: { id: Page; label: string }[] = [
  { id: 'summary', label: 'Quick summary' },
  { id: 'overview', label: 'My overview' },
  { id: 'rotation', label: 'Rotation & cooldowns' },
  { id: 'damage', label: 'Damage breakdown' },
  { id: 'gear', label: 'Gear & stats' },
  { id: 'survival', label: 'Survival' },
];

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.round(Math.max(0, s)) % 60).padStart(2, '0')}`;
/** 8040 -> "2h 14m" */
const hm = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)}m`);
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const clip = (s: string, max = 1024) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Buttons under a raid message: each sends that page to whoever clicks it, by DM. `raid` is "host:code". */
export function pageButtons(raid: string) {
  const b = PAGES.map((p) => button(p.label, `raid:${p.id}:${raid}`, p.id === 'summary' ? 1 : 2));
  return [row(...b.slice(0, 3)), row(...b.slice(3))]; // Discord allows 5 buttons per row
}

/** Link to the full analysis on the site for one fight and player. */
export function siteLink(host: string, code: string, fightId: number, sourceId: number) {
  const log = `https://${host}/reports/${code}?fight=${fightId}&source=${sourceId}`;
  return `${env.site()}/?log=${encodeURIComponent(log)}`;
}

// ---------- Channel: overall raid summary (no individual numbers) ----------

export function raidSummary(digest: RaidDigest, loggerId: string | null): MessageBody {
  const { meta } = digest;
  const bosses = meta.fights.filter((f) => f.encounterID > 0);
  const encounterIds = [...new Set(bosses.map((f) => f.encounterID))];
  const killed = encounterIds.filter((id) => bosses.some((f) => f.encounterID === id && f.kill));
  const wipes = bosses.filter((f) => !f.kill).length;
  const first = bosses[0]?.startTime ?? 0;
  const last = bosses.at(-1)?.endTime ?? 0;
  const deaths = digest.fights.reduce((t, f) => t + f.players.reduce((s, p) => s + p.deaths.length, 0), 0);
  const raidSize = new Set(digest.fights.flatMap((f) => f.players.map((p) => p.name))).size;

  const lines = encounterIds.map((id) => {
    const tries = bosses.filter((f) => f.encounterID === id);
    const kill = tries.find((f) => f.kill);
    const name = tries[0].name;
    return kill
      ? `**${name}**: killed in ${mmss((kill.endTime - kill.startTime) / 1000)}${tries.length > 1 ? ` (${tries.length - 1} wipe${tries.length > 2 ? 's' : ''})` : ''}`
      : `**${name}**: not killed (${tries.length} attempt${tries.length > 1 ? 's' : ''})`;
  });

  // Raid-wide only: no names, so nobody is singled out in the channel
  const feedback = raidFeedback(digest.fights, {
    skipKills: true,
    wipes: encounterIds
      .map((id) => ({ boss: bosses.find((f) => f.encounterID === id)!.name, count: bosses.filter((f) => f.encounterID === id && !f.kill).length }))
      .filter((w) => w.count > 0),
  });
  const points = (list: RaidPoint[]) => clip(list.slice(0, 4).map((p) => `• **${p.title}**: ${p.detail}`).join('\n'));
  const feedbackFields = [
    ...(feedback.good.length ? [{ name: 'What went well', value: points(feedback.good) }] : []),
    ...(feedback.work.length ? [{ name: 'What to work on', value: points(feedback.work) }] : []),
  ];

  const embed: Embed = {
    title: `Raid summary: ${meta.title}`,
    url: `https://${digest.host}/reports/${digest.code}`,
    color: BRAND,
    description: lines.join('\n') || 'No boss fights in this log.',
    fields: [
      { name: 'Bosses killed', value: `${killed.length} of ${encounterIds.length}`, inline: true },
      { name: 'Raid time', value: last > first ? hm((last - first) / 1000) : '–', inline: true },
      { name: 'Wipes', value: String(wipes), inline: true },
      { name: 'Raiders', value: raidSize ? String(raidSize) : '–', inline: true },
      { name: 'Deaths on kills', value: String(deaths), inline: true },
      ...feedbackFields,
    ],
    footer: { text: 'Click a button below to get your own numbers by DM' },
    timestamp: new Date(meta.startTime).toISOString(),
  };
  const logged = loggerId ? `Logged by <@${loggerId}>. ` : '';
  return {
    content: `${logged}${digest.pending ? `Still reading ${digest.pending} boss${digest.pending > 1 ? 'es' : ''} from Warcraft Logs; your summaries include them once they're ready.` : ''}`.trim() || undefined,
    embeds: [embed],
    components: pageButtons(`${digest.host}:${digest.code}`),
    allowed_mentions: { users: loggerId ? [loggerId] : [] },
  };
}

// ---------- DMs: one person's numbers ----------
// Same look as the raid summary: a few headline numbers side by side, then short bold-titled points.

type Point = { title: string; detail: string };
type Field = NonNullable<Embed['fields']>[number];
type Rows = { fight: FightDigest; p: PlayerDigest }[];

const bullets = (points: Point[], max = 6) => points.slice(0, max).map((x) => `• **${x.title}**: ${x.detail}`).join('\n');
const stat = (name: string, value: string): Field => ({ name, value: value || '–', inline: true });
const block = (name: string, value: string): Field[] => (value ? [{ name, value: clip(value) }] : []);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bosses = (n: number) => plural(n, 'boss', 'bosses');
const avg = (xs: number[]) => (xs.length ? xs.reduce((t, v) => t + v, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Long lists (gear) split over several fields so nothing gets cut off. */
function chunked(name: string, lines: string[]): Field[] {
  const out: Field[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if ([...cur, line].join('\n').length > 1024 && cur.length) {
      out.push({ name: out.length ? `${name} (continued)` : name, value: cur.join('\n') });
      cur = [];
    }
    cur.push(clip(line));
  }
  if (cur.length) out.push({ name: out.length ? `${name} (continued)` : name, value: cur.join('\n') });
  return out;
}

/** Discord allows 25 fields and 6000 characters per embed; drop from the end until it fits. */
function fit(embed: Embed): Embed {
  const fields = (embed.fields ?? []).slice(0, 25);
  const size = () => (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + fields.reduce((t, f) => t + f.name.length + f.value.length, 0);
  while (fields.length && size() > 5900) fields.pop();
  return { ...embed, fields };
}

/** Others in the raid playing the same spec on that fight. */
const peersOf = (fight: FightDigest, p: PlayerDigest) => fight.players.filter((x) => x.name !== p.name && x.className === p.className && x.specName === p.specName);

/** Where you placed on damage in the raid ("#3 of 18"), among damage dealers and tanks. */
function rank(fight: FightDigest, p: PlayerDigest) {
  const pool = fight.players.filter((x) => (p.role === 'healer' ? true : x.role !== 'healer'));
  const sorted = [...pool].sort((a, b) => b.dps - a.dps);
  return { place: sorted.findIndex((x) => x.name === p.name) + 1, of: sorted.length };
}

function sumCooldowns(rows: Rows) {
  const cds = new Map<string, { uses: number; possible: number }>();
  for (const { p } of rows) for (const c of p.cooldowns) {
    const x = cds.get(c.name) ?? { uses: 0, possible: 0 };
    cds.set(c.name, { uses: x.uses + c.uses, possible: x.possible + c.possible });
  }
  return cds;
}

function headline(rows: Rows) {
  const parsed = rows.filter((r) => r.p.parse !== null);
  const best = [...parsed].sort((a, b) => b.p.parse! - a.p.parse!)[0];
  const worst = [...parsed].sort((a, b) => a.p.parse! - b.p.parse!)[0];
  const total = rows.reduce((t, r) => t + r.p.total, 0);
  const seconds = rows.reduce((t, r) => t + r.fight.seconds, 0) || 1;
  const activeAvg = activeOver(rows);
  const ilvl = [...rows].reverse().find((r) => r.p.itemLevel)?.p.itemLevel ?? null;
  return {
    parseAvg: avg(parsed.map((r) => r.p.parse!)),
    best,
    worst,
    total,
    dps: total / seconds,
    deaths: rows.reduce((t, r) => t + r.p.deaths.length, 0),
    activeAvg,
    ilvl,
    gearRow: [...rows].reverse().find((r) => r.p.gear?.length),
  };
}

const missingEnchants = (p?: PlayerDigest) => (p?.gear ?? []).filter((g) => g.enchantable && !g.enchant && !g.enchantId).map((g) => g.slotName.toLowerCase());

export function personalPage(page: Page, digest: RaidDigest, character: string, realm: string | null): MessageBody | null {
  const rows = playerFights(digest, character, realm);
  if (rows.length === 0) return null;
  const me = rows[0].p;
  const head = `${me.name} · ${spaced(me.specName)} ${spaced(me.className)}`.trim();
  const base: Embed = { color: BRAND, url: `https://${digest.host}/reports/${digest.code}`, footer: { text: `${digest.meta.title} · ${new Date(digest.meta.startTime).toLocaleDateString('en-GB')}` } };
  const best = [...rows].sort((a, b) => (b.p.parse ?? -1) - (a.p.parse ?? -1))[0];
  const links = row(
    linkButton('Open full analysis', siteLink(digest.host, digest.code, best.fight.id, best.p.id)),
    linkButton('Warcraft Logs', `https://${digest.host}/reports/${digest.code}`),
  );
  const pendingNote = digest.pending ? `\n_${bosses(digest.pending)} still being read; press the button again in a minute to include ${digest.pending > 1 ? 'them' : 'it'}._` : '';
  const intro = `${bosses(rows.length)} in ${digest.meta.title}.${pendingNote}`;

  const build: Record<Page, () => Embed> = {
    summary: () => ({ ...base, title: `Quick summary: ${head}`, description: intro, fields: summaryFields(rows) }),
    overview: () => ({ ...base, title: `Your raid: ${head}`, description: intro, fields: overviewFields(rows) }),
    damage: () => ({ ...base, title: `Damage breakdown: ${head}`, description: intro, fields: damageFields(rows) }),
    rotation: () => ({ ...base, title: `Rotation & cooldowns: ${head}`, description: intro, fields: rotationFields(rows) }),
    gear: () => ({ ...base, title: `Gear & stats: ${head}`, description: gearIntro(rows), fields: gearFields(rows) }),
    survival: () => ({
      ...base,
      title: `Survival: ${head}`,
      description: `${intro}\n_"Likely avoidable" means it hit fewer than half of the non-tanks. Check the boss mechanics before treating it as a mistake._`,
      fields: survivalFields(rows),
    }),
  };
  return { embeds: [fit(build[page]())], components: [links] };
}

// ---------- Quick summary ----------

function summaryFields(rows: Rows): Field[] {
  const h = headline(rows);
  const q = quickSummary(rows);
  return [
    stat('Bosses', String(rows.length)),
    stat('Average parse', h.parseAvg !== null ? String(Math.round(h.parseAvg)) : '–'),
    stat('Best boss', h.best ? `${h.best.fight.name} (${Math.round(h.best.p.parse!)})` : '–'),
    stat('Average DPS', n0(h.dps)),
    stat('Active time', h.activeAvg !== null ? `${h.activeAvg.toFixed(1)}%` : '–'),
    stat('Deaths', String(h.deaths)),
    { name: 'What went well', value: clip(bullets(q.good) || 'Nothing stood out this time.') },
    { name: 'What to work on', value: clip(bullets(q.work) || 'Nothing stood out. Nice work.') },
  ];
}

function quickSummary(rows: Rows): { good: Point[]; work: Point[] } {
  const good: Point[] = [];
  const work: Point[] = [];
  const me = rows[0].p;
  const h = headline(rows);
  const specName = `${spaced(me.specName)} ${spaced(me.className)}`.trim();

  // Parses
  if (h.best && h.best.p.parse! >= 75) good.push({ title: `Best boss: ${h.best.fight.name}`, detail: `Parse ${Math.round(h.best.p.parse!)}, better than most ${specName}s on that boss.` });
  if (h.worst && h.parseAvg !== null && rows.length > 1 && h.parseAvg - h.worst.p.parse! >= 15) {
    work.push({ title: `Weakest boss: ${h.worst.fight.name}`, detail: `Parse ${Math.round(h.worst.p.parse!)} against your average of ${Math.round(h.parseAvg)}. Open the full analysis for that fight to see what was different.` });
  }

  // Against others of the same spec in the raid
  let topCount = 0;
  const behind: string[] = [];
  for (const { fight, p } of rows) {
    const peers = peersOf(fight, p);
    if (!peers.length) continue;
    const bestPeer = Math.max(...peers.map((x) => x.dps));
    if (p.dps >= bestPeer) topCount++;
    else if (p.dps < bestPeer * 0.9) behind.push(fight.name);
  }
  if (topCount) good.push({ title: `Top ${specName} in the raid`, detail: `Highest damage of your spec on ${bosses(topCount)}.` });
  if (behind.length) work.push({ title: `Behind the best ${specName}`, detail: `More than 10% behind on ${behind.slice(0, 3).join(', ')}. The rotation page shows where the gap is.` });

  // Deaths
  const deaths = rows.flatMap((r) => r.p.deaths.map((d) => `${r.fight.name} (${d.by})`));
  if (!deaths.length) good.push({ title: 'No deaths', detail: `You survived all ${bosses(rows.length)}. Staying alive is the biggest damage gain there is.` });
  else work.push({ title: `Died ${deaths.length}×`, detail: `${deaths.slice(0, 3).join(', ')}. The survival page has the details.` });

  // Activity
  if (h.activeAvg !== null && h.activeAvg >= 95) good.push({ title: 'Always busy', detail: `Active ${h.activeAvg.toFixed(1)}% of the time (bosses you survived, weighted by length); very little time spent not casting.` });
  else if (h.activeAvg !== null && h.activeAvg < 90) work.push({ title: 'Time spent not casting', detail: `Active ${h.activeAvg.toFixed(1)}% of the time on average; aim for 95% or more. Pre-positioning and instant casts while moving help.` });

  // Cooldowns
  const cds = sumCooldowns(rows);
  const under = [...cds].filter(([, c]) => c.uses < c.possible);
  if (cds.size && !under.length) good.push({ title: 'Cooldowns on time', detail: 'Every tracked cooldown used as often as the fights allowed.' });
  if (under.length) work.push({ title: 'Use cooldowns more', detail: `${under.slice(0, 3).map(([n, c]) => `${n} ${c.uses}/${c.possible}`).join(', ')}. Use them at the pull and again as soon as they’re ready.` });

  // Avoidable damage against the rest of the raid (non-tanks)
  if (me.role !== 'tank') {
    const worse = rows.filter(({ fight, p }) => {
      const m = median(fight.players.filter((x) => x.role !== 'tank' && x.name !== p.name).map((x) => x.avoidable));
      return p.avoidable > 0 && p.avoidable > Math.max(m * 1.5, m + 5000);
    });
    const totalAvoid = rows.reduce((t, r) => t + r.p.avoidable, 0);
    const top = topAvoidable(rows)[0];
    if (worse.length) work.push({ title: 'Avoidable damage', detail: `More than most of the raid on ${worse.slice(0, 3).map((r) => r.fight.name).join(', ')}${top ? `. Most of it from ${top[0]} (${compact(top[1])})` : ''}.` });
    else if (rows.some((r) => r.fight.players.some((x) => x.avoidable > 0))) {
      good.push(totalAvoid === 0 ? { title: 'Out of the bad', detail: 'You took no avoidable damage.' } : { title: 'Out of the bad', detail: 'Avoidable damage in line with or below the rest of the raid.' });
    }
  }

  // Gear
  if (h.gearRow) {
    const missing = missingEnchants(h.gearRow.p);
    if (!missing.length) good.push({ title: 'Fully enchanted', detail: 'Every slot that takes an enchant has one.' });
    else work.push({ title: 'Missing enchants', detail: `No enchant on: ${missing.join(', ')}. Cheap, permanent damage and survival.` });
  }

  return { good: good.slice(0, 6), work: work.slice(0, 6) };
}

// ---------- My overview ----------

function overviewFields(rows: Rows): Field[] {
  const h = headline(rows);
  const bossLines = rows.map(({ fight, p }) => {
    const r = rank(fight, p);
    const bits = [`${n0(p.dps)} DPS`, p.parse !== null ? `parse ${Math.round(p.parse)}` : '', r.place ? `#${r.place} of ${r.of} in the raid` : '', p.activePct !== null ? `active ${p.activePct}%` : '', p.deaths.length ? `died ${p.deaths.length}×` : ''];
    return `• **${fight.name}** (${mmss(fight.seconds)}): ${bits.filter(Boolean).join(' · ')}`;
  });
  const specLines = rows.flatMap(({ fight, p }) => {
    const peers = peersOf(fight, p);
    if (!peers.length) return [];
    const bestPeer = Math.max(...peers.map((x) => x.dps));
    const place = [...peers.map((x) => x.dps), p.dps].sort((a, b) => b - a).indexOf(p.dps) + 1;
    const gap = p.dps >= bestPeer ? 'the top of your spec' : `${Math.round((1 - p.dps / bestPeer) * 100)}% behind the best`;
    return [`• **${fight.name}**: #${place} of ${peers.length + 1}, ${gap}`];
  });
  const ranks = rows.map(({ fight, p }) => rank(fight, p).place).filter((v) => v > 0);
  return [
    stat('Average parse', h.parseAvg !== null ? String(Math.round(h.parseAvg)) : '–'),
    stat('Best boss', h.best ? `${h.best.fight.name} (${Math.round(h.best.p.parse!)})` : '–'),
    stat('Average DPS', n0(h.dps)),
    stat('Best raid placing', ranks.length ? `#${Math.min(...ranks)}` : '–'),
    stat('Active time', h.activeAvg !== null ? `${h.activeAvg.toFixed(1)}%` : '–'),
    stat('Deaths', String(h.deaths)),
    stat('Item level', h.ilvl ? String(h.ilvl) : '–'),
    stat('Damage on kills', compact(h.total)),
    ...block('Boss by boss', bossLines.join('\n')),
    ...block(`Against other ${spaced(rows[0].p.specName)} ${spaced(rows[0].p.className)}s in the raid`, specLines.join('\n')),
  ];
}

// ---------- Damage breakdown ----------

function abilityShares(players: PlayerDigest[]) {
  const totals = new Map<string, number>();
  let all = 0;
  for (const p of players) {
    all += p.total;
    for (const a of p.abilities) totals.set(a.name, (totals.get(a.name) ?? 0) + a.total);
  }
  return { totals, all: all || 1 };
}

function damageFields(rows: Rows): Field[] {
  const h = headline(rows);
  const mine = abilityShares(rows.map((r) => r.p));
  const peers = rows.flatMap(({ fight, p }) => peersOf(fight, p));
  const theirs = abilityShares(peers);
  const top = [...mine.totals].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const bestDps = [...rows].sort((a, b) => b.p.dps - a.p.dps)[0];
  const share = (t: number, all: number) => `${((t / all) * 100).toFixed(1)}%`;

  const abilityLines = top.map(([name, t]) => `• **${name}**: ${share(t, mine.all)} · ${compact(t)}`);
  const compareLines = peers.length
    ? top.slice(0, 6).map(([name, t]) => `• **${name}**: ${share(t, mine.all)} for you, ${share(theirs.totals.get(name) ?? 0, theirs.all)} for them`)
    : [];
  const bossLines = rows.map(({ fight, p }) => {
    const r = rank(fight, p);
    return `• **${fight.name}**: ${n0(p.dps)} DPS · ${compact(p.total)} damage${r.place ? ` · #${r.place} of ${r.of}` : ''}`;
  });

  const points: Point[] = [];
  for (const [name, t] of top.slice(0, 6)) {
    const mineShare = t / mine.all;
    const theirShare = (theirs.totals.get(name) ?? 0) / theirs.all;
    if (peers.length && theirShare - mineShare >= 0.05) points.push({ title: name, detail: `${share(t, mine.all)} of your damage against ${`${(theirShare * 100).toFixed(1)}%`} for others of your spec; it may be worth casting more often.` });
  }
  const missingBig = peers.length ? [...theirs.totals].filter(([n, t]) => t / theirs.all >= 0.08 && !mine.totals.has(n)).map(([n]) => n) : [];
  if (missingBig.length) points.push({ title: 'Missing from your damage', detail: `${missingBig.slice(0, 3).join(', ')} make up a good share of others’ damage but none of yours.` });

  return [
    stat('Damage on kills', compact(h.total)),
    stat('Average DPS', n0(h.dps)),
    stat('Best DPS', bestDps ? `${n0(bestDps.p.dps)} (${bestDps.fight.name})` : '–'),
    ...block('Top abilities (share of your damage)', abilityLines.join('\n') || 'Warcraft Logs didn’t break this down by ability; open the full analysis for the details.'),
    ...block(`Compared with other ${spaced(rows[0].p.specName)} ${spaced(rows[0].p.className)}s in the raid`, compareLines.join('\n')),
    ...block('Where the gap could be', bullets(points)),
    ...block('Boss by boss', bossLines.join('\n')),
  ];
}

// ---------- Rotation & cooldowns ----------

function castsPerMinute(rows: { fight: FightDigest; p: PlayerDigest }[]) {
  const minutes = rows.reduce((t, r) => t + r.fight.seconds / 60, 0) || 1;
  const casts = new Map<string, number>();
  for (const { p } of rows) for (const c of p.casts) casts.set(c.name, (casts.get(c.name) ?? 0) + c.count);
  return { perMinute: new Map([...casts].map(([n, c]) => [n, c / minutes])), total: [...casts.values()].reduce((t, v) => t + v, 0) / minutes };
}

function rotationFields(rows: Rows): Field[] {
  const h = headline(rows);
  const cds = sumCooldowns(rows);
  const mine = castsPerMinute(rows);
  const peerRows = rows.flatMap(({ fight, p }) => peersOf(fight, p).map((x) => ({ fight, p: x })));
  const peerCount = new Set(peerRows.map((r) => r.p.name)).size;
  // Average across each of their fights, so three other hunters don't triple the numbers
  const peerCpm = new Map<string, number>();
  for (const { fight, p } of peerRows) for (const c of p.casts) peerCpm.set(c.name, (peerCpm.get(c.name) ?? 0) + c.count / (fight.seconds / 60 || 1) / peerRows.length);
  const usedTotal = [...cds.values()].reduce((t, c) => t + c.uses, 0);
  const possibleTotal = [...cds.values()].reduce((t, c) => t + c.possible, 0);

  const cdLines = [...cds].map(([name, c]) => `• **${name}**: ${c.uses} of ${c.possible}${c.uses < c.possible ? ` · room for ${c.possible - c.uses} more` : ' · every chance used'}`);
  const castLines = [...mine.perMinute].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, v]) => {
    const other = peerCpm.get(name);
    return `• **${name}**: ${v.toFixed(1)} a minute${other !== undefined ? ` (others: ${other.toFixed(1)})` : ''}`;
  });

  const good: Point[] = [];
  const work: Point[] = [];
  if (h.activeAvg !== null && h.activeAvg >= 95) good.push({ title: 'Always busy', detail: `${h.activeAvg.toFixed(1)}% active on average.` });
  else if (h.activeAvg !== null && h.activeAvg < 90) work.push({ title: 'Time spent not casting', detail: `${h.activeAvg.toFixed(1)}% active on average; aim for 95% or more. Gaps usually come from movement or waiting on cooldowns.` });
  const under = [...cds].filter(([, c]) => c.uses < c.possible);
  if (cds.size && !under.length) good.push({ title: 'Cooldowns on time', detail: 'Every tracked cooldown used as often as possible.' });
  for (const [name, c] of under.slice(0, 3)) work.push({ title: name, detail: `Used ${c.uses} of ${c.possible} possible times. Press it at the pull and again as soon as it’s ready.` });
  for (const [name, v] of [...mine.perMinute].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    const other = peerCpm.get(name);
    if (other !== undefined && other >= 1 && v < other * 0.8) work.push({ title: `Fewer ${name} casts`, detail: `${v.toFixed(1)} a minute against ${other.toFixed(1)} for others of your spec.` });
  }

  return [
    stat('Active time', h.activeAvg !== null ? `${h.activeAvg.toFixed(1)}%` : '–'),
    stat('Casts a minute', mine.total ? mine.total.toFixed(1) : '–'),
    stat('Cooldowns used', possibleTotal ? `${usedTotal} of ${possibleTotal}` : '–'),
    ...block('Cooldowns (all kills)', cdLines.join('\n')),
    ...block(`Most cast${peerCount ? ` (others = ${plural(peerCount, 'other player')} of your spec)` : ''}`, castLines.join('\n') || 'No cast data for this raid; open the full analysis for the details.'),
    ...block('What went well', bullets(good)),
    ...block('What to work on', bullets(work)),
  ];
}

// ---------- Gear & stats ----------

function gearIntro(rows: Rows): string {
  const h = headline(rows);
  if (!h.gearRow) return 'No gear was recorded in this log (the logger needs to see you at the pull).';
  return `As worn on ${h.gearRow.fight.name}.`;
}

function gearFields(rows: Rows): Field[] {
  const h = headline(rows);
  if (!h.gearRow) return [];
  const g = h.gearRow.p.gear!;
  const levels = g.map((x) => x.itemLevel).filter((v): v is number => !!v);
  const gearMean = avg(levels);
  // Warcraft Logs' own item level first, so it matches the raid average next to it
  const mean = h.gearRow.p.itemLevel ?? gearMean;
  const raidLevels = h.gearRow.fight.players.map((x) => x.itemLevel).filter((v): v is number => !!v);
  const raidMean = avg(raidLevels);
  const missing = missingEnchants(h.gearRow.p);
  const enchantable = g.filter((x) => x.enchantable).length;
  const gems = g.reduce((t, x) => t + x.gems.length, 0);

  const good: Point[] = [];
  const work: Point[] = [];
  if (!missing.length) good.push({ title: 'Fully enchanted', detail: `All ${enchantable} enchantable slots have an enchant.` });
  else work.push({ title: 'Missing enchants', detail: `No enchant on: ${missing.join(', ')}. Cheap, permanent damage and survival.` });
  if (mean !== null && raidMean !== null) {
    if (mean >= raidMean + 2) good.push({ title: 'Ahead of the raid', detail: `Item level ${mean.toFixed(1)} against a raid average of ${raidMean.toFixed(1)}.` });
    else if (mean <= raidMean - 3) work.push({ title: 'Behind the raid on item level', detail: `${mean.toFixed(1)} against a raid average of ${raidMean.toFixed(1)}; your lowest slots are the quickest upgrades.` });
  }
  if (gearMean !== null) {
    const low = g.filter((x) => x.itemLevel && x.itemLevel <= gearMean - 10).sort((a, b) => a.itemLevel! - b.itemLevel!).slice(0, 4);
    if (low.length) work.push({ title: 'Upgrade targets', detail: low.map((x) => `${x.slotName.toLowerCase()} (${x.itemLevel})`).join(', ') + '.' });
  }

  const stats = (h.gearRow.p.stats ?? []).map((s) => `${s.name} **${s.value}**`);
  const gearLines = g.map((x) => `**${x.slotName}**: ${x.name ?? `Item ${x.id}`} (${x.itemLevel ?? '–'})${x.enchant ? ` · ${x.enchant}` : x.enchantable && !x.enchantId ? ' · **no enchant**' : ''}${x.gems.length ? ` · ${plural(x.gems.length, 'gem')}` : ''}`);

  return [
    stat('Item level', mean !== null ? mean.toFixed(1) : '–'),
    stat('Raid average', raidMean !== null ? raidMean.toFixed(1) : '–'),
    stat('Enchants', missing.length ? `${enchantable - missing.length} of ${enchantable}` : 'All done'),
    stat('Gems', String(gems)),
    ...block('What went well', bullets(good)),
    ...block('What to work on', bullets(work)),
    ...block('Stats at the pull', stats.join(' · ')),
    ...chunked('Gear', gearLines),
  ];
}

// ---------- Survival ----------

function topAvoidable(rows: Rows) {
  const top = new Map<string, number>();
  for (const { p } of rows) for (const a of p.avoidableTop) top.set(a.name, (top.get(a.name) ?? 0) + a.total);
  return [...top].sort((a, b) => b[1] - a[1]);
}

function survivalFields(rows: Rows): Field[] {
  const me = rows[0].p;
  const taken = rows.reduce((t, r) => t + r.p.taken, 0);
  const avoid = rows.reduce((t, r) => t + r.p.avoidable, 0);
  const raidMedian = rows.reduce((t, { fight, p }) => t + median(fight.players.filter((x) => x.role !== 'tank' && x.name !== p.name).map((x) => x.avoidable)), 0);
  const deaths = rows.flatMap((r) => r.p.deaths.map((d) => `• **${r.fight.name}** at ${mmss(d.seconds)}: ${d.by}`));
  const top = topAvoidable(rows);
  const bossLines = rows.map(({ fight, p }) => {
    const m = median(fight.players.filter((x) => x.role !== 'tank' && x.name !== p.name).map((x) => x.avoidable));
    return `• **${fight.name}**: ${compact(p.taken)} taken · ${compact(p.avoidable)} likely avoidable${me.role !== 'tank' ? ` (raid typical: ${compact(m)})` : ''}`;
  });

  const good: Point[] = [];
  const work: Point[] = [];
  if (!deaths.length) good.push({ title: 'No deaths', detail: `You survived all ${bosses(rows.length)}.` });
  else {
    const causes = new Map<string, number>();
    for (const r of rows) for (const d of r.p.deaths) causes.set(d.by, (causes.get(d.by) ?? 0) + 1);
    const [cause, n] = [...causes].sort((a, b) => b[1] - a[1])[0];
    work.push({ title: `Died ${deaths.length}×`, detail: n > 1 ? `${n} of them to ${cause}; that mechanic is worth a look.` : `Killed by ${[...causes.keys()].join(', ')}.` });
  }
  if (me.role !== 'tank') {
    if (avoid === 0) good.push({ title: 'Out of the bad', detail: 'You took no avoidable damage.' });
    else if (avoid <= raidMedian) good.push({ title: 'Out of the bad', detail: `${compact(avoid)} likely avoidable, at or below what most of the raid took (${compact(raidMedian)}).` });
    else if (avoid > Math.max(raidMedian * 1.5, raidMedian + 5000)) {
      work.push({ title: 'More avoidable damage than most', detail: `${compact(avoid)} against a typical ${compact(raidMedian)}${top[0] ? `; most of it from ${top[0][0]}` : ''}. Moving out sooner saves the healers too.` });
    }
  } else good.push({ title: 'Tanking', detail: 'Tanks take hits others avoid, so avoidable damage isn’t judged for you.' });

  return [
    stat('Damage taken', compact(taken)),
    stat('Likely avoidable', `${compact(avoid)}${taken ? ` (${Math.round((avoid / taken) * 100)}%)` : ''}`),
    stat('Deaths', String(deaths.length)),
    ...block('What went well', bullets(good)),
    ...block('What to work on', bullets(work)),
    ...block('Deaths', deaths.join('\n')),
    ...block('Likely avoidable damage', top.slice(0, 6).map(([n, t]) => `• **${n}**: ${compact(t)}`).join('\n')),
    ...block('Boss by boss', bossLines.join('\n')),
  ];
}
