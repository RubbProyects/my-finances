// The browser comes back here after granting the permission on the bank's website.
// It has no app session: the single-use "state" says whose permission it is.
import { callBank, type Session } from "@/lib/enable-banking";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const goBack = (outcome: string, reason?: string) =>
    Response.redirect(
      `${url.origin}/?bank=${outcome}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}`,
      303,
    );

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state) return goBack("error", "The return code is missing");

  const admin = supabaseAdmin();
  const { data: connection } = await admin
    .from("bank_connections")
    .select("id, user_id, bank")
    .eq("state", state)
    .eq("status", "pending")
    .maybeSingle();
  if (!connection)
    return goBack("error", "The link was already used or has expired. Connect again");

  try {
    if (!code) {
      const reason =
        url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "Cancelled";
      throw new Error(reason);
    }
    const session = await callBank<Session>("/sessions", { method: "POST", body: { code } });

    const { error } = await admin
      .from("bank_connections")
      .update({
        status: "active",
        state: null,
        session_id: session.session_id,
        valid_until: session.access?.valid_until ?? null,
        last_error: null,
      })
      .eq("id", connection.id);
    if (error) throw new Error(error.message);

    // The accounts: if they already existed (permission renewal), they move to this connection
    // and keep the app account they were assigned to
    const accounts = (session.accounts ?? []).map((a) => ({
      user_id: connection.user_id,
      connection_id: connection.id,
      uid: a.uid,
      fingerprint: a.identification_hash || a.uid,
      name: a.name ?? null,
      iban_last4: a.account_id?.iban ? a.account_id.iban.replace(/\s/g, "").slice(-4) : null,
      currency: a.currency ?? null,
    }));
    if (accounts.length > 0) {
      const { error: e2 } = await admin
        .from("bank_accounts")
        .upsert(accounts, { onConflict: "user_id,fingerprint" });
      if (e2) throw new Error(e2.message);
    }

    // Old connections of the same bank that were left without accounts are no longer needed
    const { data: oldConnections } = await admin
      .from("bank_connections")
      .select("id, accounts:bank_accounts(id)")
      .eq("user_id", connection.user_id)
      .eq("bank", connection.bank)
      .neq("id", connection.id);
    const empty = (oldConnections ?? [])
      .filter((c) => (c.accounts ?? []).length === 0)
      .map((c) => c.id);
    if (empty.length > 0) await admin.from("bank_connections").delete().in("id", empty);

    return goBack("ok");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await admin
      .from("bank_connections")
      .update({ status: "error", state: null, last_error: reason })
      .eq("id", connection.id);
    return goBack("error", reason);
  }
}
