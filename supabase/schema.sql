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
  compare_key text not null default 'none',
  result jsonb not null
);

-- One saved analysis per report + fight + player + comparison choice,
-- so each comparison keeps its own shareable link.
alter table public.analyses add column if not exists compare_key text not null default 'none';
alter table public.analyses alter column compare_key set default 'none';
alter table public.analyses drop constraint if exists analyses_report_code_fight_id_player_name_key;
create unique index if not exists analyses_unique_comparison on public.analyses (report_code, fight_id, player_name, compare_key);
create index if not exists analyses_player_encounter on public.analyses (player_name, encounter_id, created_at desc);

-- Lock the table down: only the server (service role key) can read or write.
alter table public.analyses enable row level security;

-- Caches that make repeat analyses fast. Safe to clear at any time.
create table if not exists public.snapshot_cache (
  key text primary key,
  created_at timestamptz not null default now(),
  snapshot jsonb not null
);
alter table public.snapshot_cache enable row level security;

-- ---------- Discord bot ----------

-- Characters people have claimed. An officer approves each claim.
create table if not exists public.bot_claims (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  discord_id text not null,
  discord_name text not null,
  character text not null,
  character_key text not null,          -- lower-case name, for matching
  realm text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz
);
create index if not exists bot_claims_discord on public.bot_claims (discord_id);
create index if not exists bot_claims_character on public.bot_claims (character_key);
-- Hard guarantee: one live claim (waiting or approved) per character and realm, even if two people
-- ask at the same moment. Rejected claims don't count, so the real owner can still claim it.
create unique index if not exists bot_claims_one_owner on public.bot_claims (character_key, lower(coalesce(realm, ''))) where status <> 'rejected';

-- Raids started with /raidstart (one row per Warcraft Logs report).
create table if not exists public.bot_raids (
  id uuid primary key default gen_random_uuid(),
  host text not null,
  report_code text not null unique,
  title text,
  started_by text not null,
  logger_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Everyone's numbers for one boss fight, built once so button clicks are instant.
create table if not exists public.bot_raid_fights (
  report_code text not null,
  fight_id int not null,
  created_at timestamptz not null default now(),
  data jsonb not null,
  primary key (report_code, fight_id)
);

-- Reminders posted by the scheduled job.
create table if not exists public.bot_reminders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel_id text not null,
  created_by text not null,
  send_at timestamptz not null,
  payload jsonb not null,
  sent boolean not null default false
);
create index if not exists bot_reminders_due on public.bot_reminders (sent, send_at);

alter table public.bot_claims enable row level security;
alter table public.bot_raids enable row level security;
alter table public.bot_raid_fights enable row level security;
alter table public.bot_reminders enable row level security;
