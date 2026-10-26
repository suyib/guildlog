# Guild Logs

Paste a Warcraft Logs link, pick a boss and a player, and get a plain-English summary of what went well and what to work on, either on its own or compared with:

- anyone else in the same fight, or
- someone in another log you load.

The site is set up for one game version at a time (Burning Crusade logs from fresh.warcraftlogs.com for now; see "Game content" below).

Every analysis is saved to Supabase, so it stays available after Warcraft Logs archives the report. The whole site sits behind one shared guild password.

## Stack

- Vite + React front end, deployed on Vercel
- Vercel Functions in `api/` call the Warcraft Logs v2 API (the client secret never reaches the browser). An analysis runs as several short requests (`/api/fight`, `/api/snapshot` per player, `/api/dashboard`, `/api/finish`) so long fights don't hit the function time limit.
- Ability, buff and class icons load from Wowhead's icon CDN (wow.zamimg.com) using the icon names Warcraft Logs provides
- Vercel Routing Middleware (`middleware.ts`) gates every page and API route behind the password
- Supabase Postgres stores analyses (accessed only server-side with the service role key)

## Setup

1. **Warcraft Logs API client**: create one at https://www.warcraftlogs.com/api/clients (any name; redirect URL: https://guildlog.uk). Copy the client ID and secret.
2. **Supabase**: create a project, open the SQL editor and run `supabase/schema.sql`. Copy the project URL and the service role key (Settings → API).
3. **Vercel**: import this repo, then add these environment variables (see `.env.example`):
   - `APP_PASSWORD`: the guild password (optional once Discord sign-in is set up; remove it to allow Discord sign-in only)
   - `SESSION_SECRET`: a long random string (e.g. `openssl rand -hex 32`)
   - `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
4. **Optional, character portraits**: create a client at https://develop.battle.net/access/clients and add `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` in Vercel. Without them the class icon is shown instead. If portraits don't appear, set `BLIZZARD_PROFILE_NAMESPACES` to the namespace your realms use (e.g. `profile-classicann`).
5. **Domain**: the live site is https://guildlog.uk. In Vercel → Project → Settings → Domains it's added with `www.guildlog.uk` and `guildlog-pi.vercel.app` redirecting to it. The app builds share links from whatever domain it's opened on, so no code changes are needed when the domain changes.

Changing `APP_PASSWORD` doesn't sign people out; changing `SESSION_SECRET` does.

## Signing in with Discord

People sign in with their Discord account; only members of the guild's server (`DISCORD_GUILD_ID`) get in, and officers (the server owner, Administrator or Manage Server, or `DISCORD_ADMIN_ROLE_ID`) get officer-only actions such as adding raids. Officer status is checked again with Discord for every officer action.

1. Discord developer portal → your app → **OAuth2**: copy the **Client Secret** (Reset Secret if needed) into Vercel as `DISCORD_CLIENT_SECRET`.
2. Same page → **Redirects** → add `https://guildlog.uk/api/login` (it must match `SITE_URL` + `/api/login` exactly). Save.
3. Redeploy. The sign-in page shows **Sign in with Discord**, plus the password box while `APP_PASSWORD` is set. Until `DISCORD_CLIENT_SECRET` is set, the password works as before and everyone signed in counts as an officer.

Sessions last 7 days (30 with the password).

**Who can see what.** Guild members (signed in with Discord, in the guild's server) can use everything. Anyone else is refused at sign-in with a page explaining why. Shared analysis links (`/a/<id>`) open for anyone with the link, read-only: guests see the analysis and its comparisons but can't change it or reach anything else. Signed-in members can change a shared analysis's comparison, which saves a new one. Membership is checked again every 10 minutes, so someone who leaves the server loses access.

**Ranks.** Admin (only `SITE_ADMIN_IDS`), Guild master (the Discord server owner by default), Officer (Administrator, Manage Server or `DISCORD_ADMIN_ROLE_ID` on Discord by default) and Raider (everyone else). A rank set on the Admin page wins over Discord, and the bot's officer-only commands use the same ranks. Each rank can edit people below it and give them ranks below its own; admins can edit everyone. Run `supabase/schema.sql` again after updating (it adds the rank columns).

**Admin page.** Officers and above see it. Set `SITE_ADMIN_IDS` to your Discord user ID (Discord → Settings → Advanced → Developer Mode, then right-click your name → Copy User ID; comma-separate several). Signed in with Discord, you'll see **Admin** in the menu: everyone who has signed in or used the bot, their server, officer or member, when they first connected (site and bot), when they last signed in, their claimed characters, and the sign-in log (90 days). Needs the `site_users` and `site_signins` tables: run `supabase/schema.sql` again. Sign-ins, failed sign-ins from non-members and officer actions are posted to the activity log channel.

## Offering it to other guilds later

Every Discord sign-in records which server it's for, and a session only opens the site of that server, so the sign-in side is ready for more than one guild. Two ways to grow from here:

- **A copy per guild** (no extra cost, data fully separate): each guild deploys this repo with its own Vercel, Supabase, Warcraft Logs client and Discord app. See the settings above.
- **One hosted site for many guilds**: add a `guilds` table (server ID, name, officer role, allowed Warcraft Logs sites), add a `guild_id` column to the raid, claim and saved-data tables, and pick the guild from the signed-in session instead of `DISCORD_GUILD_ID`. Selling access needs Vercel Pro (the free plan is for non-commercial use) and likely a paid database.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npx vercel dev               # runs the UI, API functions and middleware together
npm test                     # offline checks of the analysis logic
```

## Game content

Everything specific to the game version is marked `GAME CONTENT` at the top of its file. To switch to WoW Forever, update:

- `server/game.ts`: the version's name and which Warcraft Logs site(s) are accepted
- `server/cooldowns.ts`: cooldowns to audit and their lengths
- `server/buffs.ts`: buffs that any class can have (used for cross-class comparisons)
- `src/statInfo.ts`: what each stat does, and the rating numbers
- `server/discord/info.ts`: the bot's consumables lists

Then run `supabase/cleanup.sql` with the new site name to clear out the old version's data.

While testing, Mists of Pandaria logs (classic.warcraftlogs.com) are also allowed. Everything for that is marked `TESTING ONLY`; remove it before raiding starts.

## Discord bot

The bot runs on the same Vercel project (no extra server) as a single function, `api/discord.ts`, because the free Vercel plan allows 12 functions. Commands: `/raidstart`, `/raidend`, `/raids`, `/check`, `/claim`, `/unclaim`, `/remind`, `/info`, `/help`. Character numbers are only ever sent by DM (or shown to the person who asked); channels only get raid-wide summaries.

1. In the Discord developer portal, create the app and bot, then add the `DISCORD_*` values and `CRON_SECRET` to Vercel (see `.env.example`) and redeploy.
2. Set **Interactions Endpoint URL** to `https://guildlog.uk/api/discord`.
3. Invite the bot with the `bot` and `applications.commands` scopes (permissions: Send Messages, Embed Links, View Channels).
4. Open `https://guildlog.uk/api/discord?task=register&key=YOUR_CRON_SECRET` to register the commands (again whenever they change).
5. For reminders, have a free scheduler (e.g. cron-job.org) open `https://guildlog.uk/api/discord?task=reminders&key=YOUR_CRON_SECRET` every 5 minutes. Vercel also runs it once a day as a backup.

**Raid posts.** `/raidstart` and `/raidend` post in the thread (or channel) they're typed in, so each raid can have its own thread. The bot needs **Send Messages in Threads** there (and, for a private thread, to be added to it). Used from a DM to the bot, they post in `DISCORD_RAID_CHANNEL_ID`.

**Bug reports.** A **Report a bug** button (under each raid summary and in `/help`) opens a short form. Reports go to `DISCORD_BUG_CHANNEL_ID` if set (a channel in a separate test server works, once the bot is added there), otherwise to `DISCORD_OWNER_ID` by DM.

**Activity log (optional).** Set `DISCORD_LOG_CHANNEL_ID` to a private channel and the bot posts one line per command or button press: who, what (command and which options were used, never what was typed), where, when, and whether it worked or the error if not. Failed reminders and command registration are logged too. Mentions in the log don't ping anyone. To check it's set up, open `https://guildlog.uk/api/discord?task=logtest&key=YOUR_CRON_SECRET`: it posts a test line, or says what's wrong.

The bot reads the same stored fights as the site (see **Stored fights** below), so its DMs and raid summary always match what the site shows, and button presses are instant.

## Past raids

The **Past raids** page shows a calendar of raid nights, a card for each (bosses, kill times, wipes, deaths, what went well and what to work on, and who was there), attendance over time and kill times per boss.

- Raids are added by `/raidend`, by **Add a past raid** on the page, or automatically from the guild's uploads if `GUILD_NAME`, `GUILD_REALM` and `GUILD_REGION` are set.
- Each raid is then stored by the every-5-minutes job (`?task=reminders`, the same one that posts reminders): one read per boss kill. A night is usually done within the hour.
- Guild masters and admins can **Delete raid** on a raid's card. It removes the raid, every stored fight, the report's fight list and saved analyses of that log (the activity log notes who did it). Adding it again reads it from Warcraft Logs as new.
- When Warcraft Logs is down, stored raids still load on the site and in the bot. Comparing with a log that's never been read still needs Warcraft Logs.

## Stored fights

Each boss fight is read from Warcraft Logs **once** and kept in `fight_packs` (compressed). Every player's analysis, gear and charts, the whole-raid breakdown, Whole night, raid cards and the Discord DMs and raid summary are worked out from that one copy, so they always agree and Warcraft Logs isn't asked again.

- A read is about 15–30 requests per boss (fight-wide tables, every event in a few time slices, buffs, gear), instead of 8–12 per player per boss before.
- A stored kill is roughly 60–120 KB; a raid night roughly 1 MB.
- A finished log's fight list is reused too (3 hours after its last fight). Item and enchant names are learned once into `item_names`.
- Logs that aren't on Past raids (comparisons with other guilds' logs) are removed after a week unused. Past raids keep each kill whole for `ARCHIVE_DAYS` (default 90), then just its tables and summary (about a fifth of the size): breakdowns, cards and the bot still work; a player's cast timeline would need a fresh read.
- Potions, damage-over-time uptime, boss debuffs, death recaps and tank mitigation all come from the same stored fight (no extra Warcraft Logs requests beyond the boss-debuffs table). The spell lists and the defense-cap rule are in `server/gameData.ts` (GAME CONTENT).
- Guild benchmarks and trends use `kill_stats`: one small row per player per kill of the guild's Past raids. Deleting a raid removes its rows too.
- Upgrading from v0.22 or earlier: run `supabase/migrate-0.23.sql` once after deploying (safe to run again; it also adds `kill_stats`). It keeps the bot's summaries, removes `snapshot_cache`, `saved_data` and `bot_raid_fights`, and queues Past raids to be read once into the new format.

## Releases

Every version bump in `package.json` gets a short entry at the top of `src/changelog.ts`, which feeds the Changelog page (linked next to the version number in the menu).

## Tuning the analysis

- `server/cooldowns.ts`: the cooldowns that get audited (name → cooldown in seconds) and the gap threshold. Add Forever's real abilities and values here as logs come in.
- `server/analysis.ts`: `buildFindings` turns the numbers into the ranked "What to work on" list. Each finding is a small, self-contained rule.

## Notes

- Report data comes from the Warcraft Logs API, so a report must be public or unlisted, and a fight has to be read before the report is archived. After that, the stored copy here is permanent (for Past raids).
- The top-parse comparison uses Warcraft Logs rankings for the same encounter, class and spec.
- Check the Warcraft Logs API terms before sharing the site beyond your guild.
