// Calls the app/api routes from the browser, sending the session token
import { language } from "@/lib/language";
import { translateMessage } from "@/lib/messages";
import { supabase } from "@/lib/supabase";

// "body" (optional) is sent as JSON
export async function callApi<T>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const r = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  // Server errors come in Spanish: they're translated if the app is in English
  if (!r.ok) throw new Error(translateMessage(json.error ?? `Error ${r.status}`, language()));
  return json as T;
}
