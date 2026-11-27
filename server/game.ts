// GAME CONTENT: which game version the site is set up for. Only logs from these Warcraft Logs
// sites can be analyzed, which keeps the database to one version. When it changes, update the
// other files marked GAME CONTENT and run supabase/cleanup.sql (see the README).

export const GAME = {
  name: 'WoW Forever',
  /**
   * Warcraft Logs sites whose reports are accepted. The first is the main one (guild ranks and
   * picking up the guild's reports). fresh.warcraftlogs.com is only here for testing: remove it,
   * then run supabase/cleanup.sql to clear its raids out.
   */
  hosts: ['forever.warcraftlogs.com', 'fresh.warcraftlogs.com'],
  /** How many players each raid takes, by name, for the raid cards. */
  raidSizes: { 'Barrow Deeps': 10, 'Hyjal Summit': 20, "Onyxia's Lair": 40 } as Record<string, number>,
};

/** A raid's size by name (ignoring case and curly apostrophes), when known. GAME CONTENT */
export function raidSize(name: string): number | null {
  const key = (s: string) => s.toLowerCase().replace(/’/g, "'").trim();
  const hit = Object.entries(GAME.raidSizes).find(([n]) => key(n) === key(name));
  return hit ? hit[1] : null;
}
