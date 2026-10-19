-- Run once in the Supabase SQL editor.
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
  result jsonb not null,
  unique (report_code, fight_id, player_name)
);

create index if not exists analyses_player_encounter on public.analyses (player_name, encounter_id, created_at desc);

-- Lock the table down: only the server (service role key) can read or write.
alter table public.analyses enable row level security;
