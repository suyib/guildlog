-- v0.41.0: personal goals (a parse to reach, set on each person's profile).
-- Run once in Supabase -> SQL Editor (or Neon -> SQL Editor). Safe to run again.
create table if not exists public.player_goals (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  character text not null,
  encounter_id int,                     -- null: any boss
  encounter_name text,
  target int not null check (target between 1 and 100),
  created_at timestamptz not null default now(),
  achieved_at timestamptz,
  achieved_parse numeric,
  achieved_code text
);
create index if not exists player_goals_owner on public.player_goals (discord_id);
create index if not exists player_goals_open on public.player_goals (achieved_at) where achieved_at is null;
alter table public.player_goals enable row level security;
