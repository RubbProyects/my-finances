// Favorites: the assets pinned in Markets. They live in the database so they show up on every device.
import { supabase } from "@/lib/supabase";

export type Favorite = {
  id: string;
  symbol: string;
  name: string;
  source: "yahoo" | "ft";
  currency: string | null;
};

export async function fetchFavorites(): Promise<{ favorites: Favorite[]; error: string }> {
  const { data, error } = await supabase
    .from("favorites")
    .select("id, symbol, name, source, currency")
    .order("created_at");
  return { favorites: (data ?? []) as Favorite[], error: error ? error.message : "" };
}

export async function addFavorite(f: Omit<Favorite, "id">): Promise<string> {
  const { error } = await supabase.from("favorites").upsert(f, { onConflict: "user_id,symbol" });
  return error ? error.message : "";
}

export async function removeFavorite(symbol: string): Promise<string> {
  const { error } = await supabase.from("favorites").delete().eq("symbol", symbol);
  return error ? error.message : "";
}
