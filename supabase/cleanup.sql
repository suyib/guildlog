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

-- Stored raid summaries are a cache; keep only those for raids that are still listed
delete from public.bot_raid_fights where report_code not in (select report_code from public.bot_raids);

-- Caches: rebuilt automatically the next time a fight is analyzed
truncate public.snapshot_cache;
drop table if exists public.top_cache;

-- New analyses default to "no comparison"
alter table public.analyses alter column compare_key set default 'none';

commit;

-- What's left, for a quick check
select 'analyses' as table_name, count(*) from public.analyses
union all select 'bot_raids', count(*) from public.bot_raids
union all select 'bot_raid_fights', count(*) from public.bot_raid_fights
union all select 'bot_claims', count(*) from public.bot_claims
union all select 'bot_reminders', count(*) from public.bot_reminders;
