import { createClient } from "@supabase/supabase-js";
import { Database } from "./types";
import slugify from "slugify";
import { fetchAllEpisodesFromTMDB, TMDBEpisode } from "./tmdb";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type TMDBShow = {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  first_air_date: string;
  status?: string | null;
  homepage?: string | null;
};

export async function insertShowFromTMDB(show: TMDBShow) {
  const allowedStatuses = ["airing", "canceled", "coming_soon", "ended"];

  const normalizeStatus = (rawStatus: string | undefined | null): string | null => {
    if (!rawStatus) return null;
    const formatted = rawStatus.trim().toLowerCase().replace(/\s+/g, "_");
    return allowedStatuses.includes(formatted) ? formatted : null;
  };

  const slug = slugify(show.name, { lower: true });
  const normalizedStatus = normalizeStatus(show.status);

  const showId = crypto.randomUUID();

  const payload = {
    id: showId,
    title: show.name,
    slug,
    poster_url: show.poster_path?.startsWith("/")
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : null,
    status: normalizedStatus,
    platform: show.homepage || null,
    synopsis: show.overview || null,
    updated_at: new Date().toISOString(),
    tmdb_id: typeof show.id === "number" ? show.id.toString() : null,
  };

  const { error } = await supabase.from("shows").insert([payload]);

  if (error) {
    console.error("🔥 SUPABASE INSERT ERROR:", error.message, error.details, error.hint);
    throw error;
  }

  console.log("✅ Inserted show:", payload.title);

  // Automatically sync episodes after successful show insert
  await syncEpisodesForShow(showId, show.id);
}

export async function syncEpisodesForShow(showId: string, tmdbId: number) {
  const episodes: TMDBEpisode[] = await fetchAllEpisodesFromTMDB(tmdbId);

  const formatted = episodes.map((ep) => ({
    id: `${showId}-s${ep.season_number}e${ep.episode_number}`,
    show_id: showId,
    season: ep.season_number,
    episode: ep.episode_number,
    title: ep.title,
    air_date: ep.air_date,
  }));

  const { error } = await supabase.from("episodes").insert(formatted);

  if (error) {
    console.error("❌ Episode insert failed:", error.message, error.details, error.hint);
    throw error;
  }

  console.log(`📺 Synced ${formatted.length} episodes for show ${showId}`);
}