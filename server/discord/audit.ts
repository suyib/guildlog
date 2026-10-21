// A running log of what the bot is asked to do, posted to a private channel (DISCORD_LOG_CHANNEL_ID)
// so problems can be traced: who, what, where, when, and whether it worked. What people typed
// (reminder text, character names, search terms) is never logged, only which options they used.
import { PAGES } from './pages.js';
import { env, postToChannel } from './api.js';
import type { Interaction } from './commands.js';

export type AuditStatus = 'ok' | 'failed';

interface Opt { name: string; type: number; value?: unknown; options?: Opt[] }

/** "/info lookup (options: query)" or "Button: Quick summary (fresh/AbC123)", with no typed values. */
export function describe(i: Interaction): string {
  if (i.type === 2) {
    let path = `/${i.data?.name ?? '?'}`;
    let opts = (i.data?.options ?? []) as Opt[];
    // Subcommands (type 1) and groups (type 2) are part of the command's name
    while (opts.length === 1 && (opts[0].type === 1 || opts[0].type === 2)) {
      path += ` ${opts[0].name}`;
      opts = opts[0].options ?? [];
    }
    return opts.length ? `${path} (options: ${opts.map((o) => o.name).join(', ')})` : path;
  }
  if (i.type === 3) {
    const id = i.data?.custom_id ?? '';
    const [kind, action, ...rest] = id.split(':');
    if (kind === 'raid') {
      const page = PAGES.find((p) => p.id === action)?.label ?? action;
      return `Button: ${page}${rest.length ? ` (${logRef(rest.join(':'))})` : ''}`;
    }
    if (id === 'raids:pick') return `Picked a raid from /raids${i.data?.values?.[0] ? ` (${logRef(i.data.values[0])})` : ''}`;
    if (kind === 'claim') return `Claim ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action}`;
    return `Button: ${kind || 'unknown'}`;
  }
  return `Interaction type ${i.type}`;
}

/** "fresh.warcraftlogs.com:AbC123" -> "fresh/AbC123" (report codes are already public in the raid channel). */
function logRef(raid: string): string {
  const [host, code] = raid.includes(':') ? raid.split(':') : ['', raid];
  return host ? `${host.split('.')[0]}/${code}` : code;
}

const who = (i: Interaction) => {
  const u = i.member?.user ?? i.user;
  return u ? `<@${u.id}> (${u.username})` : 'someone';
};
const where = (i: Interaction) => (i.guild_id ? (i.channel_id ? `in <#${i.channel_id}>` : 'in the server') : 'in DMs');
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The log line for one interaction (exported for the tests). */
export function auditLine(i: Interaction, status: AuditStatus, ms: number, error?: string): string {
  const when = `<t:${Math.floor(Date.now() / 1000)}:f>`;
  const result = status === 'ok' ? `ok, ${(ms / 1000).toFixed(1)}s` : `**FAILED** after ${(ms / 1000).toFixed(1)}s: ${clip(error ?? 'unknown error', 300)}`;
  return clip(`${when} · ${who(i)} · ${describe(i)} · ${where(i)} · ${result}`, 1900);
}

async function post(content: string) {
  const channel = env.logChannel();
  if (!channel) return; // logging is off until the channel is set
  try {
    // No pings: mentions show the name but nobody is notified
    await postToChannel(channel, { content, allowed_mentions: { parse: [] } });
  } catch (e) {
    console.error('audit log failed', e);
  }
}

/** Log one interaction. Autocomplete (typing in an option) is skipped; it fires on every key press. */
export async function audit(i: Interaction, status: AuditStatus, ms: number, error?: string) {
  if (i.type === 1 || i.type === 4) return;
  await post(auditLine(i, status, ms, error));
}

/** Log a background job (reminders, command registration) when it did something or went wrong. */
export async function auditTask(text: string, failed = false) {
  await post(clip(`<t:${Math.floor(Date.now() / 1000)}:f> · ${failed ? '**FAILED** ' : ''}${text}`, 1900));
}
