// Receives an expense from the iPhone shortcut (Apple Pay "Transaction" automation) the moment
// it is paid. It is recorded in the app right away; when the bank shows it days later, it is
// paired with this one instead of being duplicated (see lib/capture-server.ts).
//
// The shortcut sends: Authorization: Bearer <token> and a JSON body:
//   { "merchant": "Mercadona", "amount": "12,50", "card": "Santander Debit", "currency": "EUR", "date": "2026-10-23" }
// "currency", "date" and "category" (the name of an expense category) are optional (the date
// defaults to today in Madrid). The answer has the capture "id" and, when it was recorded, the
// "categories" to choose from: the shortcut can ask which one and send it to /api/capture/category.
import { NOT_IN_DEMO, DEMO } from "@/lib/demo";
import { isEuro, normalizeCard, parseCaptureAmount } from "@/lib/captures";
import {
  accountForCard,
  categoryChoices,
  categoryIdByName,
  reconcileCaptures,
  recordCapture,
  userForToken,
  type CaptureRow,
} from "@/lib/capture-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const todayInMadrid = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) || null : null;

export async function POST(request: Request) {
  try {
    if (DEMO) return Response.json({ error: NOT_IN_DEMO }, { status: 403 });
    const admin = supabaseAdmin();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const userId = await userForToken(admin, token);
    if (!userId) return Response.json({ error: "Invalid token" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const amount = parseCaptureAmount(body?.amount);
    if (!body || amount === null) {
      return Response.json({ error: "The amount is missing or isn't a number" }, { status: 400 });
    }
    const merchant = text(body.merchant, 120);
    const card = text(body.card, 80) ?? "";
    const given = text(body.date, 10);
    const date = given && /^\d{4}-\d{2}-\d{2}$/.test(given) ? given : todayInMadrid();
    const euro = isEuro(body.currency);

    // The same payment sent twice within two minutes (the shortcut can retry) is saved once
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const cardValue = normalizeCard(card) ? card : null;
    const sameCard = admin
      .from("captures")
      .select("id, status")
      .eq("user_id", userId)
      .eq("amount", amount)
      .gte("created_at", since);
    const { data: repeated } = await (cardValue ? sameCard.eq("card", cardValue) : sameCard.is("card", null));
    const same = (repeated ?? []).find(Boolean);
    if (same) return Response.json({ ok: true, status: same.status, id: same.id, repeated: true });

    const accountId = euro ? await accountForCard(admin, userId, card) : null;
    const status = !euro ? "foreign" : accountId ? "open" : "unmapped";
    const { data: created, error } = await admin
      .from("captures")
      .insert({
        user_id: userId,
        date,
        amount,
        merchant,
        card: cardValue,
        status,
        account_id: accountId,
      })
      .select("id, date, amount, merchant, card, status, account_id, movement_id")
      .single();
    if (error || !created) {
      return Response.json({ error: error?.message ?? "Couldn't save" }, { status: 500 });
    }

    if (status === "open" && accountId) {
      const chosen = await categoryIdByName(admin, userId, text(body.category, 80) ?? "");
      const problem = await recordCapture(admin, userId, created as CaptureRow, accountId, chosen);
      if (problem) return Response.json({ error: problem }, { status: 500 });
      // The bank may already have shown it (a late shortcut)
      await reconcileCaptures(admin, userId).catch(() => null);
      return Response.json({
        ok: true,
        status,
        id: created.id,
        categories: await categoryChoices(admin, userId),
      });
    }
    return Response.json({ ok: true, status, id: created.id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
