-- Run this file once in Supabase SQL Editor.

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  model text not null default '',
  product_url text not null default '',
  selling_points text not null default '',
  technical_specifications text not null default '',
  image_and_resource_links text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  market_profiles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists products_user_id_idx on public.products(user_id);

create table if not exists public.user_secrets (
  user_id uuid not null references auth.users(id) on delete cascade,
  secret_key text not null,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, secret_key)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_secrets'
      and column_name = 'encrypted_value'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_secrets'
      and column_name = 'secret_value'
  ) then
    alter table public.user_secrets rename column encrypted_value to secret_value;
  end if;
end
$$;

alter table public.app_settings enable row level security;
alter table public.products enable row level security;
alter table public.user_secrets enable row level security;

revoke all on table public.app_settings from anon;
revoke all on table public.products from anon;
grant select, insert, update, delete on table public.app_settings to authenticated;
grant select, insert, update, delete on table public.products to authenticated;

drop policy if exists "Users manage own settings" on public.app_settings;
create policy "Users manage own settings"
on public.app_settings for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own products" on public.products;
create policy "Users manage own products"
on public.products for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Private account configuration is only available through the functions below.
revoke all on table public.user_secrets from anon, authenticated;

create or replace function public.set_user_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.user_secrets (user_id, secret_key, secret_value)
  values (auth.uid(), p_key, p_value)
  on conflict (user_id, secret_key)
  do update set secret_value = excluded.secret_value, updated_at = now();
end;
$$;

create or replace function public.get_user_secret(p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  result text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select secret_value into result
  from public.user_secrets
  where user_id = auth.uid() and secret_key = p_key;

  return result;
end;
$$;

create or replace function public.delete_user_secret(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.user_secrets
  where user_id = auth.uid() and secret_key = p_key;
end;
$$;

revoke all on function public.set_user_secret(text, text) from public;
revoke all on function public.get_user_secret(text) from public;
revoke all on function public.delete_user_secret(text) from public;
grant execute on function public.set_user_secret(text, text) to authenticated;
grant execute on function public.get_user_secret(text) to authenticated;
grant execute on function public.delete_user_secret(text) to authenticated;
