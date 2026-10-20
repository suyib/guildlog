# Guild Logs

Paste a Warcraft Logs link, pick a boss and a player, and get a plain-English summary of what to work on, compared with:

- the best two players of the same class in the same raid,
- a top-ranked parse of the same spec on that boss,
- your own previous kill of that boss (from saved analyses).

Every analysis is saved to Supabase, so it stays available after Warcraft Logs archives the report. The whole site sits behind one shared guild password.

## Stack

- Vite + React front end, deployed on Vercel
- Vercel Functions in `api/` call the Warcraft Logs v2 API (the client secret never reaches the browser). An analysis runs as several short requests (`/api/snapshot` per player, `/api/targets`, `/api/finish`) so long fights don't hit the function time limit.
- Ability, buff and class icons load from Wowhead's icon CDN (wow.zamimg.com) using the icon names Warcraft Logs provides
- Vercel Routing Middleware (`middleware.ts`) gates every page and API route behind the password
- Supabase Postgres stores analyses (accessed only server-side with the service role key)

## Setup

1. **Warcraft Logs API client**: create one at https://www.warcraftlogs.com/api/clients (any name; redirect URL can be your site URL). Copy the client ID and secret.
2. **Supabase**: create a project, open the SQL editor and run `supabase/schema.sql`. Copy the project URL and the service role key (Settings → API).
3. **Vercel**: import this repo, then add these environment variables (see `.env.example`):
   - `APP_PASSWORD`: the guild password
   - `SESSION_SECRET`: a long random string (e.g. `openssl rand -hex 32`)
   - `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET`
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
4. **Optional, character portraits**: create a client at https://develop.battle.net/access/clients and add `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` in Vercel. Without them the class icon is shown instead. If portraits don't appear, set `BLIZZARD_PROFILE_NAMESPACES` to the namespace your realms use (e.g. `profile-classicann`).
5. **Domain**: in Vercel → Project → Domains, add your subdomain (e.g. `logs.suyin.uk`) and create the CNAME record it shows you.

Changing `APP_PASSWORD` doesn't sign people out; changing `SESSION_SECRET` does.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npx vercel dev               # runs the UI, API functions and middleware together
npm test                     # offline checks of the analysis logic
```

## Releases

Every version bump in `package.json` gets a short entry at the top of `src/changelog.ts`, which feeds the Changelog page (linked next to the version number in the menu).

## Tuning the analysis

- `server/cooldowns.ts`: the cooldowns that get audited (name → cooldown in seconds) and the gap threshold. Add Forever's real abilities and values here as logs come in.
- `server/analysis.ts`: `buildFindings` turns the numbers into the ranked "What to work on" list. Each finding is a small, self-contained rule.

## Notes

- Report data comes from the Warcraft Logs API, so a report must be public or unlisted, and the analysis has to run before the report is archived. After that, the saved copy here is permanent.
- The top-parse comparison uses Warcraft Logs rankings for the same encounter, class and spec.
- Check the Warcraft Logs API terms before sharing the site beyond your guild.
