// lib/userShows.ts
import { createClient } from "@supabase/supabase-js";
import { Database } from "./types";

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
  // 1. Add the show to user's list
  const { error: showError } = await supabase.from("user_shows").insert([
    {
      user_id: userId,
      show_id: showId,
      collection,
    },
  ]);

  if (showError) {
    console.error("❌ Error inserting into user_shows:", showError);
    throw showError;
  }

  // 2. Get all episodes for this show
  const { data: episodes, error: episodeFetchError } = await supabase
    .from("episodes")
    .select("id")
    .eq("show_id", showId);

  if (episodeFetchError) {
    console.error("❌ Error fetching episodes for show:", episodeFetchError);
    throw episodeFetchError;
  }

  if (!episodes || episodes.length === 0) {
    console.warn("⚠️ No episodes found for show:", showId);
    return;
  }

  // 3. Add blank user_episodes entries (unwatched)
  const userEpisodes = episodes.map((ep) => ({
    user_id: userId,
    show_id: showId,
    episode_id: ep.id,
    watched: false,
    watched_at: null,
  }));

  const { error: userEpisodeError } = await supabase
    .from("user_episodes")
    .insert(userEpisodes);

  if (userEpisodeError) {
    console.error("❌ Error inserting user_episodes:", userEpisodeError);
    throw userEpisodeError;
  }

  console.log(`✅ Added ${episodes.length} episodes for user ${userId}`);
}

export async function removeUserShow(userId: string, showId: string) {
  const { error } = await supabase
    .from("user_shows")
    .delete()
    .eq("user_id", userId)
    .eq("show_id", showId);

  if (error) throw error;

  // Optional: also delete from user_episodes
  await supabase
    .from("user_episodes")
    .delete()
    .eq("user_id", userId)
    .eq("show_id", showId);
}

export async function getUserShowsWithEpisodes(userId: string) {
  const { data, error } = await supabase
    .from("user_shows")
    .select(`
      *,
      shows (*),
      episodes: user_episodes (
        *,
        episodes (*)
      )
    `)
    .eq("user_id", userId);

  if (error) throw error;
  return data;
}