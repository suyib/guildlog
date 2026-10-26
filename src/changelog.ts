// Release notes shown on the Changelog page (newest first). Add an entry with every version bump.

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '0.28.0',
    date: '2026-10-26',
    changes: [
      'Bug reports from the Report a bug button are kept and shown on the Admin page as cards: mark them fixed (optionally telling the reporter by DM, with a note), reopen them, or delete them. Sending a report no longer fails when no bug channel is set up.',
    ],
  },
  {
    version: '0.27.1',
    date: '2026-10-26',
    changes: ['Potions are only judged once at least half the night\u2019s bosses have been read in full, and say how many were checked.'],
  },
  {
    version: '0.27.0',
    date: '2026-10-26',
    changes: [
      'Discord: My overview is gone (the quick summary covers it). The quick summary is shorter and ends with your personal bests from the night instead of a boss-by-boss guild list.',
      'Damage and healing breakdowns are condensed: top abilities, only where you differ from others of your spec, and DPS (or HPS) with parse per boss.',
      'Bosses where you did nothing (like Chess Event) no longer count towards your averages or weakest boss.',
    ],
  },
  {
    version: '0.26.3',
    date: '2026-10-26',
    changes: ['Mana over the fight is removed: this game version\u2019s logs don\u2019t record the mana pool in a form Warcraft Logs can read. Fights are read with less data as a result.'],
  },
  {
    version: '0.26.2',
    date: '2026-10-26',
    changes: [
      'Mana is read more reliably from Warcraft Logs, for the mana-over-the-fight chart on a healer\u2019s Overview (it says why when there\u2019s none). Stored fights are read again to pick it up.',
      'Casts per minute lists everything cast, so healers see their heals and totems, not only damage spells.',
    ],
  },
  {
    version: '0.26.1',
    date: '2026-10-26',
    changes: [
      'Spell names and icons come from Warcraft Logs\u2019 own tables when its spell list doesn\u2019t answer, instead of showing spell numbers.',
      'Fights stored by an older version are read again (when opened, by the 5-minute job, or with Read now), and Check stored data shows what each read received, including mana.',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-10-26',
    changes: [
      'Shared analysis links open for anyone, read-only, with a Sign in with Discord button. Everything else (analyzing, Past raids, History) stays for guild members.',
      'Someone who leaves the guild\u2019s Discord loses access within 10 minutes, with a page explaining why, instead of keeping it until their sign-in runs out.',
    ],
  },
  {
    version: '0.25.3',
    date: '2026-10-26',
    changes: ['Discord: /raidstart and /raidend post in the thread (or channel) they\u2019re typed in, so each raid can have its own thread.'],
  },
  {
    version: '0.25.2',
    date: '2026-10-23',
    changes: ['Discord: /raidstart always posts the live log in the raid log channel, and /raidend always posts the summary in the summary channel, wherever they\u2019re typed.'],
  },
  {
    version: '0.25.1',
    date: '2026-10-23',
    changes: [
      'A raid ended with /raidend starts being read straight away, so it\u2019s on the calendar within a minute or two.',
      'Officers: Check stored data and Read now on each Past raids card; guild masters and admins can also read a raid again from scratch.',
      'An analysis of a fight that isn\u2019t fully read yet now says so and why, instead of quietly leaving out mana, tank swings and the rest. Tank swings also show in the Overview\u2019s fight facts.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-10-23',
    changes: [
      'Potions (including pre-pots), your damage-over-time uptime and the debuffs kept on the boss, with feedback on the site and in Discord.',
      'Deaths show the last hits and the healing received in the 10 seconds before.',
      'Healers: mana over the fight, and when it ran out. Tanks: dodges, parries, blocks and crits from the boss.',
      'Against the guild: where a fight sits among the guild\u2019s own kills of that boss in your spec, on analyses and in your Discord summary. Profiles and /check show parses week by week.',
    ],
  },
  {
    version: '0.24.0',
    date: '2026-10-23',
    changes: [
      'Guild masters and admins can delete a raid from Past raids (Delete raid on its card). Everything stored for it goes too, including saved analyses of that log; adding it again reads it from Warcraft Logs as a new raid.',
    ],
  },
  {
    version: '0.23.0',
    date: '2026-10-23',
    changes: [
      'Each boss fight is read from Warcraft Logs once and stored. Analyses, gear and charts, breakdowns, Whole night and the Discord DMs and raid summary all come from that copy, so the site and Discord always match, and fights already read open instantly.',
      'About a tenth of the Warcraft Logs requests and database space of before. Gear keeps item names, the cast timeline keeps auto attacks, and pet damage stays labeled.',
      'Once a fight has been read, picking it (or a player, or who to compare with) shows the analysis straight away, with no need to click Analyze. Fights not read yet still wait for the click.',
    ],
  },
  {
    version: '0.22.0',
    date: '2026-10-23',
    changes: [
      '\u201cWhole night\u201d is the first choice in the boss list, and opens by default: every boss with kill times and wipes, raid time, deaths, who was there, what went well and what to work on, and everyone\u2019s DPS, HPS and parses across the night. Bosses still being read fill in on their own.',
      'Past raids: a new raid gets its card as soon as its report is read, and opening its whole night brings the card up to date.',
    ],
  },
  {
    version: '0.21.0',
    date: '2026-10-23',
    changes: [
      'Ranks: Admin, Guild master, Officer and Raider, shown in the menu and on profiles. Taken from Discord by default; a rank set on the Admin page wins, and the bot uses the same ranks.',
      'Admin page for officers and above: edit anyone below your rank (rank, display name, officer note, site access, and adding, approving or removing characters). Every change is noted in the activity log.',
    ],
  },
  {
    version: '0.20.1',
    date: '2026-10-23',
    changes: ['Past raids and the home page show a raid as soon as its report is read (bosses, kill times, who was there), instead of waiting for every boss to be saved; deaths and the summary fill in as each kill is read.'],
  },
  {
    version: '0.20.0',
    date: '2026-10-23',
    changes: [
      'Home page: the guild\u2019s Discord server and member count, the next raid from /remind, raid numbers for the last 8 weeks, the latest raids with kill times, the last raid\u2019s highlights, your characters and recent analyses.',
      'Your profile (click your name in the menu): a card for each claimed character with class, spec, level, realm, item level, attendance, latest raid and parse, and a link to analyze their best boss.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-10-23',
    changes: [
      'Admin page (site admins only): everyone who has signed in or used the bot, their Discord server, officer or member, when they first connected and last signed in, their claimed characters, and a 90-day sign-in log.',
    ],
  },
  {
    version: '0.18.0',
    date: '2026-10-23',
    changes: [
      'Sign in with Discord: only members of the guild\u2019s server get in, and your name and avatar show in the menu. The guild password still works while it\u2019s set.',
      'Officer-only actions: only officers can add raids to Past raids, checked with Discord each time.',
      'Sign-ins and raids added on the site are noted in the activity log channel.',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-10-23',
    changes: [
      'Two healers are compared on healing: HPS, healing parse, overheal, active time and spells side by side, with feedback on where the gap is.',
      'Discord: healers\u2019 DM pages are about healing (HPS, healing parse, overheal, place among the healers, spells), and the raid summary counts healers by their healing parse.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-10-23',
    changes: [
      'Healing done tab beside Damage done: HPS, healing parse, healing over the fight, healing by spell with overheal, and healer-focused feedback. Opens by default for healers.',
      'Buffs & survival: damage taken over the fight, with what hit hardest at each moment and when you died.',
    ],
  },
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
