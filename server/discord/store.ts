// Database tables used by the Discord bot (see supabase/schema.sql).
import { rest } from '../db.js';

const q = encodeURIComponent;

// ---------- Claims ----------

export interface Claim {
  id: string;
  created_at: string;
  discord_id: string;
  discord_name: string;
  character: string;
  realm: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();

export async function claimsFor(discordId: string): Promise<Claim[]> {
  return (await rest(`bot_claims?discord_id=eq.${q(discordId)}&status=neq.rejected&order=created_at.asc`)) ?? [];
}

export async function approvedClaimsFor(discordId: string): Promise<Claim[]> {
  return (await rest(`bot_claims?discord_id=eq.${q(discordId)}&status=eq.approved&order=created_at.asc`)) ?? [];
}

/** Anyone else's live claim on this character (pending or approved). */
export async function claimOnCharacter(character: string, realm: string | null): Promise<Claim | null> {
  const rows: Claim[] = (await rest(`bot_claims?character_key=eq.${q(norm(character))}&status=neq.rejected`)) ?? [];
  return rows.find((r) => !realm || !r.realm || norm(r.realm) === norm(realm)) ?? null;
}

export async function createClaim(c: { discord_id: string; discord_name: string; character: string; realm: string | null }): Promise<Claim> {
  const rows = await rest('bot_claims?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...c, character_key: norm(c.character), status: 'pending' }),
  });
  return rows[0];
}

export async function getClaim(id: string): Promise<Claim | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await rest(`bot_claims?id=eq.${id}`))?.[0] ?? null;
}

export async function decideClaim(id: string, status: 'approved' | 'rejected', by: string) {
  await rest(`bot_claims?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status, decided_by: by, decided_at: new Date().toISOString() }) });
}

export async function removeClaim(discordId: string, character: string) {
  await rest(`bot_claims?discord_id=eq.${q(discordId)}&character_key=eq.${q(norm(character))}`, { method: 'DELETE' });
}

// ---------- Raids ----------

export interface Raid {
  id: string;
  host: string;
  report_code: string;
  title: string | null;
  started_by: string;
  logger_id: string | null;
  started_at: string;
  ended_at: string | null;
}

/**
 * Starts (or restarts) a raid. A log that was used before is reopened: its start time is reset and
 * any earlier end is cleared, so /raidend finds it again.
 */
export async function createRaid(r: { host: string; report_code: string; title: string | null; started_by: string; logger_id: string | null }): Promise<Raid> {
  const rows = await rest('bot_raids?on_conflict=report_code&select=*', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ ...r, started_at: new Date().toISOString(), ended_at: null }),
  });
  return rows[0];
}

export async function latestRaidStartedBy(userId: string): Promise<Raid | null> {
  return (await rest(`bot_raids?started_by=eq.${q(userId)}&ended_at=is.null&order=started_at.desc&limit=1`))?.[0] ?? null;
}

/** The most recent raid that's been started but not ended, by anyone. */
export async function latestOpenRaid(): Promise<Raid | null> {
  return (await rest(`bot_raids?ended_at=is.null&order=started_at.desc&limit=1`))?.[0] ?? null;
}

export async function raidByCode(code: string): Promise<Raid | null> {
  return (await rest(`bot_raids?report_code=eq.${q(code)}&limit=1`))?.[0] ?? null;
}

export async function endRaid(code: string) {
  await rest(`bot_raids?report_code=eq.${q(code)}`, { method: 'PATCH', body: JSON.stringify({ ended_at: new Date().toISOString() }) });
}

export async function recentRaids(limit = 5): Promise<Raid[]> {
  return (await rest(`bot_raids?order=started_at.desc&limit=${limit}`)) ?? [];
}

/** Has this character been seen in any saved raid or analysis? Shown to officers when approving claims. */
export async function lastSeen(character: string): Promise<string | null> {
  const a = (await rest(`analyses?player_name=ilike.${q(character)}&select=created_at,encounter_name&order=created_at.desc&limit=1`).catch(() => null))?.[0];
  if (a) return `${a.created_at.slice(0, 10)} (${a.encounter_name})`;
  return null;
}

// ---------- Reminders ----------

export interface Reminder {
  id: string;
  channel_id: string;
  created_by: string;
  send_at: string;
  payload: unknown;
  sent: boolean;
}

export async function createReminder(r: { channel_id: string; created_by: string; send_at: string; payload: unknown }) {
  await rest('bot_reminders', { method: 'POST', body: JSON.stringify(r) });
}

export async function dueReminders(): Promise<Reminder[]> {
  return (await rest(`bot_reminders?sent=eq.false&send_at=lte.${q(new Date().toISOString())}&order=send_at.asc&limit=20`)) ?? [];
}

export async function markReminderSent(id: string) {
  await rest(`bot_reminders?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ sent: true }) });
}
