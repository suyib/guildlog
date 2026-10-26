// Slash commands and button handlers for the Guild Logs bot.
// Rule of thumb: anything about one person's character is sent by DM (or shown only to them);
// only raid-wide information is posted in channels.
import { characterLevel } from '../blizzard.js';
import { registerRaid } from '../archive.js';
import { level, siteAdminIds, storedPerson } from '../ranks.js';
import { rest } from '../db.js';
import { getReportMeta, parseReportUrl } from '../wcl.js';
import { reportRegion, storedDigests } from '../pack.js';
import { guildContext, trendFor } from '../benchmarks.js';
import {
  BRAND, bugButton, EPHEMERAL, type Embed, type MessageBody, button, discord, editReply, env, linkButton, memberRoles, postToChannel, row, sendDm,
} from './api.js';
import { type RaidDigest, healsMost, playerFights, raidDigest } from './digest.js';
import { RAID_CHECKLIST, ROLE_CHOICES, type Role, consumablesMessage, lookupMessage } from './info.js';
import { PAGES, type Page, pageButtons, personalPage, raidSummary, siteLink } from './pages.js';
import {
  type Claim, approvedClaimsFor, claimOnCharacter, claimsFor, createClaim, createRaid, createReminder, decideClaim, endRaid, getClaim, lastSeen,
  latestOpenRaid, latestRaidStartedBy, raidByCode, recentRaids, removeClaim,
} from './store.js';
import { parseWhen } from './time.js';

// ---------- Command definitions (sent to Discord by GET /api/discord?task=register) ----------

const STRING = 3, INTEGER = 4, BOOLEAN = 5, USER = 6, ROLE = 8, SUB = 1;
// Usable in the server and in DMs with the bot
const contexts = { contexts: [0, 1], integration_types: [0] };

export const COMMANDS = [
  {
    name: 'remind', description: 'Officers: schedule a raid reminder', ...contexts,
    options: [
      { type: STRING, name: 'message', description: 'What to say, e.g. "Gruul’s Lair tonight"', required: true, max_length: 300 },
      { type: STRING, name: 'time', description: 'Gather time, e.g. 19:45 or 7:45pm (guild time)', required: true },
      { type: STRING, name: 'day', description: 'today, tomorrow, friday, 24/10 or 2026-10-24 (default: next time it’s that time)' },
      { type: STRING, name: 'place', description: 'Where to gather, e.g. "Outside Gruul’s Lair"', max_length: 100 },
      { type: BOOLEAN, name: 'consumes', description: 'Add a "bring your consumables" checklist' },
      { type: INTEGER, name: 'minutes_before', description: 'Post the reminder this many minutes before (default 15)', min_value: 0, max_value: 1440 },
      { type: ROLE, name: 'ping', description: 'Role to mention' },
      { type: BOOLEAN, name: 'event', description: 'Also create a Discord event people can mark "Interested"' },
    ],
  },
  {
    name: 'raidstart', description: 'Officers: post the live log for tonight’s raid', ...contexts,
    options: [
      { type: STRING, name: 'link', description: 'Warcraft Logs live log link', required: true },
      { type: USER, name: 'logger', description: 'Who is logging (default: you)' },
      { type: STRING, name: 'note', description: 'Anything to add', max_length: 200 },
    ],
  },
  {
    name: 'raidend', description: 'End the raid you started with /raidstart and post its summary', ...contexts,
  },
  {
    name: 'raids', description: 'Your summaries for one of the last 5 raids, or any Warcraft Logs link', ...contexts,
    options: [{ type: STRING, name: 'raid', description: 'Pick a recent raid, or paste a Warcraft Logs link', autocomplete: true }],
  },
  {
    name: 'check', description: 'Your character: class, spec, item level, stats and last raid (sent by DM)', ...contexts,
    options: [{ type: STRING, name: 'character', description: 'Which of your claimed characters (default: all)' }],
  },
  {
    name: 'claim', description: 'Claim your character so the bot can send you your summaries', ...contexts,
    options: [
      { type: STRING, name: 'character', description: 'Character name', required: true, max_length: 24 },
      { type: STRING, name: 'realm', description: 'Realm (helps if the name is common)', max_length: 40 },
    ],
  },
  {
    name: 'unclaim', description: 'Remove one of your claimed characters', ...contexts,
    options: [{ type: STRING, name: 'character', description: 'Character name', required: true }],
  },
  {
    name: 'info', description: 'Raid consumables and quick lookups', ...contexts,
    options: [
      { type: SUB, name: 'consumables', description: 'Flasks, elixirs, food, potions and weapon buffs by role',
        options: [{ type: STRING, name: 'role', description: 'Your role', required: true, choices: ROLE_CHOICES }] },
      { type: SUB, name: 'lookup', description: 'Search Wowhead for an item, spell or anything else',
        options: [{ type: STRING, name: 'search', description: 'What to look up', required: true, max_length: 100 }] },
    ],
  },
  { name: 'help', description: 'What the bot can do and how to use each command', ...contexts },
];

// ---------- Interaction plumbing ----------

export interface Interaction {
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: DUser; roles: string[]; permissions?: string };
  user?: DUser;
  data?: {
    name?: string;
    custom_id?: string;
    options?: (Opt & { focused?: boolean })[];
    values?: string[];
    /** A submitted form: rows of text inputs */
    components?: { components?: { custom_id: string; value?: string }[] }[];
  };
  message?: { id: string; embeds?: Embed[] };
}
interface DUser { id: string; username: string; global_name?: string | null }
interface Opt { name: string; type: number; value?: string | number | boolean; options?: Opt[] }

/**
 * What the endpoint should do: reply now, and optionally keep working afterwards. `after` resolves
 * to an error message when the background work failed (for the activity log).
 */
export interface Outcome { response: unknown; after?: () => Promise<string | void> }

const reply = (body: MessageBody, ephemeral = true): Outcome => ({ response: { type: 4, data: { ...body, flags: ephemeral ? EPHEMERAL : undefined } } });
/** "Thinking…" now (only visible to the user), then replace it once the work is done. */
const deferred = (i: Interaction, work: () => Promise<MessageBody>, ephemeral = true): Outcome => ({
  response: { type: 5, data: { flags: ephemeral ? EPHEMERAL : undefined } },
  after: async () => {
    let body: MessageBody;
    let failed: string | undefined;
    try {
      body = await work();
    } catch (e) {
      failed = (e as Error).message;
      body = { content: `Something went wrong: ${failed}` };
    }
    await editReply(i.token, body);
    return failed;
  },
});

const userOf = (i: Interaction) => (i.member?.user ?? i.user)!;
const nameOf = (u: DUser) => u.global_name || u.username;
const opt = (opts: Opt[] | undefined, name: string) => opts?.find((o) => o.name === name)?.value;

async function isOfficer(i: Interaction): Promise<boolean> {
  // Ranks from the site come first: SITE_ADMIN_IDS, then a rank set on the Admin page
  const uid = userOf(i).id;
  if (siteAdminIds().includes(uid)) return true;
  const stored = await storedPerson(uid).catch(() => null);
  if (stored?.rank) return level(stored.rank) >= level('officer');
  const role = env.adminRole();
  if (i.member) {
    const perms = BigInt(i.member.permissions ?? '0');
    if ((perms & 8n) === 8n || (perms & 32n) === 32n) return true; // Administrator or Manage Server
    return !!role && i.member.roles.includes(role);
  }
  // Used in a DM: look the person up in the server
  const roles = await memberRoles(userOf(i).id);
  return !!role && !!roles?.includes(role);
}

const notOfficer = () => reply({ content: 'Only officers can use this.' });

export async function handle(i: Interaction): Promise<Outcome> {
  if (i.type === 2) {
    switch (i.data?.name) {
      case 'remind': return remind(i);
      case 'raidstart': return raidStart(i);
      case 'raidend': return raidEnd(i);
      case 'raids': return raids(i);
      case 'check': return check(i);
      case 'claim': return claim(i);
      case 'unclaim': return unclaim(i);
      case 'info': return info(i);
      case 'help': return reply(helpMessage());
    }
  }
  if (i.type === 4 && i.data?.name === 'raids') return raidChoices(i);
  if (i.type === 3) {
    const id = i.data?.custom_id ?? '';
    if (id.startsWith('raid:')) return raidButton(i, id);
    if (id === 'raids:pick') return raidPicked(i);
    if (id.startsWith('claim:')) return claimDecision(i, id);
    if (id === 'bug:open' || id.startsWith('bug:open:')) return bugForm(id.slice('bug:open:'.length));
  }
  if (i.type === 5 && i.data?.custom_id?.startsWith('bug:submit')) return bugSubmit(i);
  return reply({ content: 'That command isn’t available.' });
}

// ---------- /remind ----------

async function remind(i: Interaction): Promise<Outcome> {
  if (!(await isOfficer(i))) return notOfficer();
  const o = i.data?.options;
  const message = String(opt(o, 'message'));
  const when = parseWhen(String(opt(o, 'time')), opt(o, 'day') as string | undefined, env.timezone());
  if (!when) return reply({ content: 'I couldn’t read that time. Try 19:45 or 7:45pm, and a day like tomorrow, friday or 24/10.' });
  const lead = Number(opt(o, 'minutes_before') ?? 15);
  const sendAt = new Date(when.getTime() - lead * 60_000);
  if (sendAt.getTime() < Date.now() - 60_000) return reply({ content: 'That reminder would be in the past. Pick a later time or a smaller "minutes_before".' });
  const channelId = i.guild_id ? i.channel_id! : env.raidChannel();
  if (!channelId) return reply({ content: 'Use /remind in the channel the reminder should go to.' });
  const payload = {
    message,
    place: (opt(o, 'place') as string | undefined) ?? null,
    consumes: !!opt(o, 'consumes'),
    gatherAt: when.toISOString(),
    roleId: (opt(o, 'ping') as string | undefined) ?? null,
    by: userOf(i).id,
  };
  const wantEvent = !!opt(o, 'event');
  const inServer = !!i.guild_id;
  // In the server the announcement replaces the command's reply in that channel; from a DM it goes to the raid channel
  return deferred(i, async () => {
    await createReminder({ channel_id: channelId, created_by: userOf(i).id, send_at: sendAt.toISOString(), payload });
    let eventUrl: string | null = null;
    let eventNote = '';
    if (wantEvent) {
      const guild = i.guild_id ?? env.guildId();
      try {
        const ev = await discord<{ id: string }>(`/guilds/${guild}/scheduled-events`, {
          method: 'POST',
          body: {
            name: message.slice(0, 100),
            description: payload.consumes ? `Bring: ${RAID_CHECKLIST.join(', ')}.` : undefined,
            privacy_level: 2,
            entity_type: 3,
            entity_metadata: { location: (payload.place ?? 'In game').slice(0, 100) },
            scheduled_start_time: when.toISOString(),
            scheduled_end_time: new Date(when.getTime() + 3 * 3600_000).toISOString(),
          },
        });
        eventUrl = `https://discord.com/events/${guild}/${ev.id}`;
      } catch {
        eventNote = '\n_(Couldn’t create the Discord event. Give the bot the "Create Events" permission and try again.)_';
      }
    }
    const announcement = announcementMessage(payload, sendAt, eventUrl);
    if (inServer) return { ...announcement, content: `${announcement.content ?? ''}${eventNote}`.trim() || undefined };
    await postToChannel(channelId, announcement);
    return { content: `Posted in <#${channelId}>. I'll remind everyone <t:${Math.floor(sendAt.getTime() / 1000)}:R>.${eventNote}` };
  }, !inServer);
}

/** Posted straight away when a reminder is set: what, when, where, and when the reminder will go out. */
function announcementMessage(p: { message: string; place: string | null; consumes: boolean; gatherAt: string; roleId: string | null }, sendAt: Date, eventUrl: string | null): MessageBody {
  const unix = Math.floor(new Date(p.gatherAt).getTime() / 1000);
  const fields = [
    { name: 'Gather', value: `<t:${unix}:F> (<t:${unix}:R>)${p.place ? `\n${p.place}` : ''}` },
    { name: 'Reminder', value: `I'll post a reminder <t:${Math.floor(sendAt.getTime() / 1000)}:R>.` },
  ];
  if (p.consumes) fields.push({ name: 'Bring', value: RAID_CHECKLIST.map((x) => `• ${x}`).join('\n') + '\nNeed a list? Use `/info consumables`.' });
  return {
    content: p.roleId ? `<@&${p.roleId}>` : undefined,
    embeds: [{ title: 'Raid scheduled', description: p.message, color: BRAND, fields }],
    components: eventUrl ? [row(linkButton('Open the Discord event', eventUrl))] : [],
    allowed_mentions: { roles: p.roleId ? [p.roleId] : [] },
  };
}

/** The message posted when a reminder is due (used by GET /api/discord?task=reminders). */
export function reminderMessage(p: { message: string; place: string | null; consumes: boolean; gatherAt: string; roleId: string | null }): MessageBody {
  const unix = Math.floor(new Date(p.gatherAt).getTime() / 1000);
  const fields = [{ name: 'Gather', value: `<t:${unix}:t> (<t:${unix}:R>)${p.place ? `\n${p.place}` : ''}` }];
  if (p.consumes) fields.push({ name: 'Bring', value: RAID_CHECKLIST.map((x) => `• ${x}`).join('\n') + '\nNeed a list? Use `/info consumables`.' });
  return {
    content: p.roleId ? `<@&${p.roleId}>` : undefined,
    embeds: [{ title: 'Raid reminder', description: p.message, color: BRAND, fields }],
    allowed_mentions: { roles: p.roleId ? [p.roleId] : [] },
  };
}

// ---------- /raidstart and /raidend ----------

async function raidStart(i: Interaction): Promise<Outcome> {
  if (!(await isOfficer(i))) return notOfficer();
  const o = i.data?.options;
  let parsed: ReturnType<typeof parseReportUrl>;
  try {
    parsed = parseReportUrl(String(opt(o, 'link')));
  } catch (e) {
    return reply({ content: (e as Error).message });
  }
  // Where it was typed: a thread or a channel (a thread's ID is its channel ID). From a DM, the raid channel.
  const channelId = (i.guild_id ? i.channel_id : '') || env.raidChannel();
  if (!channelId) return reply({ content: 'Use /raidstart in the server, in the thread or channel the raid should be posted in.' });
  const logger = (opt(o, 'logger') as string | undefined) ?? userOf(i).id;
  const note = opt(o, 'note') as string | undefined;
  return deferred(i, async () => {
    const title = await getReportMeta(parsed.host, parsed.code, 10_000).then((m) => m.title).catch(() => null);
    await createRaid({ host: parsed.host, report_code: parsed.code, title, started_by: userOf(i).id, logger_id: logger });
    const url = `https://${parsed.host}/reports/${parsed.code}`;
    await postToChannel(channelId, {
      content: `Raid starting. Live log by <@${logger}>.`,
      embeds: [{ title: title ? `Live log: ${title}` : 'Live log', url, color: BRAND, description: note ?? 'Follow along on Warcraft Logs as the bosses come in.' }],
      components: [row(linkButton('Open the live log', url))],
      allowed_mentions: { users: [logger] },
    });
    return { content: `Posted in <#${channelId}>. When you're done, use /raidend to post the summary.` };
  });
}

/**
 * Ends the raid this person started with /raidstart: the log comes from that raid, so no link is
 * needed. Only the person who started it can end it.
 */
async function raidEnd(i: Interaction): Promise<Outcome> {
  const me = userOf(i).id;
  return deferred(i, async () => {
    const raid = await latestRaidStartedBy(me);
    if (!raid) {
      const open = await latestOpenRaid();
      return open
        ? { content: `Only <@${open.started_by}>, who started ${open.title ?? 'the current raid'}, can end it.` }
        : { content: 'There\u2019s no raid in progress. Start one with `/raidstart` first.' };
    }
    // Where it was typed: a thread or a channel. From a DM, the raid channel.
    const channelId = (i.guild_id ? i.channel_id! : '') || env.raidChannel();
    if (!channelId) return { content: 'Use /raidend in the server, in the thread or channel the summary should be posted in.' };
    const digest = await raidDigest(raid.host, raid.report_code, 40_000, { fresh: true });
    await postToChannel(channelId, raidSummary(digest, raid.logger_id));
    await endRaid(raid.report_code);
    // Add it to Past raids on the site, which saves it in full over the next hour or so
    const logger = raid.logger_id ? await discord<DUser>(`/users/${raid.logger_id}`).catch(() => null) : null;
    await registerRaid({ host: raid.host, code: raid.report_code, source: 'discord', loggerName: logger ? nameOf(logger) : null, addedBy: me }).catch((e) => console.error('couldn\u2019t add to past raids', e));
    await startReading(raid.report_code);
    return { content: `Summary for ${raid.title ?? 'the raid'} posted in <#${channelId}>.` };
  });
}

/**
 * Start reading a raid for Past raids straight away, in a call of its own (so it gets a full time
 * limit), instead of waiting for the 5-minute job. Quietly does nothing if CRON_SECRET isn't set.
 */
async function startReading(code: string) {
  const secret = process.env.CRON_SECRET?.trim().replace(/^['"]|['"]$/g, '');
  if (!secret) return;
  await fetch(`${env.site()}/api/discord?task=raid&code=${encodeURIComponent(code)}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
}

// ---------- /raids and the page buttons ----------

/** Picked from the list (host:code) or pasted as a Warcraft Logs link. */
function readRaidValue(value: string): { host: string; code: string } {
  const picked = value.match(/^([a-z0-9.-]+\.warcraftlogs\.com):([A-Za-z0-9]+)$/i);
  if (picked) return { host: picked[1], code: picked[2] };
  return parseReportUrl(value);
}

async function raids(i: Interaction): Promise<Outcome> {
  const value = (opt(i.data?.options, 'raid') ?? opt(i.data?.options, 'link')) as string | undefined;
  if (value) {
    let parsed: { host: string; code: string };
    try {
      parsed = readRaidValue(value);
    } catch (e) {
      return reply({ content: (e as Error).message });
    }
    return deferred(i, async () => {
      const r = await raidByCode(parsed.code).catch(() => null);
      return { content: `**${r?.title ?? 'This raid'}**: pick what you’d like to receive by DM.`, components: pageButtons(`${parsed.host}:${parsed.code}`) };
    });
  }
  return deferred(i, async () => {
    const list = await recentRaids(5);
    if (!list.length) return { content: 'No raids saved yet. Paste a Warcraft Logs link: `/raids raid:`' };
    return {
      content: 'Pick a raid (latest first), then choose what you’d like by DM:',
      components: [
        row({
          type: 3,
          custom_id: 'raids:pick',
          placeholder: 'Choose a raid',
          options: list.map((r) => ({
            label: (r.title ?? r.report_code).slice(0, 100),
            description: new Date(r.started_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
            value: `${r.host}:${r.report_code}`,
          })),
        }),
      ],
    };
  });
}

/** Suggestions as you type in /raids: the latest raids posted with /raidstart, newest first. */
async function raidChoices(i: Interaction): Promise<Outcome> {
  const typed = String(i.data?.options?.find((o) => o.focused)?.value ?? '').trim();
  const choices: { name: string; value: string }[] = [];
  if (/warcraftlogs\.com\/reports\//i.test(typed)) choices.push({ name: 'Use this Warcraft Logs link', value: typed.slice(0, 100) });
  const list = await recentRaids(25).catch(() => []);
  for (const r of list) {
    const date = new Date(r.started_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const name = `${r.title ?? r.report_code} · ${date}`;
    if (typed && !/^https?:/i.test(typed) && !name.toLowerCase().includes(typed.toLowerCase())) continue;
    choices.push({ name: name.slice(0, 100), value: `${r.host}:${r.report_code}` });
  }
  return { response: { type: 8, data: { choices: choices.slice(0, 25) } } };
}

function raidPicked(i: Interaction): Outcome {
  const value = i.data?.values?.[0] ?? '';
  return { response: { type: 7, data: { content: 'Pick what you’d like to receive by DM:', components: pageButtons(value) } } };
}

async function raidButton(i: Interaction, id: string): Promise<Outcome> {
  // raid:<page>:<host>:<code>  (older buttons: raid:<page>:<code>)
  const parts = id.split(':');
  const page = parts[1] as Page;
  const code = parts.at(-1)!;
  const hostPart = parts.length > 3 ? parts[2] : null;
  const user = userOf(i);
  return deferred(i, async () => {
    const claims = await approvedClaimsFor(user.id);
    if (!claims.length) return { content: 'Claim your character first with `/claim`, then try again.' };
    const host = hostPart ?? (await raidByCode(code))?.host;
    if (!host) return { content: 'I couldn’t find that raid any more.' };
    const digest = await raidDigest(host, code, 40_000);
    const label = PAGES.find((p) => p.id === page)?.label ?? 'summary';
    const sent: string[] = [];
    let dmFailed = false;
    for (const c of claims) {
      const body = personalPage(page, digest, c.character, c.realm, page === 'summary' ? await guildLines(digest, c.character, c.realm) : undefined);
      if (!body) continue;
      if (await sendDm(user.id, body)) sent.push(c.character);
      else {
        dmFailed = true;
        return { ...body, content: 'Your DMs are closed, so here it is (only you can see this):' };
      }
    }
    if (!sent.length && !dmFailed) {
      return { content: `None of your characters (${claims.map((c) => c.character).join(', ')}) were in ${digest.meta.title}.` };
    }
    return { content: `Sent your ${label.toLowerCase()} for ${sent.join(', ')} to your DMs.` };
  });
}

// ---------- /check ----------

async function check(i: Interaction): Promise<Outcome> {
  const wanted = (opt(i.data?.options, 'character') as string | undefined)?.toLowerCase();
  const user = userOf(i);
  return deferred(i, async () => {
    const claims = (await approvedClaimsFor(user.id)).filter((c) => !wanted || c.character.toLowerCase() === wanted);
    if (!claims.length) return { content: wanted ? `You haven’t claimed ${wanted} (or it’s waiting for an officer).` : 'Claim your character first with `/claim`.' };
    const embeds: Embed[] = [];
    for (const c of claims.slice(0, 5)) embeds.push(await characterCard(c));
    const ok = await sendDm(user.id, { embeds });
    return ok ? { content: 'Sent to your DMs.' } : { content: 'Your DMs are closed, so here it is (only you can see this):', embeds };
  });
}

/** "Against the guild" lines for the quick summary: where they placed among the guild's kills of each boss in their spec. */
async function guildLines(digest: RaidDigest, character: string, realm: string | null): Promise<string[]> {
  const lines: string[] = [];
  for (const { fight, p } of playerFights(digest, character, realm)) {
    const healer = healsMost(p);
    const g = await guildContext({ encounterId: fight.encounterID, encounter: fight.name, className: p.className, specName: p.specName, name: p.name, healer }).catch(() => null);
    if (!g || g.players < 2 || !g.place || !g.best) continue;
    const mine = healer ? p.healing?.hps ?? 0 : p.dps;
    const n = (v: number) => Math.round(v).toLocaleString('en-US');
    lines.push(`• **${fight.name}**: ${n(mine)} ${g.unit} · #${g.place} of ${g.players} ${g.spec}s in the guild (best ${n(g.best.perSecond)}${g.median ? `, typical ${n(g.median)}` : ''})`);
  }
  return lines;
}

/** "55 → 61 → 72" over the weeks with raids. */
async function trendLine(name: string): Promise<string | null> {
  const weeks = (await trendFor(name).catch(() => [])).filter((w) => w.parse !== null);
  if (weeks.length < 2) return null;
  const first = weeks[0].parse!;
  const last = weeks.at(-1)!.parse!;
  return `Parse by week: ${weeks.map((w) => w.parse).join(' → ')} (${last >= first ? 'up' : 'down'} ${Math.abs(last - first)} over ${weeks.length} raid weeks)`;
}

async function characterCard(c: Claim): Promise<Embed> {
  // Latest raid this character appears in
  for (const r of await recentRaids(10)) {
    const fights = await storedDigests(r.report_code).catch(() => []);
    const digest = { host: r.host, code: r.report_code, meta: { title: r.title ?? r.report_code, startTime: Date.parse(r.started_at) } as RaidDigest['meta'], fights, pending: 0 };
    const rows = playerFights(digest as RaidDigest, c.character, c.realm);
    if (!rows.length) continue;
    const last = rows.at(-1)!.p;
    const withGear = [...rows].reverse().find((x) => x.p.gear?.length)?.p;
    const levels = withGear?.gear?.map((g) => g.itemLevel).filter((v): v is number => !!v) ?? [];
    const parses = rows.map((x) => x.p.parse).filter((v): v is number => v !== null);
    const region = await reportRegion(r.host, r.report_code).catch(() => null);
    const level = region && (c.realm || last.server) ? await characterLevel(region, (c.realm || last.server)!, c.character).catch(() => null) : null;
    const fields = [
      { name: 'Class', value: `${last.specName.replace(/([a-z])([A-Z])/g, '$1 $2')} ${last.className}`.trim() || '–', inline: true },
      { name: 'Level', value: level ? String(level) : '–', inline: true },
      { name: 'Item level', value: last.itemLevel ? String(last.itemLevel) : levels.length ? (levels.reduce((t, v) => t + v, 0) / levels.length).toFixed(1) : '–', inline: true },
      { name: 'Last raid', value: `${r.title ?? r.report_code} (${new Date(r.started_at).toLocaleDateString('en-GB')})\n${rows.length} boss${rows.length > 1 ? 'es' : ''}${parses.length ? ` · average parse ${Math.round(parses.reduce((t, v) => t + v, 0) / parses.length)}` : ''}` },
    ];
    const trend = await trendLine(c.character);
    if (trend) fields.push({ name: 'Last 8 weeks', value: trend });
    if (withGear?.stats?.length) fields.push({ name: 'Stats at the pull', value: withGear.stats.slice(0, 12).map((s) => `${s.name} ${s.value}`).join(' · ').slice(0, 1024) });
    return { title: `${c.character}${c.realm ? ` · ${c.realm}` : ''}`, color: BRAND, fields, url: siteLink(r.host, r.report_code, rows.at(-1)!.fight.id, last.id) };
  }
  // Fall back to a saved analysis from the website
  const a = (await rest(`analyses?player_name=ilike.${encodeURIComponent(c.character)}&select=created_at,encounter_name,result&order=created_at.desc&limit=1`).catch(() => null))?.[0];
  if (a) {
    const p = a.result.player;
    return {
      title: c.character, color: BRAND,
      fields: [
        { name: 'Class', value: `${String(p.specName).replace(/([a-z])([A-Z])/g, '$1 $2')} ${p.className}`, inline: true },
        { name: 'Item level', value: p.itemLevel ? String(p.itemLevel) : '–', inline: true },
        { name: 'Last analysis', value: `${a.encounter_name} on ${a.created_at.slice(0, 10)}${p.parsePercent !== null ? ` · parse ${Math.round(p.parsePercent)}` : ''}` },
      ],
    };
  }
  return { title: c.character, color: BRAND, description: 'No raids or analyses with this character yet. Once a raid is summarized with /raidend, this fills in.' };
}

// ---------- /claim, /unclaim and officer approval ----------

async function claim(i: Interaction): Promise<Outcome> {
  const o = i.data?.options;
  const character = String(opt(o, 'character')).trim();
  const realm = ((opt(o, 'realm') as string | undefined) ?? '').trim() || null;
  const user = userOf(i);
  if (!/^[\p{L}]{2,24}$/u.test(character)) return reply({ content: 'That doesn’t look like a character name (letters only, 2 to 24 characters).' });
  return deferred(i, async () => {
    const adminChannel = env.adminChannel();
    if (!adminChannel) return { content: 'Claims aren’t set up yet (DISCORD_ADMIN_CHANNEL_ID in Vercel).' };
    const existing = await claimOnCharacter(character, realm);
    if (existing && existing.discord_id === user.id) return { content: `You've already ${existing.status === 'approved' ? 'claimed' : 'asked to claim'} ${character}.` };
    if (existing) return { content: `${character} is already claimed by someone else. If it's yours, ask an officer to sort it out.` };
    if ((await claimsFor(user.id)).length >= 6) return { content: 'You can claim up to 6 characters. Use /unclaim to remove one first.' };
    const make = () => createClaim({ discord_id: user.id, discord_name: nameOf(user), character, realm });
    let c: Claim;
    try {
      c = await make().catch(async (e) => {
        // Slow database: the claim may have been saved anyway, so look before trying again
        if ((e as Error).name !== 'TimeoutError') throw e;
        const saved = await claimOnCharacter(character, realm);
        if (saved && saved.discord_id === user.id) return saved;
        if (saved) throw new Error('409 already claimed');
        return make();
      });
    } catch (e) {
      // The database refuses a second live claim on the same character (two people asking at once)
      if (/409|duplicate|unique/i.test((e as Error).message)) return { content: `${character} is already claimed by someone else. If it's yours, ask an officer to sort it out.` };
      throw e;
    }
    const seen = await lastSeen(character).catch(() => null);
    const created = new Date(Number((BigInt(user.id) >> 22n) + 1420070400000n));
    await postToChannel(adminChannel, {
      embeds: [{
        title: `Claim request: ${character}${realm ? ` (${realm})` : ''}`,
        color: BRAND,
        fields: [
          { name: 'Discord user', value: `<@${user.id}> (${user.username})`, inline: true },
          { name: 'Discord account made', value: created.toLocaleDateString('en-GB'), inline: true },
          { name: 'Seen in our logs', value: seen ?? 'Not yet', inline: true },
        ],
        footer: { text: 'Approve only if you know this is their character.' },
      }],
      components: [row(button('Approve', `claim:approve:${c.id}`, 3), button('Reject', `claim:reject:${c.id}`, 4))],
      allowed_mentions: { users: [] },
    });
    return { content: `Thanks! An officer will confirm that ${character} is yours. You'll get a DM when it's approved.` };
  });
}

async function unclaim(i: Interaction): Promise<Outcome> {
  const character = String(opt(i.data?.options, 'character')).trim();
  const user = userOf(i);
  return deferred(i, async () => {
    await removeClaim(user.id, character);
    return { content: `Removed ${character} from your characters.` };
  });
}

async function claimDecision(i: Interaction, id: string): Promise<Outcome> {
  if (!(await isOfficer(i))) return reply({ content: 'Only officers can approve or reject claims.' });
  const [, decision, claimId] = id.split(':');
  const c = await getClaim(claimId);
  if (!c) return { response: { type: 7, data: { content: 'This claim no longer exists.', components: [] } } };
  const officer = userOf(i);
  if (decision === 'approve') {
    const other = await claimOnCharacter(c.character, c.realm);
    if (other && other.id !== c.id && other.status === 'approved') return reply({ content: `${c.character} is already claimed by <@${other.discord_id}>. Reject this one, or ask them to /unclaim.` });
  }
  const status = decision === 'approve' ? 'approved' : 'rejected';
  return {
    response: {
      type: 7,
      data: {
        embeds: (i.message?.embeds ?? []).map((e) => ({ ...e, footer: { text: `${status === 'approved' ? 'Approved' : 'Rejected'} by ${nameOf(officer)}` } })),
        components: [],
      },
    },
    after: async () => {
      await decideClaim(c.id, status, officer.id);
      await sendDm(c.discord_id, {
        content: status === 'approved'
          ? `Your claim on **${c.character}** was approved. After a raid, use the buttons on the summary (or \`/raids\`) to get your numbers by DM, and \`/check\` any time.`
          : `Your claim on **${c.character}** wasn't approved. If that's a mistake, message an officer.`,
      });
    },
  };
}

// ---------- /help ----------

/** Everything the bot does, grouped by who it's for. Only the person who asked sees it. */
export function helpMessage(): MessageBody {
  const line = (cmd: string, what: string) => `**${cmd}**: ${what}`;
  return {
    embeds: [{
      title: 'Guild Logs bot',
      color: BRAND,
      description: 'Your numbers only ever come to you by DM (or as a reply only you can see). Raid channels only get raid-wide summaries.',
      fields: [
        {
          name: 'Getting started',
          value: [
            line('/claim', 'claim your character (and realm, if the name is common). An officer approves it, then the bot can send you your numbers. Alts can be claimed too.'),
            line('/unclaim', 'remove one of your claimed characters.'),
          ].join('\n'),
        },
        {
          name: 'Your numbers',
          value: [
            line('/raids', 'pick one of the last 5 raids (or paste any Warcraft Logs link) to get your summaries by DM.'),
            line('/check', 'your character at a glance: class, spec, item level, stats and your last raid.'),
            'After each raid, the buttons under the summary in the raid channel send you: **Quick summary**, **My overview**, **Rotation & cooldowns**, **Damage breakdown**, **Gear & stats** and **Survival**.',
          ].join('\n'),
        },
        {
          name: 'Raid info',
          value: [
            line('/info consumables', 'flasks, elixirs, food, potions and weapon buffs for your role.'),
            line('/info lookup', 'search Wowhead for an item, spell or anything else.'),
          ].join('\n'),
        },
        {
          name: 'Officers',
          value: [
            line('/raidstart', 'post the live log for tonight\u2019s raid.'),
            line('/raidend', 'end the raid you started and post its summary, with what went well and what to work on.'),
            line('/remind', 'schedule a raid reminder (optional place, consumables checklist, role ping and Discord event).'),
          ].join('\n'),
        },
        { name: 'More detail', value: `The full analysis for any fight, with charts and comparisons, is at ${env.site()}.` },
        { name: 'Something not working?', value: 'Press **Report a bug** below (it\u2019s also under every raid summary).' },
      ],
    }],
    components: [row(bugButton())],
  };
}

// ---------- Bug reports ----------

const TEXT_INPUT = 4;

/** The pop-up form. `context` is "host:code" when opened from a raid summary. */
function bugForm(context: string): Outcome {
  const input = (custom_id: string, label: string, placeholder: string, required: boolean, max: number) =>
    row({ type: TEXT_INPUT, custom_id, label, style: 2, placeholder, required, max_length: max });
  return {
    response: {
      type: 9,
      data: {
        custom_id: `bug:submit${context ? `:${context}` : ''}`.slice(0, 100),
        title: 'Report a bug',
        components: [
          input('what', 'What went wrong?', 'e.g. the Damage breakdown button said something went wrong', true, 1000),
          input('doing', 'What were you doing? (optional)', 'Which command or button, which character, roughly when', false, 500),
        ],
      },
    },
  };
}

function bugSubmit(i: Interaction): Outcome {
  const fields = new Map((i.data?.components ?? []).flatMap((r) => r.components ?? []).map((c) => [c.custom_id, (c.value ?? '').trim()]));
  const context = (i.data?.custom_id ?? '').slice('bug:submit:'.length);
  const [host, code] = context.split(':');
  const u = userOf(i);
  const report: MessageBody = {
    embeds: [{
      title: 'Bug report',
      color: 0xd9534f,
      description: fields.get('what') || '(nothing written)',
      fields: [
        { name: 'From', value: `<@${u.id}> (${u.username})`, inline: true },
        { name: 'Where', value: i.guild_id ? (i.channel_id ? `<#${i.channel_id}>` : 'the server') : 'DMs', inline: true },
        ...(code ? [{ name: 'Raid', value: `[${code}](https://${host}/reports/${code})`, inline: true }] : []),
        ...(fields.get('doing') ? [{ name: 'What they were doing', value: fields.get('doing')!.slice(0, 1024) }] : []),
      ],
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: { parse: [] },
  };
  return deferred(i, async () => {
    const channel = env.bugChannel();
    const owner = env.ownerId();
    if (channel) await postToChannel(channel, report);
    else if (owner) {
      if (!(await sendDm(owner, report))) throw new Error('the report couldn\u2019t be delivered');
    } else throw new Error('bug reports aren\u2019t set up yet');
    return { content: 'Thanks, your report has been sent to suy.' };
  });
}

// ---------- /info ----------

function info(i: Interaction): Outcome {
  const sub = i.data?.options?.[0];
  if (sub?.name === 'consumables') return reply(consumablesMessage(String(opt(sub.options, 'role')) as Role));
  if (sub?.name === 'lookup') return reply(lookupMessage(String(opt(sub.options, 'search'))));
  return reply({ content: 'Try `/info consumables` or `/info lookup`.' });
}

