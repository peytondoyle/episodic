// lib/userShows.ts
import { createClient } from "@supabase/supabase-js";
import { Database } from "../lib/types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function getUserShows(userId: string) {
  const { data, error } = await supabase
    .from("user_shows")
    .select("*, shows(*)")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function getUserShow(userId: string, showId: string) {
  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
    .eq("user_id", userId)
    .eq("show_id", showId)
    .single();

  if (error) throw error;
  return data;
}

export async function addUserShow(userId: string, showId: string, collection: string = "watchlist") {
  const { data, error } = await supabase.from("user_shows").insert([
    {
      user_id: userId,
      show_id: showId,
      collection,
    },
  ]);

  if (error) throw error;
  return data;
}

export async function removeUserShow(userId: string, showId: string) {
  const { error } = await supabase
    .from("user_shows")
    .delete()
    .eq("user_id", userId)
    .eq("show_id", showId);

  if (error) throw error;
}