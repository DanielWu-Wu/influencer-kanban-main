begin;

-- Account management runs only on the server with SUPABASE_SECRET_KEY.
-- Keep browser roles restricted to their existing own-profile RLS policy,
-- while allowing the server to list, create, and update account metadata.
grant select, insert, update
on table public.account_profiles
to service_role;

commit;
