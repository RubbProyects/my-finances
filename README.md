**English** · [Español](README.es.md)

# My Finances

A personal, mobile-first web app to follow **all your money in one place**: accounts, investments, spending, returns, taxes and future projections. Bank transactions arrive on their own thanks to European *open banking* rules (PSD2).

Built with **Next.js + Supabase + Vercel**, all on **free plans**. The app is bilingual (English and Spanish), with a language picker.

**👉 [Try the live demo](https://my-finances-demo.vercel.app/)**: one click, no sign-up, with fake data that starts over every night.

> A personal project built while learning to code. It is not financial advice: tax figures and projections are **estimates**.

## What it does

**📊 Summary**
- Net worth, the balance of each account and the value of your investments.
- A warning when the bank permission is about to expire.

**📈 Investments**
- Buys, sales, dividends and *splits* (units are recalculated automatically).
- **Fees calculated automatically** from each platform's fee schedule.
- **Fund switches** (a linked sale and buy, tax-free in Spain).
- **Automatic prices** every day: Yahoo Finance for ETFs, stocks and crypto, and the Financial Times for funds (by ISIN).
- How much each asset went up or down on its last day.

**💸 Transactions**
- Expenses, income, transfers and adjustments, with categories, Bizum and **refunds** (a Bizum paying you back part of a dinner is subtracted from that expense).
- **Bank connection** (read-only) through Enable Banking: transactions land in a "To review" inbox.
- **Rules:** recurring items (groceries, the gym…) are **recorded automatically** every night.
- Detection of **duplicates**, the other side of transfers between your own accounts, and **comparison with the bank balance**.

**🔍 Analysis**
- Capital **allocation** by type, platform, category or asset.
- **Returns** by period (from 1 day to "all"), using the Modified Dietz method so a new buy doesn't count as a gain.
- **🧾 Tax:** gains and losses per year with **FIFO**, fund switches that keep their cost, the 2-month rule warning and dividends (Spanish tax rules).
- **💸 Spending:** real spending, balance by category, the last 12 months and Bizum vs the rest.
- **🔮 Projection** of your portfolio with compound interest and monthly contributions.
- **🧮 Simulator** from scratch: several assets at once, an initial amount and weekly, monthly or yearly contributions.

**⚙️ Settings**
- Assets, platforms, asset types, categories, fee schedules, banks and language.

**And also**
- A **👁️/🙈 button to blur money** (to show the app without showing figures).
- **Installable on your phone** like an app.
- **Weekly backup** of the data and the database structure, with tested restore (in a separate private repository).

## How it works

```
Phone / browser ──► Vercel (Next.js) ──► Supabase (PostgreSQL + sign-in)
                        │
                        ├─► Yahoo Finance and Financial Times (prices)
                        └─► Enable Banking ──► your bank (PSD2, read-only)

Daily Vercel cron (21:00 UTC): prices ➜ bank transactions ➜ record with rules
Weekly GitHub Actions (optional): backup ➜ private repository
```

- **Data is fetched from the browser** straight from Supabase with the public key. Security comes from database rules (**RLS**): every row has an owner (`user_id`) and each user only sees their own.
- **Server routes** (`app/api/…`) use the Supabase secret key. They only exist for what the browser can't do: fetching prices, talking to the bank and the cron.
- **Account balances aren't stored: they're calculated** from the transactions (the `account_balances` view). To correct one, you create an "adjustment" transaction.
- **Email and password sign-in, with sign-ups disabled:** only someone with a user created by hand in Supabase can get in.
- **Calculations** (returns, tax, spending, projection, bank…) are pure functions in `lib/*.ts`, separate from the screens (`components/*.tsx`).
- No chart libraries: the charts are hand-made SVG.
- **Demo mode** (`NEXT_PUBLIC_DEMO=1`, see `lib/demo.ts`): the same code deployed a second time, with its own Supabase and fake data from `supabase/demo.sql`. It adds a "Try the demo" button, starts in English, has no real bank connection and the nightly cron puts the fake data back.

| Folder | What's in it |
| --- | --- |
| `app/` | Page, icon, manifest and server routes (`app/api/prices`, `cron`, `bank/…`) |
| `components/` | Each screen and section (Summary, Investments, Transactions, Analysis, Settings…) |
| `lib/` | Calculations and connections (Supabase, Yahoo, FT, Enable Banking) |
| `supabase/schema.sql` | The full database structure, for a new project |
| `supabase/demo.sql` | Fake data for the public demo (only for the demo's project) |
| `vercel.json` | The daily cron |

## Get your own: step-by-step setup

You need about **60–90 minutes** and free accounts on **GitHub**, **Supabase** and **Vercel**. To connect your bank, also on **Enable Banking** (optional). You don't need to install anything: everything is done from each service's website.

> ℹ️ The code is public but **not open source** (see [License](#license)). To set up your own copy, ask for permission first by opening an issue.

> ⚠️ **Never upload to GitHub or share** your secret keys or the Enable Banking `.pem` file. They only go in Vercel (and in your `.env.local` if you test on your computer, which Git already ignores).

### 1. Copy the code (GitHub)

1. Create an account on [github.com](https://github.com) if you don't have one.
2. On this page, click **Fork** → **Create fork**. You now have your own copy of the code.

### 2. Create the database (Supabase)

1. Create an account on [supabase.com](https://supabase.com) (you can sign in with GitHub).
2. **New project:**
   - name: anything you like (for example `my-finances`);
   - database password: the one Supabase generates (save it, even though the app doesn't use it);
   - region: one close to you;
   - plan: **Free**.
3. When it's ready, open **SQL Editor** → **New query**.
4. Open the [`supabase/schema.sql`](supabase/schema.sql) file in this repository, copy **all** of it and paste it.
5. Click **Run**. It must finish without errors. If the project already had tables, the script stops without touching anything: it's only for a **new, empty** project. It needs **PostgreSQL 17**, which is what new Supabase projects use. If you get `unrecognized privilege type "maintain"`, your project is on an older version: upgrade it in *Project Settings* → *Infrastructure*, or delete the word `maintain,` from the script.
6. **Disable sign-ups:** *Authentication* → sign-in settings → turn off **Allow new users to sign up**. That way nobody else can create an account in your app.
7. **Create your user:** *Authentication* → *Users* → **Add user** → **Create new user**, with your email and password and **Auto Confirm User** ticked.
8. Write down somewhere safe (not on GitHub) these three things:
   - **Project URL** (`https://xxxx.supabase.co`), in *Project Settings* → *Data API* or the **Connect** button;
   - **Publishable key** (`sb_publishable_…`), in *Project Settings* → *API Keys*;
   - **Secret key:** in *API Keys* → *Secret keys* → **New secret key**. Give it a name with `_` (Supabase doesn't allow `-`), for example `vercel_app`, and copy the `sb_secret_…` value. **It's secret.**

### 3. Publish the app (Vercel)

1. Create an account on [vercel.com](https://vercel.com) with your GitHub (the free **Hobby** plan, for personal use).
2. **Add New…** → **Project** → choose your fork → **Import**.
3. Under **Environment Variables**, add:

| Variable | Value | Type |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Project URL | Normal |
| `NEXT_PUBLIC_SUPABASE_KEY` | Your Publishable key | Normal |
| `SUPABASE_SECRET_KEY` | Your `sb_secret_…` Secret key | **Sensitive** |
| `CRON_SECRET` | A long made-up password (for example, 40 random letters and numbers) | **Sensitive** |

4. Click **Deploy**. When it's done you'll have an address like `https://your-project.vercel.app`. If you want to change it, do it now in *Settings* → *Domains*: Enable Banking needs the final address.
5. Open the address and sign in with the user from step 2.7.

The **daily cron** is enabled by `vercel.json` (you'll see it in *Settings* → *Cron Jobs*). Every night it updates prices and, if you have connected banks, fetches their transactions.

> Every time you change an environment variable: *Deployments* → the latest one → ⋯ → **Redeploy**.

### 4. Set up the app

Everything starts empty, except the **base asset types** (bank account, savings account, ETF, investment fund, stock, pension plan…), which the app creates on its own. Choose your language in **⚙️ Settings** → **🌐 Language**, and then, in this order:

1. **🏢 Platforms:** where your money is (your bank, your broker…).
2. **🧩 Asset types:** check the **annual %** of each type (it's used by the projection) and add your own if you need to. Each type is valued either:
   - **at market price** (price × units), like an ETF or a fund;
   - **by balance**, like an account.
3. **💼 Assets:**
   - **each account** (one asset of a "balance" type for every place where you keep cash);
   - **each investment**, with its price source:
     - **Yahoo**, with the symbol that trades in euros (the search helps you);
     - **Financial Times** by ISIN, for funds;
     - **manual**.
4. **💶 Fee schedules** for each platform.
5. **🛒 Expense categories.**
6. **Today's balance** of each account: create an **adjustment** transaction.
7. **Investments you already have:** record them as **buys** with their date, amount, units and fee.

### 5. Connect your bank (optional, Enable Banking)

[Enable Banking](https://enablebanking.com) has a free mode (**restricted production**) to connect **your own accounts**. It can only read: it can't move money.

1. Create an account on enablebanking.com.
2. In its control panel, register an application:
   - **Environment:** Production (restricted);
   - **Name:** anything you like;
   - **User type:** Personal;
   - **Redirect URL:** `https://your-project.vercel.app/api/bank/callback`, with your exact address. (`localhost` does **not** work: you always connect from the published app.)
3. A **`.pem`** file (your private key) will be downloaded. Keep it on your computer. **The file name, without `.pem`, is your application ID.**
4. In Vercel, add two variables and **Redeploy**:

| Variable | Value | Type |
| --- | --- | --- |
| `ENABLE_BANKING_APP_ID` | The `.pem` file name without the extension | Normal |
| `ENABLE_BANKING_KEY` | The full content of the `.pem` (open it with Notepad: `Ctrl+A`, `Ctrl+C`), including the `BEGIN` and `END` lines, without quotes | **Sensitive** |

5. In restricted mode, **each bank is first linked in the Enable Banking control panel** and then connected from the app.
6. In the app: **⚙️ Settings** → **🏦 Banks** → choose country and bank → **Connect** → authorize at your bank → you come back to the app.
7. **Assign** each bank account to its account in the app.
8. **💸 Transactions** → **📥 To review** → **Fetch**. The first time it downloads about 90 days. Classify, create rules for what repeats and use **⚖️ Compare with the bank balance** to reconcile.

Tips:

- The country must match your IBAN's.
- Revolut gives one account per currency; the app only reads euro accounts.
- The bank permission lasts at most 180 days: the app warns you beforehand, and you just connect it again.

### 6. Install it on your phone

- **iPhone:** open your address in **Safari** → Share button → **Add to Home Screen**.
- **Android:** **Chrome** → ⋮ menu → **Install app**.

### 7. Backup (optional)

The weekly backup runs on GitHub Actions in a **separate private repository**, with two secrets (`SUPABASE_URL` and a `SUPABASE_SECRET_KEY` of its own). It saves each table as JSON and the structure with the `public.schema_sql()` function, which already writes `schema.sql`. The scripts aren't in this repository because they live next to the data; if you're interested, open an *issue*.

### 8. Getting updates

1. If a new version comes with SQL (in `supabase/`), **run it first** in your SQL Editor.
2. In your fork, click **Sync fork** → **Update branch**. Vercel publishes the new version on its own.

## Run it on your computer (to change the code)

Requirements: **Git**, **Node.js 22** and an editor (VS Code).

```bash
git clone https://github.com/<your-user>/my-finances.git
cd my-finances
npm ci
```

Create a `.env.local` file in the root with the same variables as in Vercel. The Enable Banking key goes in double quotes, over several lines:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
CRON_SECRET=...
ENABLE_BANKING_APP_ID=...
ENABLE_BANKING_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

Then:

```bash
npm run dev
```

and open [http://localhost:3000](http://localhost:3000). The bank connection only works from the published app.

Checks before publishing a change: `npx eslint components lib app`, `npx tsc --noEmit -p .` and `npx next build`.

## Stack

- [Next.js 16](https://nextjs.org) (App Router) · React 19 · TypeScript · [Tailwind CSS 4](https://tailwindcss.com)
- [Supabase](https://supabase.com): PostgreSQL, sign-in and access rules (RLS)
- [Vercel](https://vercel.com): hosting and cron
- [Enable Banking](https://enablebanking.com): bank connection (PSD2). The token is signed with `node:crypto`, no libraries.
- Yahoo Finance and the Financial Times: prices

## Known limitations

- **Euros only.** Accounts and transactions in other currencies aren't read.
- **Prices** come from public Yahoo and Financial Times pages, with no official API: they may fail or change. Personal use only.
- **Free Enable Banking** works for your own accounts; some banks can't be linked.
- **Tax and projections are estimates** (and the tax section follows Spanish rules). Check them against your broker's report or an adviser.
- The free Vercel and Supabase plans are for personal, not commercial, use.

## License

Copyright © 2026 RubbProyects. **All rights reserved.** The code is published so you can read it and see how it's built, but it can't be copied, modified, distributed or used without written permission. To ask for it, open an issue. See [LICENSE](LICENSE).
