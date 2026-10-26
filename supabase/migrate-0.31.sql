-- v0.31.0: guild details on the Admin page. Run once in Supabase -> SQL Editor (safe to run again).
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.site_settings enable row level security;
