-- v0.23.0: stored fights. Run once in Supabase -> SQL Editor, after deploying v0.23.0.
-- Moves what's worth keeping into the new fight_packs table, then removes the three tables it
-- replaces (snapshot_cache, saved_data, bot_raid_fights). Safe to run more than once.

begin;

create table if not exists public.fight_packs (
  report_code text not null,
  fight_id int not null,
  host text not null,
  stage text not null check (stage in ('meta-live', 'meta-final', 'tables', 'full', 'legacy')),
  digest jsonb,
  pack text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (report_code, fight_id)
);
create index if not exists fight_packs_updated on public.fight_packs (updated_at);

create table if not exists public.item_names (
  kind text not null check (kind in ('item', 'enchant')),
  id int not null,
  name text not null,
  icon text,
  quality int,
  primary key (kind, id)
);

alter table public.fight_packs enable row level security;
alter table public.item_names enable row level security;

do $$
begin
  -- The bot's raid summaries keep answering in Discord until each raid is read again
  if to_regclass('public.bot_raid_fights') is not null then
    insert into public.fight_packs (report_code, fight_id, host, stage, digest)
    select f.report_code, f.fight_id, coalesce(g.host, b.host, 'fresh.warcraftlogs.com'), 'legacy', f.data
    from public.bot_raid_fights f
    left join public.guild_raids g on g.report_code = f.report_code
    left join public.bot_raids b on b.report_code = f.report_code
    on conflict (report_code, fight_id) do nothing;
  end if;
  -- Past raids' fight lists (no need to ask Warcraft Logs for them again)
  if to_regclass('public.saved_data') is not null then
    insert into public.fight_packs (report_code, fight_id, host, stage, digest)
    select s.report_code, 0, g.host, 'meta-final', s.data
    from public.saved_data s join public.guild_raids g on g.report_code = s.report_code
    where s.kind = 'meta'
    on conflict (report_code, fight_id) do nothing;
  end if;
end $$;

-- Past raids are read once more into the new format by the every-5-minutes job
-- (one read per boss kill; raids older than ARCHIVE_DAYS get their tables only)
update public.guild_raids set status = 'queued', runs = 0, saved = 0
where status in ('saved', 'saving', 'partial');

drop table if exists public.snapshot_cache;
drop table if exists public.saved_data;
drop table if exists public.bot_raid_fights;

commit;

-- What's there now
select 'fight_packs' as table_name, count(*) from public.fight_packs
union all select 'guild_raids queued again', count(*) from public.guild_raids where status = 'queued';
