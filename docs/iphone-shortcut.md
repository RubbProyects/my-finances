**English** · [Español](iphone-shortcut.es.md)

# Instant expense capture with an iPhone shortcut

Every time you pay with Apple Pay, your iPhone sends the payment to the app **at that moment**.
The app records the expense right away. Days later, when the bank shows the same payment, the
app pairs both and nothing is duplicated.

> Not available in the public demo. Requires iOS 17 or later. It only sees **Apple Pay** payments
> (tapping the phone or the watch): physical card, Bizum and transfers still come from the bank.

## 1. In the app

1. Open **Settings → ⚡ Instant capture (iPhone)**.
2. Tap **Create key** and copy the key (it starts with `mf_`). It is shown only once.
3. Copy the address under it (it ends in `/api/capture`).

## 2. In the Shortcuts app on the iPhone

1. Open **Shortcuts → Automation → + → Transaction** (in some versions it is called **Wallet**).
2. Choose the cards you want and set **Run Immediately**. Tap **Next**.
3. Add the action **Format Date**: Date = *Current Date*, Date Format = *Custom*, format string `yyyy-MM-dd`.
4. Add the action **Get Contents of URL** and set:
   - **URL:** the address you copied.
   - **Method:** POST.
   - **Headers:** `Authorization` = `Bearer ` followed by your key (with a space after Bearer), and `Content-Type` = `application/json`.
   - **Request Body:** JSON, with these fields (Text type):
     - `merchant` = the *Merchant* of the **Shortcut Input**
     - `amount` = the *Amount* of the **Shortcut Input**
     - `card` = the *Card or Pass* of the **Shortcut Input**
     - `date` = the result of **Format Date**
5. Tap **Done**.

## 3. First payment

The first payment from each card arrives as "card needs an account": go to **Settings → ⚡ Instant
capture → 2. Cards and accounts** and choose which app account the card belongs to. Waiting
payments are recorded at that moment.

## How it avoids duplicates

When the bank movement arrives, it is paired with a captured expense of the **same account and the
same amount, to the cent**, whose date is from 1 day before to 7 days after the day you paid. If
several fit, the one whose merchant text looks alike goes first, then the closest in time. Section
**3. Latest payments received** shows how many days your bank usually takes.

## What still needs you

- Payments in another currency (the shortcut sees dollars, the bank euros) and tips added after
  paying: they stay unpaired and you link them by hand from the bank inbox.
- A declined payment can still trigger the shortcut: after 10 days it shows as "the bank doesn't
  show it"; remove it with ✕.
