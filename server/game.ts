// GAME CONTENT: which game version the site is set up for. Only logs from these Warcraft Logs
// sites can be analyzed, which keeps the database to one version.
// When WoW Forever launches, change this (and the other files marked GAME CONTENT; see the README).

export const GAME = {
  name: 'Burning Crusade',
  /** Warcraft Logs sites whose reports are accepted. */
  // classic.warcraftlogs.com (Mists of Pandaria) is allowed for testing only. Before raiding starts,
  // remove it here, remove the TESTING ONLY parts of server/cooldowns.ts and src/statInfo.ts, and run
  // supabase/cleanup.sql.
  hosts: ['fresh.warcraftlogs.com', 'classic.warcraftlogs.com'],
};
