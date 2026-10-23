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


-- ---------- Past raids ----------

-- The guild's raids on the Past raids page: added by /raidend, "Add a past raid", or picked up
-- from the guild's uploads. card: the raid at a glance (bosses, wipes, attendance, feedback).
create table if not exists public.guild_raids (
  report_code text primary key,
  host text not null,
  title text,
  start_time timestamptz,
  end_time timestamptz,
  logger_name text,
  added_by text,
  source text not null default 'site' check (source in ('discord', 'site', 'auto')),
  status text not null default 'queued' check (status in ('queued', 'saving', 'saved', 'partial', 'empty')),
  saved int not null default 0,
  total int not null default 0,
  runs int not null default 0,
  card jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guild_raids_start on public.guild_raids (start_time desc);
create index if not exists guild_raids_status on public.guild_raids (status);

-- Saved copies of each raid (report, breakdowns, every player's analysis), used when Warcraft Logs is down.
create table if not exists public.saved_data (
  report_code text not null,
  kind text not null check (kind in ('meta', 'breakdown', 'rows', 'snapshot', 'dashboard')),
  fight_id int not null default 0,
  player_id int not null default 0,
  created_at timestamptz not null default now(),
  data jsonb not null,
  primary key (report_code, kind, fight_id, player_id)
);

alter table public.guild_raids enable row level security;
alter table public.saved_data enable row level security;

-- ---------- Site sign-ins (Admin page) ----------

-- Everyone who has signed in with Discord: which server, officer or not, first and last sign-in.
create table if not exists public.site_users (
  discord_id text primary key,
  username text not null default '',
  name text not null default '',
  avatar text,
  guild_id text,
  guild_name text,
  officer boolean not null default false,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  sign_ins int not null default 0
);

-- Every sign-in attempt (kept 90 days): Discord or guild password, and whether it worked.
create table if not exists public.site_signins (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('discord', 'password')),
  result text not null check (result in ('ok', 'not_member', 'wrong_password', 'error')),
  discord_id text,
  username text,
  guild_id text,
  guild_name text,
  detail text
);
create index if not exists site_signins_at on public.site_signins (at desc);

alter table public.site_users enable row level security;
alter table public.site_signins enable row level security;

-- Ranks and profile edits from the Admin page (v0.21.0)
alter table public.site_users add column if not exists rank text check (rank in ('guild_master', 'officer', 'raider'));
alter table public.site_users add column if not exists discord_rank text;
alter table public.site_users add column if not exists display_name text;
alter table public.site_users add column if not exists note text;
alter table public.site_users add column if not exists blocked boolean not null default false;
