// Small readers for Warcraft Logs' table and rankings shapes, shared by everything that derives
// numbers from a stored fight.

export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Everyone in the rankings (tanks, healers, damage), each with name, class, spec, rankPercent. */
export function rankingRows(rankings: any): any[] {
  const roles = rankings?.data?.[0]?.roles ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => roles[r]?.characters ?? []);
}

/** Everyone in the player details (id, name, server, specs, item level, combatant info). */
export function detailRows(details: any): any[] {
  const d = details?.data?.playerDetails ?? details?.playerDetails ?? {};
  return ['tanks', 'healers', 'dps'].flatMap((r) => d[r] ?? []);
}

/** The player details grouped by role: tanks, healers, dps. */
export function detailRoles(details: any): Record<'tanks' | 'healers' | 'dps', any[]> {
  const d = details?.data?.playerDetails ?? details?.playerDetails ?? {};
  return { tanks: d.tanks ?? [], healers: d.healers ?? [], dps: d.dps ?? [] };
}

/** Who did something to which ability, from a nested Interrupts or Dispels table: name -> count. */
export function countsFrom(table: any): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (entries: any[]) => {
    for (const e of entries ?? []) {
      for (const d of (e?.details ?? []) as any[]) if (d?.name) out[d.name] = (out[d.name] ?? 0) + num(d.total);
      if (Array.isArray(e?.entries)) walk(e.entries);
    }
  };
  walk(table?.data?.entries ?? []);
  return out;
}
