// lib/shows.ts
import { createClient } from "@supabase/supabase-js";
import { Database } from "../lib/types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function getAllShows() {
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .order("title");
  if (error) throw error;
  return data;
}

export async function getShowBySlug(slug: string) {
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
}

export async function searchShows(query: string) {
  const { data, error } = await supabase
    .from("shows")
    .select("*")
    .ilike("title", `%${query}%`)
    .limit(10);
  if (error) throw error;
  return data;
}