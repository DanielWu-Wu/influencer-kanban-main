-- Run this file once in Supabase SQL Editor.

create table if not exists public.creator_prospects (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists creator_prospects_user_updated_idx
  on public.creator_prospects (user_id, updated_at desc);

alter table public.creator_prospects enable row level security;

revoke all on table public.creator_prospects from anon;
grant select, insert, update, delete on table public.creator_prospects to authenticated;

drop policy if exists "Users manage own creator prospects" on public.creator_prospects;
create policy "Users manage own creator prospects"
on public.creator_prospects for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
