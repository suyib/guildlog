// Personal goals: a raider picks a parse to reach on one boss (or any boss) for one of their own
// characters. When a saved raid reaches it, they get a DM. Kept in player_goals (see
// supabase/migrate-0.41.sql); only the owner sees their goals.
import { claimsFor } from './discord/store.js';
import { BRAND, env, sendDm } from './discord/api.js';
import { dbEnabled, rest } from './db.js';
import type { PlayerGoal } from './types.js';

const q = encodeURIComponent;
const MAX_OPEN = 5;

interface GoalRow {
  id: string;
  discord_id: string;
  character: string;
  encounter_id: number | null;
  encounter_name: string | null;
  target: number;
  created_at: string;
  achieved_at: string | null;
  achieved_parse: number | null;
  achieved_code: string | null;
}

const toGoal = (r: GoalRow): PlayerGoal => ({
  id: r.id, character: r.character, encounterId: r.encounter_id, encounter: r.encounter_name, target: r.target,
  createdAt: r.created_at, achievedAt: r.achieved_at, achievedParse: r.achieved_parse === null ? null : Number(r.achieved_parse),
});

/** Someone's goals, open ones first (an empty list when the table doesn't exist yet). */
export async function goalsFor(discordId: string): Promise<PlayerGoal[]> {
  if (!dbEnabled()) return [];
  const rows: GoalRow[] = (await rest(`player_goals?discord_id=eq.${q(discordId)}&order=achieved_at.desc.nullsfirst,created_at.desc&limit=30`).catch(() => [])) ?? [];
  return rows.map(toGoal);
}

/** Add a goal for one of your own claimed characters. */
export async function addGoal(discordId: string, g: { character?: string; encounterId?: number | null; encounter?: string | null; target?: number }): Promise<PlayerGoal> {
  const character = String(g.character ?? '').trim();
  const target = Math.round(Number(g.target));
  if (!character) throw new Error('Pick a character.');
  if (!(target >= 1 && target <= 100)) throw new Error('Pick a parse between 1 and 100.');
  const mine = await claimsFor(discordId);
  const claim = mine.find((c) => c.character.toLowerCase() === character.toLowerCase());
  if (!claim) throw new Error('You can only set goals for your own characters.');
  const open = (await goalsFor(discordId)).filter((x) => !x.achievedAt);
  if (open.length >= MAX_OPEN) throw new Error(`You can have ${MAX_OPEN} goals going at once. Remove one first.`);
  const encounterId = g.encounterId && Number(g.encounterId) > 0 ? Math.trunc(Number(g.encounterId)) : null;
  const rows: GoalRow[] = await rest('player_goals', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ discord_id: discordId, character: claim.character, encounter_id: encounterId, encounter_name: encounterId ? String(g.encounter ?? '').slice(0, 80) || null : null, target }),
  });
  return toGoal(rows[0]);
}

export async function removeGoal(discordId: string, id: string): Promise<void> {
  await rest(`player_goals?id=eq.${q(id)}&discord_id=eq.${q(discordId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

/**
 * After a raid is saved: any open goal it reached is marked done and its owner gets a DM. Uses the
 * raid's rows in kill_stats (healers by their healing parse).
 */
export async function checkGoals(code: string): Promise<number> {
  const site = env.site();
  if (!dbEnabled()) return 0;
  const goals: GoalRow[] = (await rest('player_goals?achieved_at=is.null&limit=500').catch(() => [])) ?? [];
  if (!goals.length) return 0;
  const kills: { name_key: string; encounter_id: number; encounter_name: string; parse: number | null; hps_parse: number | null; healer: boolean; fight_id: number }[] =
    (await rest(`kill_stats?report_code=eq.${q(code)}&select=name_key,encounter_id,encounter_name,parse,hps_parse,healer,fight_id`).catch(() => [])) ?? [];
  let reached = 0;
  for (const g of goals) {
    const mine = kills
      .filter((k) => k.name_key === g.character.toLowerCase() && (!g.encounter_id || k.encounter_id === g.encounter_id))
      .map((k) => ({ ...k, v: Number(k.healer ? k.hps_parse : k.parse) }))
      .filter((k) => Number.isFinite(k.v) && k.v >= g.target)
      .sort((a, b) => b.v - a.v);
    const hit = mine[0];
    if (!hit) continue;
    await rest(`player_goals?id=eq.${q(g.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ achieved_at: new Date().toISOString(), achieved_parse: Math.round(hit.v), achieved_code: code }),
    }).catch(() => undefined);
    reached++;
    await sendDm(g.discord_id, {
      embeds: [{
        title: 'Goal reached!',
        description: `**${g.character}** parsed **${Math.round(hit.v)}** on ${hit.encounter_name}, past your goal of ${g.target}${g.encounter_name ? ` on ${g.encounter_name}` : ''}. Nice work.\n\nSet your next one on [your profile](${site}/#/me).`,
        color: BRAND,
      }],
    });
  }
  return reached;
}
