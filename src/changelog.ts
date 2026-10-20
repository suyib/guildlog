// Release notes shown on the Changelog page (newest first). Add an entry with every version bump.

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.10.1',
    date: '2026-10-20',
    changes: [
      'Bot: /remind posts the announcement in the channel it was used in, and can create a Discord event.',
      'Bot: /raids suggests the latest raids from /raidstart as you type, or takes a pasted link.',
      'Bot: new "Quick summary" button with what went well and what to work on.',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-10-21',
    changes: [
      'Discord bot: /raidstart, /raidend, /raids, /check, /claim, /unclaim, /remind and /info.',
      'Raid summaries in the raid channel, with buttons that DM each person their own overview, rotation, damage, gear and survival.',
      'Character claims approved by officers.',
      'Links from the bot open the site with the log already loaded.',
      'Privacy Policy updated for the bot.',
      'The bot runs as one function to stay within the free Vercel plan.',
    ],
  },
  {
    version: '0.9.2',
    date: '2026-10-20',
    changes: ['Terms of Service and Privacy Policy pages, linked in the menu and on the password page. Both open without the password.'],
  },
  {
    version: '0.9.1',
    date: '2026-10-20',
    changes: ['Changelog page, linked next to the version number in the menu.'],
  },
  {
    version: '0.9.0',
    date: '2026-10-20',
    changes: [
      'Player and Compare lists only show people who were in the chosen fight (no more "Unknown" entries).',
      'Compare with anyone in the same fight, or load a second log and pick someone from it.',
      'Comparisons check spec as well as class (Balance vs Feral counts as different).',
      'DPS over the fight is built from damage events, so it matches Warcraft Logs.',
      'Buffs & survival: damage taken summary, likely avoidable damage and raid median.',
      'Stat tooltips leave out level-70 numbers on non-Fresh logs.',
    ],
  },
  {
    version: '0.8.1',
    date: '2026-10-19',
    changes: ['Content centered next to the menu.', 'Pie chart added to Damage breakdown.'],
  },
  {
    version: '0.8.0',
    date: '2026-10-19',
    changes: [
      'Sidebar menu with sections per fight: Overview, Rotation & cooldowns, Damage breakdown, Gear & stats, Buffs & survival, Side by side.',
      'Overview with stat cards and differences against your comparison.',
      'Gear, stats and the DPS chart load for every analysis.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-19',
    changes: [
      '"What worked well" next to "What to work on".',
      'No comparison is the default.',
      'Stats at the pull: full width, with tooltips on what each stat does for your class.',
      'Guild logo in the menu and browser tab.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-19',
    changes: ['New look based on the Guild Logs design: Geist and Iosevka Charon Mono fonts, all styling in theme.css.'],
  },
  {
    version: '0.5.0',
    date: '2026-10-19',
    changes: ['"Just my stats" dashboard: DPS over the fight, damage by ability pie chart, gear with enchants, stats.'],
  },
  {
    version: '0.4.1',
    date: '2026-10-19',
    changes: ['Time limits on Warcraft Logs requests, with a clear message when one is slow.', 'Progress steps stay visible when something fails.'],
  },
  {
    version: '0.4.0',
    date: '2026-10-19',
    changes: ['Faster analysis with caching.', 'Character portraits.', 'Step timings while analyzing.', 'Version number in the header.'],
  },
  {
    version: '0.1.0',
    date: '2026-10-19',
    changes: [
      'First release: paste a Warcraft Logs link, pick a fight and player, get a summary of what to work on.',
      'Whole site behind one guild password; analyses saved to Supabase.',
      'Compare with players in the raid, with a warning for other classes.',
      'Share links for each analysis, which also show the form so others can change the comparison.',
      'Game icons for classes and abilities, Warcraft Logs-style dark theme.',
    ],
  },
];
