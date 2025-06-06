const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY;

if (!TMDB_KEY) throw new Error("Missing TMDB API key");

export type TMDBEpisode = {
  id: string;
  season_number: number;
  episode_number: number;
  title: string;
  air_date: string | null;
};

export async function searchShows(query: string) {
  const res = await fetch(
    `${TMDB_BASE}/search/tv?query=${encodeURIComponent(query)}&api_key=${TMDB_KEY}`
  );
  if (!res.ok) throw new Error("Failed to search TMDB");
  return res.json();
}

export async function getShowDetails(id: number) {
  const res = await fetch(`${TMDB_BASE}/tv/${id}?api_key=${TMDB_KEY}&language=en-US`);
  if (!res.ok) throw new Error("Failed to fetch show details");
  return res.json(); // this object includes `status`, `homepage`, etc.
}

export async function searchTMDB(query: string) {
  const res = await fetch(
    `${TMDB_BASE}/search/tv?query=${encodeURIComponent(query)}&api_key=${TMDB_KEY}`
  );
  if (!res.ok) throw new Error("Failed to fetch from TMDB");
  return res.json();
}

export async function fetchAllEpisodesFromTMDB(showId: number): Promise<TMDBEpisode[]> {
  const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY!;
  const showResp = await fetch(`https://api.themoviedb.org/3/tv/${showId}?api_key=${TMDB_API_KEY}`);
  const showJson = await showResp.json();

  if (!showJson?.seasons) return [];

  const episodes: TMDBEpisode[] = [];

  for (const season of showJson.seasons) {
    const seasonResp = await fetch(
      `https://api.themoviedb.org/3/tv/${showId}/season/${season.season_number}?api_key=${TMDB_API_KEY}`
    );
    const seasonJson = await seasonResp.json();
    if (!seasonJson?.episodes) continue;

    for (const ep of seasonJson.episodes) {
      episodes.push({
        id: `${showId}-s${season.season_number}e${ep.episode_number}`,
        season_number: season.season_number,
        episode_number: ep.episode_number,
        title: ep.name || `Episode ${ep.episode_number}`,
        air_date: ep.air_date || null,
      });
    }
  }

  return episodes;
}