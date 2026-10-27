// Changes the category of an expense the iPhone shortcut just recorded. The shortcut asks which
// category after sending the payment (see /api/capture), so the payment is recorded even if the
// question is dismissed.
// It sends: Authorization: Bearer <token> and { "id": "<capture id>", "category": "Groceries" }.
// "⚡ Automática" (AUTO_CATEGORY, or a name that doesn't exist) keeps the category the rules chose.
import { DEMO, NOT_IN_DEMO } from "@/lib/demo";
import { categoryIdByName, userForToken } from "@/lib/capture-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  try {
    if (DEMO) return Response.json({ error: NOT_IN_DEMO }, { status: 403 });
    const admin = supabaseAdmin();
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const userId = await userForToken(admin, token);
    if (!userId) return Response.json({ error: "Invalid token" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const name = typeof body?.category === "string" ? body.category.trim().slice(0, 80) : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return Response.json({ error: "The capture id is missing" }, { status: 400 });
    }

    const { data: capture } = await admin
      .from("captures")
      .select("id, movement_id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!capture) return Response.json({ error: "Capture not found" }, { status: 404 });
    if (!capture.movement_id) {
      // A card without an account has no expense yet: it gets the rule's category when it is recorded
      return Response.json({ ok: true, category: null, note: "Not recorded yet" });
    }

    const categoryId = await categoryIdByName(admin, userId, name);
    if (!categoryId) return Response.json({ ok: true, category: null });

    const { error } = await admin
      .from("movements")
      .update({ category_id: categoryId })
      .eq("id", capture.movement_id)
      .eq("user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, category: name });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
