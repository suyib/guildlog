// Discord REST helpers and request verification for the interactions endpoint.
import { createPublicKey, verify } from 'node:crypto';

const API = 'https://discord.com/api/v10';

export const env = {
  appId: () => must('DISCORD_APP_ID'),
  token: () => must('DISCORD_BOT_TOKEN'),
  guildId: () => process.env.DISCORD_GUILD_ID?.trim() ?? '',
  raidChannel: () => process.env.DISCORD_RAID_CHANNEL_ID?.trim() ?? '',
  adminChannel: () => process.env.DISCORD_ADMIN_CHANNEL_ID?.trim() ?? '',
  adminRole: () => process.env.DISCORD_ADMIN_ROLE_ID?.trim() ?? '',
  site: () => (process.env.SITE_URL?.trim() || 'https://guildlog.uk').replace(/\/$/, ''),
  timezone: () => process.env.TIMEZONE?.trim() || 'Europe/London',
};

function must(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Server is missing ${name}`);
  return v;
}

// ---------- Verifying that a request really came from Discord ----------

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // Ed25519 public key wrapper

export function verifyDiscordRequest(body: string, signature: string | null, timestamp: string | null): boolean {
  const pub = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!pub || !signature || !timestamp) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pub, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ---------- REST ----------

export async function discord<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bot ${env.token()}`, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      // Rate limited: wait as long as Discord asks, then try again
      const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 1);
      await new Promise((r) => setTimeout(r, Math.min(5, wait) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
  throw new Error('Discord kept rate-limiting the request');
}

export interface MessageBody {
  content?: string;
  embeds?: Embed[];
  components?: unknown[];
  flags?: number;
  allowed_mentions?: { parse?: string[]; users?: string[]; roles?: string[] };
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export const EPHEMERAL = 64;
export const BRAND = 0x007cad;

export const postToChannel = (channelId: string, body: MessageBody) => discord(`/channels/${channelId}/messages`, { method: 'POST', body });

/** Send a direct message. Returns false when the person has DMs from server members turned off. */
export async function sendDm(userId: string, body: MessageBody): Promise<boolean> {
  try {
    const ch = await discord<{ id: string }>('/users/@me/channels', { method: 'POST', body: { recipient_id: userId } });
    await postToChannel(ch.id, body);
    return true;
  } catch {
    return false;
  }
}

/** Replace the "thinking…" reply of a deferred interaction. */
export const editReply = (token: string, body: MessageBody) =>
  discord(`/webhooks/${env.appId()}/${token}/messages/@original`, { method: 'PATCH', body });

export async function memberRoles(userId: string): Promise<string[] | null> {
  const guild = env.guildId();
  if (!guild) return null;
  try {
    const m = await discord<{ roles: string[] }>(`/guilds/${guild}/members/${userId}`);
    return m.roles;
  } catch {
    return null; // not in the server
  }
}

// ---------- Message building blocks ----------

export const button = (label: string, customId: string, style: 1 | 2 | 3 | 4 = 2, disabled = false) => ({ type: 2, style, label, custom_id: customId, disabled });
export const linkButton = (label: string, url: string) => ({ type: 2, style: 5, label, url });
export const row = (...components: unknown[]) => ({ type: 1, components });
