-- Phase v2-4: instant expense capture (iPhone shortcut) and its reconciliation with the bank.
-- Safe to run twice. It only ADDS things: nothing existing is changed or deleted.
-- Run it in the SQL Editor of BOTH Supabase projects (the real one and the demo one).
begin;

-- Two extra dates from the bank, only to measure how many days late the bank is
alter table public.bank_transactions add column if not exists value_date date;
alter table public.bank_transactions add column if not exists transaction_date date;

-- The secret the shortcut sends. Only a hash is stored: the token itself is shown once in the app.
create table if not exists public.capture_tokens (
  id uuid default gen_random_uuid() not null,
  token_hash text not null,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  user_id uuid default auth.uid() not null
);

-- Which app account each card of Apple Wallet belongs to
create table if not exists public.capture_cards (
  id uuid default gen_random_uuid() not null,
  card text not null,
  account_id uuid,
  created_at timestamp with time zone default now() not null,
  user_id uuid default auth.uid() not null
);

-- Every expense the shortcut sent, until the bank shows it
create table if not exists public.captures (
  id uuid default gen_random_uuid() not null,
  date date not null,
  amount numeric(12,2) not null,
  merchant text,
  card text,
  status text default 'open'::text not null,
  account_id uuid,
  movement_id uuid,
  bank_transaction_id uuid,
  created_at timestamp with time zone default now() not null,
  user_id uuid default auth.uid() not null
);

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'capture_tokens_pkey') then
    alter table public.capture_tokens add constraint capture_tokens_pkey PRIMARY KEY (id);
    alter table public.capture_tokens add constraint capture_tokens_token_hash_key UNIQUE (token_hash);
    alter table public.capture_tokens add constraint capture_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'capture_cards_pkey') then
    alter table public.capture_cards add constraint capture_cards_pkey PRIMARY KEY (id);
    alter table public.capture_cards add constraint capture_cards_user_card_key UNIQUE (user_id, card);
    alter table public.capture_cards add constraint capture_cards_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.assets(id) ON DELETE SET NULL;
    alter table public.capture_cards add constraint capture_cards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'captures_pkey') then
    alter table public.captures add constraint captures_pkey PRIMARY KEY (id);
    alter table public.captures add constraint captures_amount_check CHECK ((amount > (0)::numeric));
    alter table public.captures add constraint captures_status_check CHECK ((status = ANY (ARRAY['open'::text, 'matched'::text, 'unmapped'::text, 'foreign'::text])));
    alter table public.captures add constraint captures_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.assets(id) ON DELETE SET NULL;
    alter table public.captures add constraint captures_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES public.movements(id) ON DELETE SET NULL;
    alter table public.captures add constraint captures_bank_transaction_id_fkey FOREIGN KEY (bank_transaction_id) REFERENCES public.bank_transactions(id) ON DELETE SET NULL;
    alter table public.captures add constraint captures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  end if;
end $m$;

create index if not exists capture_tokens_user_id_idx on public.capture_tokens using btree (user_id);
create index if not exists capture_cards_user_id_idx on public.capture_cards using btree (user_id);
create index if not exists captures_user_id_idx on public.captures using btree (user_id);
create index if not exists captures_movement_id_idx on public.captures using btree (movement_id);

alter table public.capture_tokens enable row level security;
alter table public.capture_cards enable row level security;
alter table public.captures enable row level security;

drop policy if exists "own rows only" on public.capture_tokens;
create policy "own rows only" on public.capture_tokens as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists "own rows only" on public.capture_cards;
create policy "own rows only" on public.capture_cards as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists "own rows only" on public.captures;
create policy "own rows only" on public.captures as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

revoke all on table public.capture_tokens from public, anon, authenticated, service_role;
grant delete, insert, select, update on table public.capture_tokens to authenticated;
grant delete, insert, select, update on table public.capture_tokens to service_role;
revoke all on table public.capture_cards from public, anon, authenticated, service_role;
grant delete, insert, select, update on table public.capture_cards to authenticated;
grant delete, insert, select, update on table public.capture_cards to service_role;
revoke all on table public.captures from public, anon, authenticated, service_role;
grant delete, insert, select, update on table public.captures to authenticated;
grant delete, insert, select, update on table public.captures to service_role;

commit;

-- Check: it should return one row with 0 captures and rls = true for the three tables
select
  (select count(*) from public.captures) as captures,
  (select count(*) from public.capture_cards) as cards,
  (select count(*) from public.capture_tokens) as tokens,
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.captures'::regclass, 'public.capture_cards'::regclass, 'public.capture_tokens'::regclass)) as rls;
