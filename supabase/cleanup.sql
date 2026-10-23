-- Keep only Burning Crusade data (fresh.warcraftlogs.com) and remove leftovers from features that
-- no longer exist. Safe to run more than once. Run in Supabase -> SQL Editor.
-- Later, for WoW Forever: change 'fresh.warcraftlogs.com' below to Forever's Warcraft Logs site.

begin;

-- Saved analyses from any other game version
delete from public.analyses where host <> 'fresh.warcraftlogs.com';

-- Saved analyses made with comparisons that were removed (auto, top-ranked parse, previous kill)
delete from public.analyses where compare_key in ('auto', 'top', 'previous');

-- Bot raids from any other game version
delete from public.bot_raids where host <> 'fresh.warcraftlogs.com';

-- Past raids from any other game version
delete from public.guild_raids where host <> 'fresh.warcraftlogs.com';

-- Stored fights from any other game version
delete from public.fight_packs where host <> 'fresh.warcraftlogs.com';

-- Guild benchmarks from raids that are no longer on Past raids
delete from public.kill_stats where report_code not in (select report_code from public.guild_raids);

-- Tables replaced in v0.23.0 (if migrate-0.23.sql wasn't run)
drop table if exists public.snapshot_cache;
drop table if exists public.saved_data;
drop table if exists public.bot_raid_fights;
drop table if exists public.top_cache;

-- New analyses default to "no comparison"
alter table public.analyses alter column compare_key set default 'none';

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
