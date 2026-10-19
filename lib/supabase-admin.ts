// Supabase client with the secret key. ONLY used on the server
// (app/api routes): it bypasses the access rules, so it must never
// reach the browser. That's why its variable does NOT start with NEXT_PUBLIC_.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("The server is missing the SUPABASE_SECRET_KEY variable");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Returns the id of the user making the request (or null if they have no valid session).
// The browser sends its session token in the Authorization header.
export async function requestUser(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  return error ? null : (data.user?.id ?? null);
}
