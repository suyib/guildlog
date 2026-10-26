// Guild details set on the Admin page. Each one overrides what Discord says (name and picture);
// left empty, the site uses Discord's. One row in site_settings.
import { dbEnabled, rest } from './db.js';
import { discord, env } from './discord/api.js';
import { level } from './ranks.js';
import type { AdminEdit, GuildSettings, Rank } from './types.js';

const EMPTY: GuildSettings = { name: null, icon: null, about: null };
/** Pictures are shrunk to 128px in the browser; this is a backstop. */
const MAX_ICON = 150_000;
const ICON = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** The Discord server's name, picture and member counts. */
export async function discordGuild(): Promise<{ name: string; icon: string | null; members: number | null; online: number | null } | null> {
  const id = env.guildId();
  if (!id) return null;
  const g = await discord<{ id: string; name: string; icon: string | null; approximate_member_count?: number; approximate_presence_count?: number }>(`/guilds/${id}?with_counts=true`).catch(() => null);
  if (!g) return null;
  return {
    name: g.name,
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
    members: g.approximate_member_count ?? null,
    online: g.approximate_presence_count ?? null,
  };
}

export async function guildSettings(): Promise<GuildSettings> {
  if (!dbEnabled()) return EMPTY;
  const rows: { value: Partial<GuildSettings> }[] = (await rest('site_settings?key=eq.guild&select=value').catch(() => [])) ?? [];
  return { ...EMPTY, ...rows[0]?.value };
}

/** Save the guild details (guild masters and admins). Returns a line for the activity log. */
export async function applyGuildEdit(edit: Extract<AdminEdit, { action: 'guild' }>, actor: { name: string; rank: Rank }): Promise<string> {
  if (level(actor.rank) < level('guild_master')) throw new Error('Only guild masters and admins can change the guild details.');
  const clean = (v: string | null | undefined, max: number) => (v?.trim() ? v.trim().slice(0, max) : null);
  const icon = edit.icon?.trim() || null;
  if (icon && (icon.length > MAX_ICON || !ICON.test(icon))) throw new Error('That picture can’t be used. Try a PNG, JPEG or WebP image.');
  const value: GuildSettings = { name: clean(edit.name, 60), icon, about: clean(edit.about, 600) };
  await rest('site_settings?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'guild', value, updated_at: new Date().toISOString(), updated_by: actor.name }),
  });
  const changed = [value.name ? `name “${value.name}”` : 'Discord’s name', value.icon ? 'a custom picture' : 'Discord’s picture'];
  return `updated the guild details (${changed.join(', ')}${value.about ? ', about text' : ''})`;
}
