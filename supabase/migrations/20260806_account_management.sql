-- Account management and strict per-user data isolation.
-- Apply this migration before deploying the matching application code.

create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  must_change_password boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  legacy_migrated_at timestamptz
);

insert into public.account_profiles (
  user_id,
  email,
  display_name,
  status,
  must_change_password,
  created_at,
  updated_at,
  last_login_at
)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'display_name', split_part(coalesce(email, ''), '@', 1)),
  case when banned_until is not null and banned_until > now() then 'disabled' else 'active' end,
  false,
  created_at,
  updated_at,
  last_sign_in_at
from auth.users
on conflict (user_id) do nothing;

create table if not exists public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  data_key text not null,
  data jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

create index if not exists user_data_user_updated_idx
  on public.user_data (user_id, updated_at desc);

alter table public.account_profiles enable row level security;
alter table public.user_data enable row level security;

revoke all on table public.account_profiles from anon, authenticated;
revoke all on table public.user_data from anon;
grant select on table public.account_profiles to authenticated;
grant select, insert, update, delete on table public.user_data to authenticated;

create or replace function public.account_is_active(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_profiles
    where user_id = p_user_id
      and p_user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.account_can_access_business_data(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_profiles
    where user_id = p_user_id
      and p_user_id = auth.uid()
      and status = 'active'
      and must_change_password = false
  );
$$;

revoke all on function public.account_is_active(uuid) from public;
revoke all on function public.account_can_access_business_data(uuid) from public;
grant execute on function public.account_is_active(uuid) to authenticated;
grant execute on function public.account_can_access_business_data(uuid) to authenticated;

drop policy if exists "Users read own account profile" on public.account_profiles;
create policy "Users read own account profile"
on public.account_profiles for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users manage own data" on public.user_data;
create policy "Users manage own data"
on public.user_data for all
to authenticated
using (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
);

drop policy if exists "Users manage own settings" on public.app_settings;
create policy "Users manage own settings"
on public.app_settings for all
to authenticated
using (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
);

drop policy if exists "Users manage own products" on public.products;
create policy "Users manage own products"
on public.products for all
to authenticated
using (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
);

drop policy if exists "Users manage own creator prospects" on public.creator_prospects;
create policy "Users manage own creator prospects"
on public.creator_prospects for all
to authenticated
using (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and public.account_can_access_business_data((select auth.uid()))
);

create or replace function public.set_user_secret(p_key text, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.account_can_access_business_data(auth.uid()) then
    raise exception 'Account cannot access business data';
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
  if auth.uid() is null or not public.account_can_access_business_data(auth.uid()) then
    raise exception 'Account cannot access business data';
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
  if auth.uid() is null or not public.account_can_access_business_data(auth.uid()) then
    raise exception 'Account cannot access business data';
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
