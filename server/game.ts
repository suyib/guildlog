// GAME CONTENT: which game version the site is set up for. Only logs from these Warcraft Logs
// sites can be analyzed, which keeps the database to one version. When it changes, update the
// other files marked GAME CONTENT and run supabase/cleanup.sql (see the README).

export const GAME = {
  name: 'WoW Forever',
  /** Warcraft Logs sites whose reports are accepted. */
  hosts: ['forever.warcraftlogs.com'],
};
