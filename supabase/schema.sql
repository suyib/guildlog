-- Run once in the Supabase SQL editor (safe to re-run).
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  host text not null,
  report_code text not null,
  fight_id int not null,
  encounter_id int not null,
  encounter_name text not null,
  player_name text not null,
  class_name text,
  spec_name text,
  dps numeric,
  parse_percent numeric,
  compare_key text not null default 'auto',
  result jsonb not null
);

-- One saved analysis per report + fight + player + comparison choice,
-- so each comparison keeps its own shareable link.
alter table public.analyses add column if not exists compare_key text not null default 'auto';
alter table public.analyses drop constraint if exists analyses_report_code_fight_id_player_name_key;
create unique index if not exists analyses_unique_comparison on public.analyses (report_code, fight_id, player_name, compare_key);
create index if not exists analyses_player_encounter on public.analyses (player_name, encounter_id, created_at desc);

-- Lock the table down: only the server (service role key) can read or write.
alter table public.analyses enable row level security;
