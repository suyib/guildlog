// Release notes shown on the Changelog page (newest first). Add an entry with every version bump.

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.15.0',
    date: '2026-10-21',
    changes: [
      'Past raids: a calendar of raid nights, with a card for each (bosses, kill times, wipes, deaths, what went well and what to work on) and who was there.',
      'Attendance over the last 4 weeks to all raids, and kill times per boss across the weeks.',
      'Raids ended with /raidend are added automatically; older logs can be added from the page (optionally, the guild\u2019s new uploads too).',
      'Each raid is saved in full in the background, so boss breakdowns, player analyses and the Discord bot keep working when Warcraft Logs is down.',
    ],
  },
  {
    version: '0.14.0',
    date: '2026-10-20',
    changes: [
      'Fight breakdown: plain-language “What went well” and “What to work on” for the whole raid, without naming anyone in what to work on. Enchants stay in your own DM summary.',
      'Discord: the /raidend summary includes the same raid-wide highlights, without naming anyone.',
      'Discord: every DM page now leads with headline numbers, then short \u201cWhat went well\u201d and \u201cWhat to work on\u201d points, with boss-by-boss detail and comparisons to others of your spec.',
      'Active time is averaged by fight length and leaves out kills under a minute and fights you died in, so short kills no longer flag most of the raid as idle. Tanks and healers aren\u2019t judged on it in the raid summary.',
      'Pet damage (hunter and warlock pets) is split out and labeled with the pet\u2019s name, e.g. \u201cMelee (pet: Kitty)\u201d, with its share of your total; DMs list pets the same way.',
      'Discord: optional activity log channel (who used which command or button, where, when, and whether it worked), without anything people typed.',
      'Discord: /help lists every command and what it does.',
      'Discord: the /raidend summary has an \u201cOpen on Guild Logs\u201d button that opens that log on the site.',
      'Discord: \u201cMade by suy\u201d in the raid summary footer, and a Report a bug button (raid summary and /help) with a short form.',
      'Discord: slow database answers are retried, and a claim that timed out is checked before trying again, so it isn\u2019t made twice.',
      'Warcraft Logs sign-in is shared between requests and retried when Warcraft Logs is briefly unavailable (the \u201cauth failed (503)\u201d error after the site has been idle). If one Warcraft Logs site\u2019s sign-in is down, the others are tried.',
      'Discord: a test link for the activity log that says why it can\u2019t post, if it can\u2019t.',
      'The scheduler key (CRON_SECRET) ignores stray spaces or quotes pasted into Vercel.',
    ],
  },
  {
    version: '0.13.2',
    date: '2026-10-20',
    changes: ['Fight breakdown: raid DPS over the fight is built from the raid\u2019s damage events, with Warcraft Logs\u2019 graph as a backup.'],
  },
  {
    version: '0.13.1',
    date: '2026-10-20',
    changes: [
      'Fight breakdown: everyone in the fight is included, including healers who did no damage, so healing totals and the tank, healer and damage counts are right.',
      'Fight breakdown: raid DPS over the fight chart, with Bloodlust marked.',
      'Pet and totem healing is added to its owner.',
    ],
  },
  {
    version: '0.13.0',
    date: '2026-10-20',
    changes: [
      'Whole-raid fight breakdown, the default when no player is chosen: raid DPS and HPS, damage and healing meters with parses, deaths, Bloodlust timing, damage taken by ability, composition, interrupts, dispels and avoidable damage.',
      'Loading a report without a player in the link shows the breakdown straight away. Click anyone in it to analyze their fight.',
    ],
  },
  {
    version: '0.12.2',
    date: '2026-10-20',
    changes: ['Bot: the database now guarantees each character can only be claimed by one person, even if two people claim it at the same moment.'],
  },
  {
    version: '0.12.1',
    date: '2026-10-20',
    changes: [
      'Cast timeline: auto attacks (Auto Shot, Melee) are read from damage events when Warcraft Logs leaves them out of the casts.',
      'Bot: using /raidstart with a log that was used before reopens it, so /raidend works.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-10-20',
    changes: [
      'Cast timeline in the style of Warcraft Logs: auto attacks shown, casts colored by ability, and a legend to hide or show each ability.',
      'Cast timeline zooms with the scroll wheel, drags to move, and double-click resets.',
      'Bot: /raidend no longer takes a link. It ends the raid you started with /raidstart, and only you can end it.',
    ],
  },
  {
    version: '0.11.3',
    date: '2026-10-20',
    changes: ['Cast timeline: the hover tooltip follows the cursor and lists every cast and active Bloodlust or cooldown at that moment.'],
  },
  {
    version: '0.11.2',
    date: '2026-10-20',
    changes: ['Cast timeline: hover to see what was cast at that moment, and when Bloodlust and your big cooldowns were up.'],
  },
  {
    version: '0.11.1',
    date: '2026-10-20',
    changes: ['For testing: Mists of Pandaria logs (classic.warcraftlogs.com) can be loaded again, with their own cooldown list, and stat tooltips leave out the level-70 numbers on them.'],
  },
  {
    version: '0.11.0',
    date: '2026-10-20',
    changes: [
      'Burning Crusade only: links from other Warcraft Logs sites are turned away, and the Mists of Pandaria cooldowns are gone.',
      'Removed leftovers from old comparison options (top-ranked parse, previous kill, auto).',
      'Database cleanup script (supabase/cleanup.sql) to clear out non-Burning Crusade data and old caches.',
      'Game-specific content is marked in the code, ready to swap for WoW Forever.',
    ],
  },
  {
    version: '0.10.2',
    date: '2026-10-20',
    changes: [
      'Cooldowns are tracked for Mists of Pandaria Classic logs (classic.warcraftlogs.com) as well as Burning Crusade, using each version\u2019s own cooldown times.',
    ],
  },
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
