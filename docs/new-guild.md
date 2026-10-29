# Running a copy for another guild

Each guild gets its own copy of Guild Logs: its own Vercel project, database, Discord bot and settings, from this same repo. Your guild's site stays exactly as it is. The copy below uses **Neon** (free Postgres) instead of Supabase, so it doesn't use up a Supabase project.

Everything here is free: Vercel Hobby, Neon Free, Warcraft Logs, Discord and cron-job.org.

You'll need about 30–45 minutes, and someone from the other guild with **Manage Server** in their Discord (or have them make you an admin there for the setup).

## 1. Vercel project

1. In Vercel, **Add New → Project** and import the same GitHub repo again. Give it a different name (e.g. `guildlog-vitanova`).
2. Don't deploy yet if it asks; the settings come first. If it deploys anyway, that's fine, it just won't work until step 6.
3. Under **Settings → Domains**, note its address (e.g. `guildlog-vitanova.vercel.app`), or add a domain for it. This is the copy's **site address** below.

Both projects deploy from the same repo, so every update you push reaches both.

## 2. Database (Neon)

Easiest: in the new Vercel project, **Storage → Create Database → Neon → Free**, and connect it to the project. Vercel adds `DATABASE_URL` for you.

Or on neon.com: create a free project, copy its **connection string** (Dashboard → Connect), and add it to the Vercel project as `DATABASE_URL`.

Then set up the tables: open Neon's **SQL Editor**, paste the whole of `supabase/schema.sql` and run it. (It's ordinary Postgres; the folder name is just history.) Run it again after updates that mention a migration; it's safe to run more than once.

Don't set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` on this project. If `DATABASE_URL` is set, the site uses it.

## 3. Warcraft Logs client

Create a new client at https://www.warcraftlogs.com/api/clients (name: the guild's name; redirect URL: the site address). Copy the **client ID** and **secret**. A separate client keeps each guild's request limits separate.

## 4. Discord app and bot

Each copy needs its own Discord app, because an app can only send commands to one site.

1. https://discord.com/developers/applications → **New Application** (e.g. "Guild Logs: Vita Nova").
2. **General Information**: copy the **Application ID** and **Public Key**. Upload the logo if you like.
3. **Bot**: **Reset Token** and copy it. Leave the privileged intents off.
4. **OAuth2**: copy the **Client Secret**, and under **Redirects** add `<site address>/api/login` (e.g. `https://guildlog-vitanova.vercel.app/api/login`).
5. Invite the bot to their server: **OAuth2 → URL Generator**, scopes `bot` and `applications.commands`, permissions View Channels, Send Messages, Send Messages in Threads, Embed Links. Open the link and pick their server.
6. In their Discord (Developer Mode on: Settings → Advanced), copy the **server ID**, the **officer role ID**, and channel IDs for the raid channel, an officers channel for claims, and optionally a private log channel.

## 5. Settings in Vercel

In the new project, **Settings → Environment Variables** (all environments):

| Name | Value |
|---|---|
| `DATABASE_URL` | from step 2 (already there if you used Vercel's Neon button) |
| `SESSION_SECRET` | a new long random string (`openssl rand -hex 32`); never reuse your guild's |
| `CRON_SECRET` | another new random string |
| `SITE_URL` | the site address, e.g. `https://guildlog-vitanova.vercel.app` |
| `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET` | step 3 |
| `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET` | step 4 |
| `DISCORD_GUILD_ID` | their server ID |
| `DISCORD_ADMIN_ROLE_ID` | their officer role |
| `DISCORD_RAID_CHANNEL_ID`, `DISCORD_ADMIN_CHANNEL_ID` | their raid and officer channels |
| `SITE_ADMIN_IDS` | your Discord user ID, so you can help them (add theirs too if they want full control) |
| `DISCORD_OWNER_ID` | your Discord user ID, so bug reports reach you |
| `WCL_GUILD_ID` | their guild's number on Warcraft Logs (fresh.warcraftlogs.com/guild/id/…), for ranks |

Optional: `DISCORD_LOG_CHANNEL_ID`, `DISCORD_BUG_CHANNEL_ID`, `GUILD_NAME` + `GUILD_REALM` + `GUILD_REGION` (adds their uploads to Past raids automatically), `TIMEZONE`, `SUPPORT_URL`, `BLIZZARD_CLIENT_ID` + `BLIZZARD_CLIENT_SECRET` (you can reuse yours).

Leave `APP_PASSWORD` unset so only Discord sign-in is offered.

## 6. Deploy and switch on the bot

1. **Deployments → Redeploy** so the settings apply.
2. Discord app → **General Information → Interactions Endpoint URL**: `<site address>/api/discord`. Discord checks it when you save; if it refuses, the deploy or `DISCORD_PUBLIC_KEY` isn't right yet.
3. Open `<site address>/api/discord?task=register&key=<CRON_SECRET>` once to add the commands.
4. Optional: `<site address>/api/discord?task=logtest&key=<CRON_SECRET>` posts a test line in the log channel.

## 7. The background job

Reminders, and reading raids into Past raids, run from a scheduled call. On cron-job.org, add a job for `<site address>/api/discord?task=reminders&key=<CRON_SECRET>`.

**Mind Neon's free compute.** Neon's free plan gives each project 100 compute-hours a month, and the database stays awake for 5 minutes after every request. A call every 5 minutes, all day, would keep it awake around the clock and use the month's hours in about 2–3 weeks; Neon then pauses the database until the next month. So schedule it:

- every **5 minutes** during their raid evenings (e.g. 18:00–01:00 on raid days), and
- every **30–60 minutes** the rest of the time.

On cron-job.org that's two jobs with different schedules for the same address. Neon's dashboard shows the hours used so far.

## 8. Hand over

1. Sign in on the site with Discord. You're Admin (from `SITE_ADMIN_IDS`).
2. On the **Admin** page, set their guild master and officers' ranks, and fill in **Guild details** if they want a different name or picture.
3. Send them the site address and the Discord intro message. Their raiders `/claim` their characters, and officers use `/raidstart` and `/raidend` as usual.

## Updating

Pushing to the repo updates both copies. When a release mentions a migration (`supabase/migrate-*.sql`), run it on **both** databases: in Supabase for yours, in Neon's SQL Editor for theirs. Re-register commands on both when a release changes them.

## Toward one site for every guild

Copies are the quickest way to test with another guild, but each one needs you for setup. For guilds to sign up on their own, like a raid planner bot, Guild Logs needs to become one site and one bot that any guild can add. The steps, roughly in order:

1. **One bot for everyone.** Guilds invite a single public bot; a `/setup` command (Manage Server only) picks the raid channel, officer role and log channel. These move from Vercel settings into a `guilds` table.
2. **Every row knows its guild.** Add `guild_id` to the guild-specific tables (raids, claims, reminders, kill stats, site users, settings, bug reports) and filter every query by it. Stored fights and item names can stay shared: a log is the same for everyone who reads it, so two guilds reading the same report saves work.
3. **Sign-in picks the guild.** After Discord sign-in, the site shows the servers you share with the bot, and each page works on the chosen one. Admin ranks become per guild, with you as a site-wide admin for support.
4. **Self-serve settings.** A Settings page for guild masters: Warcraft Logs guild, time zone, raid schedule, name and picture.
5. **Limits and costs.** Per-guild limits on raid reads, so one busy guild can't use up Warcraft Logs' request allowance or the database. Free tiers stop being enough somewhere in the tens of guilds: expect Vercel Pro (also required if it ever makes money) and a paid Neon plan, roughly $20–40 a month to start. The Buy me a coffee link (or a supporter tier) can cover that.
6. **Support.** The bug report button and activity log already exist; they'd carry the guild's name, so you can see whose problem it is.

The copy you're setting up now uses the same code, so nothing learned from the test guild is wasted.
