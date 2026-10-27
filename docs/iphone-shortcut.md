**English** · [Español](iphone-shortcut.es.md)

# Instant expense capture with an iPhone shortcut

Every time you pay with Apple Pay, your iPhone sends the payment to the app **at that moment**.
The app records the expense right away and the iPhone asks **which category** to file it under.
Days later, when the bank shows the same payment, the app pairs both and nothing is duplicated.

> Not available in the public demo. Requires iOS 17 or later. It only sees **Apple Pay** payments
> (tapping the phone or the watch): physical card, Bizum and transfers still come from the bank.

## 1. In the app

1. Open **Settings → ⚡ Instant capture (iPhone)**.
2. Tap **Create key** and copy the key (it starts with `mf_`). It is shown only once.
3. Copy the address under it (it ends in `/api/capture`). It must be the published app's, not a
   Vercel preview's.

## 2. Try it without paying (recommended)

1. In **Shortcuts**, create a new shortcut (**+**) with the action **Get Contents of URL**.
2. URL: the address you copied. Under **Show More**: Method **POST**.
3. **Headers:** `Authorization` = `Bearer ` (with a space) followed by your key, and `Content-Type` = `application/json`.
4. **Request Body: JSON**, with three Text fields: `merchant` = `Test`, `amount` = `1.00`, `card` = `Test card`.
5. Run it (▶). It should answer something like `{"ok":true,"status":"unmapped",...}`. In the app,
   under **Settings → ⚡ Instant capture**, the card and the test payment show up; remove it with ✕.

## 3. The Apple Pay automation

1. In **Shortcuts → Automation → +**, look for **Wallet** (on some iOS versions it is called
   **Transaction**). It is a **personal** automation.
2. Choose only your **payment cards**, tick **Run Immediately** and tap **Next**.
3. Tap **Create New Shortcut** and, on the **Shortcut Input**, set the **Type** to **Transaction**:
   that is what makes the **Amount** and **Merchant** variables available.
4. Add these **10 actions**, in this order (named variables avoid mix-ups):
   1. **Format Date**: Date = *Current Date*, Format = *Custom*, text `yyyy-MM-dd`.
   2. **Get Contents of URL** (as in the test above, with the address ending in `/api/capture`)
      and four Text fields: `merchant` = **Shortcut Input → Merchant**, `amount` = **Shortcut
      Input → Amount**, `card` = **Shortcut Input → Card or Pass**, `date` = **Formatted Date**
      (the result of action 1).
   3. **Set Variable** `response` = the **Contents of URL**.
   4. **Get Dictionary Value**: "Get Value for `categories` in `response`".
   5. **Set Variable** `list` = the result of action 4.
   6. **Choose from List**: put the variable `list` in the list slot; prompt: `Category`.
   7. **Set Variable** `category` = the **Chosen Item**.
   8. **Get Dictionary Value**: "Get Value for `id` in `response`".
   9. **Set Variable** `paymentid` = the result of action 8.
   10. **Get Contents of URL** to the **same address ending in `/api/capture/category`** (instead
       of `/api/capture`), Method **POST**, the same two headers, and JSON with two Text fields:
       `id` = the variable `paymentid` and `category` = the variable `category`.
   (If the list slot doesn't offer the result of action 4, the named variable `list` from
   action 5 solves it: named variables always show up.)
5. Tap **Done**.

The first option in the list is **⚡ Automática** (automatic): it keeps the category your bank
rules decide. After it come your expense categories, **the ones you use most first**. If you
close the list without choosing, the payment is **already recorded** with the automatic category:
nothing is lost.

## 4. The first payment

The first payment from each card arrives as "card needs an account" (and with no category list):
go to **Settings → ⚡ Instant capture → 2. Cards and accounts** and choose which app account the
card belongs to. Waiting payments are recorded at that moment, with the category your rules give.

## Without coverage

The Apple Pay payment works as usual, but the shortcut can't send it to the app and stops with an
error: **nothing is lost**, the payment will arrive when the bank brings it, in **To review**. If
it stops after the first request, the expense is already recorded with the automatic category.

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
- Apple's automation sometimes takes long or fails when the bank tells Wallet late (mostly on iOS
  18 and later). If that happens, the payment still arrives through the bank.
