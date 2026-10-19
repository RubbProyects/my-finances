// List of banks in a country that can be connected (to choose in Settings → Banks)
import { callBank, type Aspsp } from "@/lib/enable-banking";
import { requestUser } from "@/lib/supabase-admin";

export async function GET(request: Request) {
  try {
    if (!(await requestUser(request))) {
      return Response.json({ error: "Sign in again" }, { status: 401 });
    }
    const country = new URL(request.url).searchParams.get("country") ?? "ES";
    const r = await callBank<{ aspsps: Aspsp[] }>(
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
    );
    const banks = (r.aspsps ?? [])
      .map((a) => ({ name: a.name, beta: Boolean(a.beta) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return Response.json({ banks });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return Response.json({ error }, { status: 500 });
  }
}
