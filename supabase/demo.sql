-- Public demo of "My Finances": fake data for the demo user.
-- ⚠️ ONLY for the demo's Supabase project, never for your real one. If it finds any user other
-- than demo@example.com it stops without touching anything.
--
-- Run it in the SQL Editor after schema.sql, once the demo user exists (Authentication → Users →
-- Add user, with the email demo@example.com). It creates:
--   - protect_demo_user: nobody can change the demo user's email or password;
--   - reset_demo(): deletes the demo user's data and writes the fake data again: three years of
--     a typical person in Spain, with dates up to today. The demo's nightly cron calls it; it
--     also runs once at the end of this script.
-- It can be run again: it replaces the functions and resets the data.
begin;

do $g$ begin
  if not exists (select 1 from auth.users where email = 'demo@example.com') then
    raise exception 'Create the demo user first: Authentication → Users → Add user, with the email demo@example.com';
  end if;
  if exists (select 1 from auth.users where email is distinct from 'demo@example.com') then
    raise exception 'This project has other users: demo.sql is only for the demo project';
  end if;
end $g$;

-- ---------- The demo user can't be changed ----------
-- Everyone signs in with the same user: its email and password stay as they are
create or replace function public.protect_demo_user()
returns trigger
language plpgsql
set search_path = ''
as $f$
begin
  new.email := old.email;
  new.encrypted_password := old.encrypted_password;
  return new;
end;
$f$;
revoke all on function public.protect_demo_user() from public, anon, authenticated;

drop trigger if exists protect_demo_user on auth.users;
create trigger protect_demo_user
  before update on auth.users
  for each row
  when (old.email = 'demo@example.com')
  execute function public.protect_demo_user();

-- ---------- Helpers ----------
-- A number between 0 and 1 that is always the same for the same text (fake "random" data)
create or replace function public.demo_random(key text)
returns numeric
language sql
immutable
set search_path = ''
as $f$
  select (abs(hashtext(key)::bigint) % 100000) / 100000.0;
$f$;
revoke all on function public.demo_random(text) from public, anon, authenticated;

-- The same day, or the next Monday if it falls on a weekend
create or replace function public.demo_weekday(d date)
returns date
language sql
immutable
set search_path = ''
as $f$
  select d + case extract(isodow from d) when 6 then 2 when 7 then 1 else 0 end;
$f$;
revoke all on function public.demo_weekday(date) from public, anon, authenticated;

-- An asset's price on a day (the last one on or before it)
create or replace function public.demo_price(asset uuid, d date)
returns numeric
language sql
stable
set search_path = ''
as $f$
  select price from public.prices where asset_id = asset and date <= d order by date desc limit 1;
$f$;
revoke all on function public.demo_price(uuid, date) from public, anon, authenticated;

-- An asset's units on a day (before that day's activity)
create or replace function public.demo_units(asset uuid, d date)
returns numeric
language sql
stable
set search_path = ''
as $f$
  select coalesce(sum(case type when 'buy' then units when 'sell' then -units else 0 end), 0)
  from public.transactions where asset_id = asset and date < d;
$f$;
revoke all on function public.demo_units(uuid, date) from public, anon, authenticated;

-- ---------- reset_demo() ----------
create or replace function public.reset_demo()
returns void
language plpgsql
security definer
set search_path = ''
as $f$
declare
  u uuid;
  today date := current_date;
  start date := (date_trunc('month', current_date) - interval '3 years')::date;
  last_quiet date := current_date - 5; -- after this, the day-to-day spending is in "To review"
  t_bank uuid; t_savings uuid; t_deposit uuid; t_etf uuid; t_fund uuid; t_stock uuid; t_crypto uuid;
  p_bank uuid; p_mi uuid; p_tr uuid;
  c_cash uuid; c_equity uuid; c_bonds uuid; c_crypto uuid;
  e_home uuid; e_groceries uuid; e_eating uuid; e_transport uuid; e_bills uuid; e_subs uuid;
  e_shopping uuid; e_travel uuid; e_health uuid; e_gifts uuid;
  a_main uuid; a_savings uuid; a_deposit uuid; a_vwce uuid; a_world uuid; a_bonds uuid;
  a_ibe uuid; a_asml uuid; a_btc uuid;
  b_conn uuid; b_account uuid;
  m date; d date; px numeric; n int; v uuid; amt numeric;
begin
  select id into u from auth.users where email = 'demo@example.com';
  if u is null or exists (select 1 from auth.users where email is distinct from 'demo@example.com') then
    raise exception 'reset_demo() only runs in the demo project (its only user is demo@example.com)';
  end if;

  -- The last real price of each asset (the cron fetches them every night): the fake history
  -- ends on that day and at that price, and the cron adds the real ones from there
  create temp table demo_anchor on commit drop as
    select coalesce(a.ticker, a.isin) as code, lp.date, lp.price
    from public.assets a join public.latest_prices lp on lp.asset_id = a.id
    where a.user_id = u;

  -- ---------- 1. Delete everything (children first) ----------
  -- What visitors can create in the redesign (v2): favorites, and the instant-capture tables
  delete from public.captures where user_id = u;
  delete from public.capture_cards where user_id = u;
  delete from public.capture_tokens where user_id = u;
  delete from public.favorites where user_id = u;
  delete from public.bank_transactions where user_id = u;
  delete from public.bank_rules where user_id = u;
  delete from public.bank_accounts where user_id = u;
  delete from public.bank_connections where user_id = u;
  delete from public.transactions where user_id = u;
  delete from public.movements where user_id = u;
  delete from public.fee_schedules where user_id = u;
  delete from public.assets where user_id = u; -- and their prices
  delete from public.platforms where user_id = u;
  delete from public.categories where user_id = u;
  delete from public.expense_categories where user_id = u;
  delete from public.asset_types where user_id = u;

  -- ---------- 2. Types, platforms and categories ----------
  -- The 11 base types (as lib/asset-types.ts creates them)
  insert into public.asset_types (user_id, base_key, name, valuation, identifier, has_maturity, annual_return)
  values
    (u, 'bank_account', 'Cuenta bancaria', 'balance', 'none', false, 0),
    (u, 'savings_account', 'Cuenta remunerada', 'balance', 'none', false, 2),
    (u, 'term_deposit', 'Depósito', 'balance', 'none', true, 2.5),
    (u, 'treasury_bills', 'Letras del Tesoro', 'balance', 'none', true, 2.5),
    (u, 'etf', 'ETF', 'market', 'isin', false, 7),
    (u, 'fund', 'Fondo de inversión', 'market', 'isin', false, 7),
    (u, 'stock', 'Acción', 'market', 'isin', false, 7),
    (u, 'bond', 'Bono / Renta fija', 'market', 'isin', false, 3),
    (u, 'crypto', 'Crypto', 'market', 'symbol', false, 0),
    (u, 'pension_plan', 'Plan de pensiones', 'market', 'none', false, 5),
    (u, 'other', 'Otro', 'balance', 'none', false, 0);
  select id into t_bank from public.asset_types where user_id = u and base_key = 'bank_account';
  select id into t_savings from public.asset_types where user_id = u and base_key = 'savings_account';
  select id into t_deposit from public.asset_types where user_id = u and base_key = 'term_deposit';
  select id into t_etf from public.asset_types where user_id = u and base_key = 'etf';
  select id into t_fund from public.asset_types where user_id = u and base_key = 'fund';
  select id into t_stock from public.asset_types where user_id = u and base_key = 'stock';
  select id into t_crypto from public.asset_types where user_id = u and base_key = 'crypto';

  insert into public.platforms (user_id, name) values (u, 'Everyday Bank') returning id into p_bank;
  insert into public.platforms (user_id, name) values (u, 'MyInvestor') returning id into p_mi;
  insert into public.platforms (user_id, name) values (u, 'Trade Republic') returning id into p_tr;

  insert into public.categories (user_id, name) values (u, 'Cash') returning id into c_cash;
  insert into public.categories (user_id, name) values (u, 'Equity') returning id into c_equity;
  insert into public.categories (user_id, name) values (u, 'Bonds') returning id into c_bonds;
  insert into public.categories (user_id, name) values (u, 'Crypto') returning id into c_crypto;

  insert into public.expense_categories (user_id, name) values (u, 'Home') returning id into e_home;
  insert into public.expense_categories (user_id, name) values (u, 'Groceries') returning id into e_groceries;
  insert into public.expense_categories (user_id, name) values (u, 'Eating out') returning id into e_eating;
  insert into public.expense_categories (user_id, name) values (u, 'Transport') returning id into e_transport;
  insert into public.expense_categories (user_id, name) values (u, 'Bills') returning id into e_bills;
  insert into public.expense_categories (user_id, name) values (u, 'Subscriptions') returning id into e_subs;
  insert into public.expense_categories (user_id, name) values (u, 'Shopping') returning id into e_shopping;
  insert into public.expense_categories (user_id, name) values (u, 'Travel') returning id into e_travel;
  insert into public.expense_categories (user_id, name) values (u, 'Health & sport') returning id into e_health;
  insert into public.expense_categories (user_id, name) values (u, 'Gifts') returning id into e_gifts;

  -- Fees: €1 per stock or crypto order at Trade Republic; ETFs and funds for free
  insert into public.fee_schedules (user_id, platform_id, type_id, valid_from, fixed)
  values (u, p_tr, t_stock, start, 1), (u, p_tr, t_crypto, start, 1);

  -- ---------- 3. Assets ----------
  insert into public.assets (user_id, name, type_id, platform_id, category_id, price_source)
  values (u, 'Everyday account', t_bank, p_bank, c_cash, 'manual') returning id into a_main;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, price_source, monthly_contribution)
  values (u, 'Savings account', t_savings, p_tr, c_cash, 'manual', 200) returning id into a_savings;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, price_source, annual_return, maturity_date)
  values (u, '12-month deposit', t_deposit, p_mi, c_cash, 'manual', 2.6, today + 165) returning id into a_deposit;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, ticker, isin, price_source, monthly_contribution)
  values (u, 'Vanguard FTSE All-World (Acc)', t_etf, p_tr, c_equity, 'VWCE.DE', 'IE00BK5BQT80', 'yahoo', 300)
  returning id into a_vwce;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, isin, price_source, monthly_contribution)
  values (u, 'Vanguard Global Stock Index', t_fund, p_mi, c_equity, 'IE00B03HCZ61', 'ft', 200)
  returning id into a_world;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, isin, price_source, monthly_contribution)
  values (u, 'Vanguard Global Bond Index (EUR hedged)', t_fund, p_mi, c_bonds, 'IE00B18GC888', 'ft', 50)
  returning id into a_bonds;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, ticker, isin, price_source)
  values (u, 'Iberdrola', t_stock, p_tr, c_equity, 'IBE.MC', 'ES0144580Y14', 'yahoo') returning id into a_ibe;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, ticker, isin, price_source)
  values (u, 'ASML', t_stock, p_tr, c_equity, 'ASML.AS', 'NL0010273215', 'yahoo') returning id into a_asml;
  insert into public.assets (user_id, name, type_id, platform_id, category_id, ticker, price_source)
  values (u, 'Bitcoin', t_crypto, p_tr, c_crypto, 'BTC-EUR', 'yahoo') returning id into a_btc;

  -- ---------- 3b. Favorites (the stars in Markets): so the tab isn't empty ----------
  insert into public.favorites (user_id, symbol, name, source, currency) values
    (u, 'VWCE.DE', 'Vanguard FTSE All-World UCITS ETF', 'yahoo', 'EUR'),
    (u, 'ASML.AS', 'ASML Holding', 'yahoo', 'EUR'),
    (u, 'BTC-EUR', 'Bitcoin EUR', 'yahoo', 'EUR'),
    (u, 'IE00B03HCZ61:EUR', 'Vanguard Global Stock Index Fund EUR', 'ft', 'EUR');

  -- ---------- 4. Price history (weekdays) ----------
  -- A smooth made-up curve that ends at the last real price: yearly trend + waves + noise.
  -- The first time there's no real price yet: it ends a week ago at an approximate price
  -- (October 2026), and the cron (or "Update prices") brings the real ones of the last days.
  insert into public.prices (asset_id, date, price)
  select p.asset_id, g.day::date,
    round(e.price * exp(
      -p.trend * (e.date - g.day::date) / 365.0
      + p.wave * (sin((e.date - g.day::date) / 40.0 + p.seed) - sin(p.seed))
      + p.wave / 2 * (sin((e.date - g.day::date) / 9.0 + 2 * p.seed) - sin(2 * p.seed))
      + case when g.day::date = e.date then 0
          else p.wave / 5 * (public.demo_random(p.seed::text || g.day::text) - 0.5) end
    )::numeric, 4)
  from (values
      (a_vwce, 'VWCE.DE', 170, 0.09, 0.05, 1.0),
      (a_world, 'IE00B03HCZ61', 64, 0.09, 0.05, 2.0),
      (a_bonds, 'IE00B18GC888', 98, 0.02, 0.015, 3.0),
      (a_ibe, 'IBE.MC', 21, 0.12, 0.06, 4.0),
      (a_asml, 'ASML.AS', 1500, 0.10, 0.12, 5.0),
      (a_btc, 'BTC-EUR', 73000, 0.35, 0.18, 6.0)
    ) as p(asset_id, code, first_price, trend, wave, seed)
  left join demo_anchor an on an.code = p.code
  -- e = where the curve ends: the last real price, or the first time a week ago
  cross join lateral (
    select coalesce(an.date, today - 7 - case extract(isodow from today - 7) when 6 then 1 when 7 then 2 else 0 end) as date,
      coalesce(an.price, p.first_price) as price
  ) e
  cross join generate_series(start, e.date, interval '1 day') as g(day)
  where extract(isodow from g.day) < 6;

  -- ---------- 5. Money in the accounts ----------
  insert into public.movements (user_id, date, type, amount, account_id, description) values
    (u, start, 'adjustment', 6500, a_main, 'Opening balance'),
    (u, start, 'adjustment', 5000, a_savings, 'Opening balance');

  for m in select generate_series(start, today, interval '1 month')::date loop
    n := (extract(year from age(m, start)) * 12 + extract(month from age(m, start)))::int;
    -- Monthly: salary, extra pay (June and December), rent, bills, subscriptions, transport
    insert into public.movements (user_id, date, type, amount, account_id, category_id, description)
    select u, x.day, x.type, x.amount, a_main, x.category, x.description
    from (values
        (m + 27, 'income', 2650 + 50 * (n / 12), null::uuid, 'Salary · Acme Iberia'),
        (m + 19, 'income', case when extract(month from m) in (6, 12) then 2650 + 50 * (n / 12) end, null, 'Extra pay'),
        (m, 'expense', 875 + 25 * (n / 12), e_home, 'Rent'),
        (m + 9, 'expense', round(48 + 40 * public.demo_random('power' || m), 2), e_bills, 'Electricity'),
        (m + 14, 'expense', 35, e_bills, 'Fibre & mobile'),
        (m + 1, 'expense', 39.90, e_health, 'Gym'),
        (m + 2, 'expense', 12.99, e_subs, 'Netflix'),
        (m + 6, 'expense', 10.99, e_subs, 'Spotify'),
        (m, 'expense', 20, e_transport, 'Metro pass')
      ) as x(day, type, amount, category, description)
    where x.amount is not null and x.day <= today;

    -- Every month: €200 to the savings account, and its interest
    if m + 27 <= today then
      insert into public.movements (user_id, date, type, amount, account_id, target_account_id, description)
      values (u, m + 27, 'transfer', 200, a_main, a_savings, 'To savings');
    end if;
    if m > start then
      insert into public.movements (user_id, date, type, amount, account_id, description)
      values (u, m, 'income', round(8 + 0.4 * n, 2), a_savings, 'Interest');
    end if;

    -- A dinner every three months, and a friend's Bizum pays back part of it
    if n % 3 = 1 and m + 12 <= last_quiet then
      insert into public.movements (user_id, date, type, amount, account_id, category_id, description)
      values (u, m + 12, 'expense', 96, a_main, e_eating, 'Dinner with friends') returning id into v;
      insert into public.movements (user_id, date, type, amount, account_id, category_id, bizum, description, refund_of_id)
      values (u, m + 13, 'income', 32, a_main, e_eating, true, 'Bizum from Laura', v);
    end if;
  end loop;

  -- Day to day: groceries on Saturdays, eating out, shopping, petrol, pharmacy
  insert into public.movements (user_id, date, type, amount, account_id, category_id, description)
  select u, g.day::date, 'expense', x.amount, a_main, x.category, x.description
  from generate_series(start, last_quiet, interval '1 day') as g(day)
  cross join lateral (values
      (case when extract(isodow from g.day) = 6 then round(45 + 70 * public.demo_random('food' || g.day), 2) end,
       e_groceries, case when public.demo_random('shop' || g.day) < 0.6 then 'Mercadona' else 'Lidl' end),
      (case when public.demo_random('eat' || g.day) < 0.1 then round(14 + 40 * public.demo_random('eat2' || g.day), 2) end,
       e_eating, 'Restaurant'),
      (case when public.demo_random('buy' || g.day) < 0.05 then round(15 + 100 * public.demo_random('buy2' || g.day), 2) end,
       e_shopping, case when public.demo_random('buy3' || g.day) < 0.5 then 'Amazon' else 'Zara' end),
      (case when public.demo_random('fuel' || g.day) < 0.04 then round(40 + 25 * public.demo_random('fuel2' || g.day), 2) end,
       e_transport, 'Petrol'),
      (case when public.demo_random('farm' || g.day) < 0.015 then round(9 + 40 * public.demo_random('farm2' || g.day), 2) end,
       e_health, 'Pharmacy')
    ) as x(amount, category, description)
  where x.amount is not null;

  -- Trips and gifts every year
  insert into public.movements (user_id, date, type, amount, account_id, category_id, description)
  select u, x.day, 'expense', x.amount, a_main, x.category, x.description
  from generate_series(extract(year from start)::int, extract(year from today)::int) as y(year)
  cross join lateral (values
      (make_date(y.year, 4, 18), 280, e_travel, 'Weekend in Lisbon'),
      (make_date(y.year, 7, 20), 690, e_travel, 'Summer holidays'),
      (make_date(y.year, 12, 18), 210, e_gifts, 'Christmas presents')
    ) as x(day, amount, category, description)
  where x.day between start and last_quiet;

  -- The deposit: €6,000 moved from the account seven months ago
  insert into public.movements (user_id, date, type, amount, account_id, target_account_id, description)
  values (u, today - 200, 'transfer', 6000, a_main, a_deposit, '12-month deposit at 2.6%');

  -- ---------- 6. Investments ----------
  -- Monthly plans on the 5th (or the next weekday)
  for m in select generate_series(start, today, interval '1 month')::date loop
    d := public.demo_weekday(m + 4);
    continue when d > today;
    insert into public.transactions (user_id, asset_id, date, type, amount, price, units, account_id)
    select u, x.asset, d, 'buy', x.amount, public.demo_price(x.asset, d),
      round(x.amount / public.demo_price(x.asset, d), 6), a_main
    from (values (a_vwce, 300::numeric), (a_world, 200), (a_bonds, 50)) as x(asset, amount);
  end loop;

  -- One-off buys of stocks and bitcoin (€1 fee)
  insert into public.transactions (user_id, asset_id, date, type, amount, fee, price, units, account_id)
  select u, x.asset, d2.day, 'buy', round(x.units * public.demo_price(x.asset, d2.day), 2), 1,
    public.demo_price(x.asset, d2.day), x.units, a_main
  from (values
      (a_ibe, 20, 90::numeric), (a_ibe, 400, 60), (a_ibe, 800, 45),
      (a_asml, 60, 2), (a_asml, 520, 1),
      (a_btc, 100, 0.012), (a_btc, 500, 0.005)
    ) as x(asset, after_days, units)
  cross join lateral (select public.demo_weekday(start + x.after_days) as day) d2
  where d2.day <= today;

  -- A year ago, half of the ASML shares were sold (for the tax section)
  d := public.demo_weekday(today - 380);
  if d > start + 60 then
    px := public.demo_price(a_asml, d);
    insert into public.transactions (user_id, asset_id, date, type, amount, fee, price, units, account_id)
    values (u, a_asml, d, 'sell', round(1.5 * px, 2), 1, px, 1.5, a_main);
  end if;

  -- Dividends: Iberdrola in January and July, ASML every quarter (19% withheld)
  for d in
    select public.demo_weekday(make_date(y.year, mo.month, 28))
    from generate_series(extract(year from start)::int, extract(year from today)::int) y(year)
    cross join (values (1), (7)) mo(month)
  loop
    px := public.demo_units(a_ibe, d);
    continue when d > today or px = 0;
    amt := round(px * 0.23, 2);
    insert into public.transactions (user_id, asset_id, date, type, amount, withholding, account_id)
    values (u, a_ibe, d, 'dividend', amt, round(amt * 0.19, 2), a_main);
  end loop;
  for d in
    select public.demo_weekday(make_date(y.year, mo.month, 10))
    from generate_series(extract(year from start)::int, extract(year from today)::int) y(year)
    cross join (values (2), (5), (8), (11)) mo(month)
  loop
    px := public.demo_units(a_asml, d);
    continue when d > today or px = 0;
    amt := round(px * 1.6, 2);
    insert into public.transactions (user_id, asset_id, date, type, amount, withholding, account_id)
    values (u, a_asml, d, 'dividend', amt, round(amt * 0.19, 2), a_main);
  end loop;

  -- A fund switch (tax-free in Spain): €3,000 from the stock fund to the bond fund
  d := public.demo_weekday(today - 150);
  v := gen_random_uuid();
  insert into public.transactions (user_id, asset_id, date, type, amount, price, units, switch_id, notes)
  values
    (u, a_world, d, 'sell', 3000, public.demo_price(a_world, d), round(3000 / public.demo_price(a_world, d), 6), v,
     'Rebalancing'),
    (u, a_bonds, d, 'buy', 3000, public.demo_price(a_bonds, d), round(3000 / public.demo_price(a_bonds, d), 6), v,
     'Rebalancing');

  -- ---------- 7. The bank (fake): a connection, its account, rules and "To review" ----------
  insert into public.bank_connections (user_id, bank, status, valid_until, last_fetch_at)
  values (u, 'Everyday Bank', 'active', now() + interval '120 days', now() - interval '2 hours')
  returning id into b_conn;
  insert into public.bank_accounts (user_id, connection_id, uid, fingerprint, name, iban_last4, currency, account_id)
  values (u, b_conn, 'demo-account', 'demo-account', 'Everyday account', '4821', 'EUR', a_main)
  returning id into b_account;

  insert into public.bank_rules (user_id, text, category_id, description) values
    (u, 'mercadona', e_groceries, 'Mercadona'),
    (u, 'netflix', e_subs, 'Netflix');

  -- What has just come from the bank and isn't recorded yet
  insert into public.bank_transactions (user_id, bank_account_id, bank_ref, date, amount, description, counterparty)
  values
    (u, b_account, 'demo-1', today - 1, -38.45, 'MERCADONA VALENCIA', 'Mercadona SA'),
    (u, b_account, 'demo-2', today - 1, -14.20, 'UBER *TRIP HELP.UBER.COM', 'Uber'),
    (u, b_account, 'demo-3', today - 2, 18.00, 'BIZUM DE LAURA G. Cine', 'Laura G.'),
    (u, b_account, 'demo-4', today - 2, -27.99, 'AMAZON EU SARL', 'Amazon'),
    (u, b_account, 'demo-5', today - 3, -52.10, 'REPSOL E.S. AV. CORTES', 'Repsol'),
    (u, b_account, 'demo-6', today - 4, -64.30, 'LIDL SUPERMERCADOS', 'Lidl');
  -- ...and one that was also typed by hand: the app suggests it's the same one
  insert into public.movements (user_id, date, type, amount, account_id, category_id, description)
  values (u, today - 4, 'expense', 64.30, a_main, e_groceries, 'Lidl');
end;
$f$;
revoke all on function public.reset_demo() from public, anon, authenticated;
grant execute on function public.reset_demo() to service_role;

select public.reset_demo();

commit;

-- Check: rows of the demo user per table
select 'assets' as "table", count(*) from public.assets
union all select 'prices', count(*) from public.prices
union all select 'transactions', count(*) from public.transactions
union all select 'movements', count(*) from public.movements
union all select 'bank_transactions', count(*) from public.bank_transactions;
