-- v0.28.0: bug reports on the Admin page. Run once in Supabase -> SQL Editor (safe to run again).
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  discord_id text,
  username text,
  place text,
  raid_host text,
  raid_code text,
  what text not null,
  doing text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  note text,
  resolved_by text,
  resolved_at timestamptz
);
create index if not exists bug_reports_created on public.bug_reports (created_at desc);
alter table public.bug_reports enable row level security;
