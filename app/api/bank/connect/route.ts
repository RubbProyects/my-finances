// "Connect bank": prepares the permission and returns the address of the bank's website
import { randomUUID } from "node:crypto";
import { permissionUntil } from "@/lib/bank";
import { callBank, type Aspsp } from "@/lib/enable-banking";
import { supabaseAdmin, requestUser } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    const userId = await requestUser(request);
    if (!userId) return Response.json({ error: "Sign in again" }, { status: 401 });

    const { bank, country = "ES" } = (await request.json().catch(() => ({}))) as {
      bank?: string;
      country?: string;
    };
    const { aspsps } = await callBank<{ aspsps: Aspsp[] }>(
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
    );
    const aspsp = (aspsps ?? []).find((a) => a.name === bank);
    if (!aspsp) return Response.json({ error: "Choose a bank from the list" }, { status: 400 });

    // The "state" is a single-use code: when coming back from the bank it says whose permission it is
    const admin = supabaseAdmin();
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    await admin
      .from("bank_connections")
      .delete()
      .eq("user_id", userId)
      .in("status", ["pending", "error"])
      .lt("created_at", oneHourAgo);
    const state = randomUUID();
    const { error } = await admin
      .from("bank_connections")
      .insert({ user_id: userId, bank: aspsp.name, country: aspsp.country, state });
    if (error) throw new Error(error.message);

    const { url } = await callBank<{ url: string }>("/auth", {
      method: "POST",
      body: {
        access: { valid_until: permissionUntil(aspsp.maximum_consent_validity, new Date()) },
        aspsp: { name: aspsp.name, country: aspsp.country },
        state,
        redirect_url: `${new URL(request.url).origin}/api/bank/callback`,
        psu_type: "personal",
      },
    });
    return Response.json({ url });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
