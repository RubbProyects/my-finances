-- Phase v2-2: favorites (the stars in Markets).
-- Safe to run twice. It only ADDS a table: nothing existing is touched.
-- Run it in the SQL Editor of BOTH Supabase projects (the real one and the demo one).
begin;

create table if not exists public.favorites (
  id uuid default gen_random_uuid() not null,
  symbol text not null,
  name text not null,
  source text default 'yahoo'::text not null,
  currency text,
  created_at timestamp with time zone default now() not null,
  user_id uuid default auth.uid() not null
);

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'favorites_pkey') then
    alter table public.favorites add constraint favorites_pkey PRIMARY KEY (id);
    alter table public.favorites add constraint favorites_user_symbol_key UNIQUE (user_id, symbol);
    alter table public.favorites add constraint favorites_source_check CHECK ((source = ANY (ARRAY['yahoo'::text, 'ft'::text])));
    alter table public.favorites add constraint favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
end $m$;

create index if not exists favorites_user_id_idx on public.favorites using btree (user_id);

alter table public.favorites enable row level security;
drop policy if exists "own rows only" on public.favorites;
create policy "own rows only" on public.favorites as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

revoke all on table public.favorites from public, anon, authenticated, service_role;
grant delete, insert, select, update on table public.favorites to authenticated;
grant delete, insert, select, update on table public.favorites to service_role;

commit;

-- Check: it should return one row with 0 (or your number of favorites) and rls = true
select count(*) as favorites, (select relrowsecurity from pg_class where oid = 'public.favorites'::regclass) as rls
from public.favorites;
