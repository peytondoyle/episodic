import { createClient } from "@supabase/supabase-js";
import { Database } from "./types";
import slugify from "slugify";
import { fetchAllEpisodesFromTMDB } from "./tmdb";
import { v4 as uuidv4 } from "uuid";

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

type TMDBShow = {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  first_air_date: string;
  status?: string | null;
  homepage?: string | null;
};

const allowedStatuses = ["airing", "canceled", "coming_soon", "ended"];

function normalizeStatus(rawStatus: string | undefined | null): string | null {
  if (!rawStatus) return null;
  const formatted = rawStatus.trim().toLowerCase().replace(/\s+/g, "_");
  return allowedStatuses.includes(formatted) ? formatted : null;
}

export async function insertShowFromTMDB(show: TMDBShow): Promise<string> {
  const slug = slugify(show.name, { lower: true });
  const normalizedStatus = normalizeStatus(show.status);
  const showId = uuidv4();

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
    tmdb_id: show.id.toString(),
  };

  const { error } = await supabase.from("shows").insert([payload]);
  if (error) throw error;

  return showId;
}

type ShowDetailsWithProgress = {
  watched: boolean;
  watched_at: string | null;
  episode_id: string;
  show_id: string;
  episodes: {
    id: string;
    season: number;
    episode: number;
    title: string;
    air_date: string;
    show_id: string;
    shows: {
      id: string;
      title: string;
    };
  };
};

type RawUserEpisode = {
  watched: boolean;
  watched_at: string | null;
  episode_id: string;
  show_id: string;
  episodes: {
    id: string;
    season: number;
    episode: number;
    title: string;
    air_date: string;
    show_id: string;
    shows: {
      id: string;
      title: string;
    };
  };
};

export async function getShowDetailsWithUserProgress(showId: string) {
  const { data, error } = await supabase
    .from("user_episodes")
    .select(`
      watched,
      watched_at,
      episode_id,
      show_id,
      episodes:episodes!fk_user_episode (
        id,
        season,
        episode,
        title,
        air_date,
        show_id,
        shows:shows!episodes_show_id_fkey (
          id,
          title
        )
      )
    `)
    .eq("show_id", showId)
    .returns<RawUserEpisode[]>(); // 👈 This tells TS the exact structure

  if (error) {
    console.error("❌ Supabase fetch error:", error);
    throw error;
  }

  if (!data || data.length === 0) {
    return {
      debugRaw: [],
      episodes: [],
      show: { title: "Show Not Found" }
    };
  }

  const episodes = data
    .filter((ep) => ep.episodes && ep.episodes.shows) // ensure nested data exists
    .map((ep) => {
      return {
        id: ep.episodes.id,
        season: ep.episodes.season,
        episode: ep.episodes.episode,
        title: ep.episodes.title,
        air_date: ep.episodes.air_date,
        show_id: ep.episodes.show_id,
        userWatched: ep.watched,
        watched_at: ep.watched_at,
        show: ep.episodes.shows
      };
    });

  const show = episodes[0]?.show || { title: "Show Not Found" };

  return {
    debugRaw: data,
    episodes,
    show,
  };
}

export async function syncEpisodesForShow(showId: string, tmdbId: number) {
  const episodes = await fetchAllEpisodesFromTMDB(tmdbId);
  if (!episodes.length) return;

  const formatted = episodes.map((ep) => ({
    id: `${showId}-s${ep.season_number}e${ep.episode_number}`,
    show_id: showId,
    season: ep.season_number,
    episode: ep.episode_number,
    title: ep.title,
    air_date: ep.air_date,
  }));

  const chunkSize = 100;
  for (let i = 0; i < formatted.length; i += chunkSize) {
    const chunk = formatted.slice(i, i + chunkSize);
    const { error } = await supabase.from("episodes").insert(chunk);
    if (error) throw error;
  }

  console.log(`✅ Synced ${formatted.length} episodes.`);
}