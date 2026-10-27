-- v0.36.0: new ranks (raid leader, raid assist, loot council) on the Admin page.
-- Run once in Supabase -> SQL Editor (safe to run again).
alter table public.site_users drop constraint if exists site_users_rank_check;
alter table public.site_users add constraint site_users_rank_check
  check (rank in ('guild_master', 'officer', 'raid_leader', 'raid_assist', 'loot_council', 'raider'));
