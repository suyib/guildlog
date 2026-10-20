// What the bot posts: the raid summary in the channel, and each person's own summaries by DM.
import { BRAND, type Embed, type MessageBody, button, env, linkButton, row } from './api.js';
import { type FightDigest, type PlayerDigest, type RaidDigest, playerFights } from './digest.js';

export type Page = 'overview' | 'damage' | 'rotation' | 'gear' | 'survival';

export const PAGES: { id: Page; label: string }[] = [
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
  return [row(...PAGES.map((p) => button(p.label, `raid:${p.id}:${raid}`, p.id === 'overview' ? 1 : 2)))];
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
  const pendingNote = digest.pending ? `\n\n_${digest.pending} boss${digest.pending > 1 ? 'es are' : ' is'} still being read; press the button again in a minute to include ${digest.pending > 1 ? 'them' : 'it'}._` : '';

  let embed: Embed;
  switch (page) {
    case 'overview':
      embed = { ...base, title: `Your raid: ${head}`, description: overview(rows) + pendingNote };
      break;
    case 'damage':
      embed = { ...base, title: `Damage breakdown: ${head}`, description: damage(rows) + pendingNote };
      break;
    case 'rotation':
      embed = { ...base, title: `Rotation & cooldowns: ${head}`, description: rotation(rows) + pendingNote };
      break;
    case 'gear':
      embed = { ...base, title: `Gear & stats: ${head}`, description: gear(rows) };
      break;
    case 'survival':
      embed = { ...base, title: `Survival: ${head}`, description: survival(rows) + pendingNote };
      break;
  }
  embed.description = clip(embed.description ?? '', 4000);
  return { embeds: [embed], components: [links] };
}

type Rows = { fight: FightDigest; p: PlayerDigest }[];

function overview(rows: Rows): string {
  const parses = rows.map((r) => r.p.parse).filter((v): v is number => v !== null);
  const avg = parses.length ? Math.round(parses.reduce((t, v) => t + v, 0) / parses.length) : null;
  const bestRow = [...rows].sort((a, b) => (b.p.parse ?? -1) - (a.p.parse ?? -1))[0];
  const deaths = rows.reduce((t, r) => t + r.p.deaths.length, 0);
  const lines = rows.map(({ fight, p }) =>
    `**${fight.name}**: ${n0(p.dps)} DPS${p.parse !== null ? ` · parse ${Math.round(p.parse)}` : ''}${p.activePct !== null ? ` · active ${p.activePct}%` : ''}${p.deaths.length ? ` · died ${p.deaths.length}×` : ''}`,
  );
  return [
    `Bosses: **${rows.length}**${avg !== null ? ` · average parse **${avg}**` : ''}${bestRow?.p.parse !== null && bestRow ? ` · best: ${bestRow.fight.name} (${Math.round(bestRow.p.parse!)})` : ''} · deaths: **${deaths}**`,
    '',
    ...lines,
  ].join('\n');
}

function damage(rows: Rows): string {
  const totals = new Map<string, number>();
  for (const { p } of rows) for (const a of p.abilities) totals.set(a.name, (totals.get(a.name) ?? 0) + a.total);
  const all = rows.reduce((t, r) => t + r.p.total, 0);
  const secs = rows.reduce((t, r) => t + r.fight.seconds, 0);
  if (!totals.size) return `Total damage on kills: **${compact(all)}** (${n0(all / (secs || 1))} DPS).\n\nWarcraft Logs didn't break this down by ability; open the full analysis for the details.`;
  const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return [
    `Total damage on kills: **${compact(all)}** · average **${n0(all / (secs || 1))} DPS**`,
    '',
    ...top.map(([name, t]) => `${name}: **${((t / (all || 1)) * 100).toFixed(1)}%** (${compact(t)})`),
  ].join('\n');
}

function rotation(rows: Rows): string {
  const minutes = rows.reduce((t, r) => t + r.fight.seconds / 60, 0) || 1;
  const casts = new Map<string, number>();
  const cds = new Map<string, { uses: number; possible: number }>();
  for (const { p } of rows) {
    for (const c of p.casts) casts.set(c.name, (casts.get(c.name) ?? 0) + c.count);
    for (const c of p.cooldowns) {
      const x = cds.get(c.name) ?? { uses: 0, possible: 0 };
      cds.set(c.name, { uses: x.uses + c.uses, possible: x.possible + c.possible });
    }
  }
  const active = rows.map((r) => r.p.activePct).filter((v): v is number => v !== null);
  const out: string[] = [];
  if (active.length) out.push(`Average active time: **${(active.reduce((t, v) => t + v, 0) / active.length).toFixed(1)}%**`);
  if (cds.size) {
    out.push('', '**Cooldowns** (used / possible, all kills)');
    for (const [name, c] of cds) out.push(`${name}: **${c.uses} / ${c.possible}**${c.uses < c.possible ? ' · room for more' : ''}`);
  }
  if (casts.size) {
    out.push('', '**Casts per minute**');
    for (const [name, c] of [...casts].sort((a, b) => b[1] - a[1]).slice(0, 8)) out.push(`${name}: **${(c / minutes).toFixed(1)}**`);
  }
  return out.join('\n') || 'No cast data for this raid; open the full analysis for the details.';
}

function gear(rows: Rows): string {
  const withGear = [...rows].reverse().find((r) => r.p.gear?.length);
  if (!withGear) return 'No gear was recorded in this log (the logger needs to see you at the pull).';
  const g = withGear.p.gear!;
  const levels = g.map((x) => x.itemLevel).filter((v): v is number => !!v);
  const avg = levels.length ? (levels.reduce((t, v) => t + v, 0) / levels.length).toFixed(1) : '–';
  const missing = g.filter((x) => x.enchantable && !x.enchant && !x.enchantId).map((x) => x.slotName.toLowerCase());
  const stats = withGear.p.stats?.slice(0, 10).map((s) => `${s.name} ${s.value}`).join(' · ');
  return [
    `Average item level **${avg}**${missing.length ? ` · no enchant on: ${missing.join(', ')}` : ' · fully enchanted'}`,
    stats ? `\n${stats}` : '',
    '',
    ...g.map((x) => `${x.slotName}: ${x.name ?? `Item ${x.id}`} (${x.itemLevel ?? '–'})${x.enchant ? ` · ${x.enchant}` : x.enchantable && !x.enchantId ? ' · **no enchant**' : ''}`),
  ].join('\n');
}

function survival(rows: Rows): string {
  const taken = rows.reduce((t, r) => t + r.p.taken, 0);
  const avoid = rows.reduce((t, r) => t + r.p.avoidable, 0);
  const deaths = rows.flatMap((r) => r.p.deaths.map((d) => `${r.fight.name} at ${mmss(d.seconds)} to ${d.by}`));
  const top = new Map<string, number>();
  for (const { p } of rows) for (const a of p.avoidableTop) top.set(a.name, (top.get(a.name) ?? 0) + a.total);
  return [
    `Damage taken on kills: **${compact(taken)}** · likely avoidable: **${compact(avoid)}**${taken ? ` (${Math.round((avoid / taken) * 100)}%)` : ''}`,
    '',
    deaths.length ? `**Deaths**\n${deaths.join('\n')}` : '**No deaths.**',
    top.size ? `\n**Likely avoidable damage**\n${[...top].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, t]) => `${n}: ${compact(t)}`).join('\n')}` : '',
    '\n_"Likely avoidable" means it hit fewer than half of the non-tanks. Check the boss mechanics before treating it as a mistake._',
  ].join('\n');
}
