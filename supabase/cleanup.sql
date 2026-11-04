-- Start fresh for WoW Forever (forever.warcraftlogs.com): removes every raid, stored fight,
-- analysis and benchmark from earlier game versions and test logs. Keeps people, ranks, claimed
-- characters, guild details, reminders and bug reports. Safe to run more than once.
-- Run in Supabase -> SQL Editor (or Neon -> SQL Editor). If the game version changes again,
-- change 'forever.warcraftlogs.com' below to the new Warcraft Logs site.

begin;

-- Saved analyses, raids from /raidstart, Past raids and stored fights from any other site
delete from public.analyses where host <> 'forever.warcraftlogs.com';
delete from public.bot_raids where host <> 'forever.warcraftlogs.com';
delete from public.guild_raids where host <> 'forever.warcraftlogs.com';
delete from public.fight_packs where host <> 'forever.warcraftlogs.com';

-- Guild benchmarks and trends from raids that are no longer on Past raids
delete from public.kill_stats where report_code not in (select report_code from public.guild_raids);

-- Item and enchant names are learned again from Forever's logs
delete from public.item_names;

-- Claimed characters from the old version: uncomment to clear them too (raiders /claim again)
-- delete from public.bot_claims;

commit;

-- What's left, for a quick check
select 'analyses' as table_name, count(*) from public.analyses
union all select 'bot_raids', count(*) from public.bot_raids
union all select 'bot_claims', count(*) from public.bot_claims
union all select 'bot_reminders', count(*) from public.bot_reminders
union all select 'guild_raids', count(*) from public.guild_raids
union all select 'fight_packs', count(*) from public.fight_packs
union all select 'item_names', count(*) from public.item_names
union all select 'kill_stats', count(*) from public.kill_stats;
