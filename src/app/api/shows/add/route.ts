import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TVMAZE_BASE_URL = 'https://api.tvmaze.com';

const NETWORK_AIR_TIMES: Record<string, string> = {
  'HBO': '21:00',
  'FX': '22:00',
  'AMC': '21:00',
  'Showtime': '21:00',
  'Starz': '21:00',
  'ABC': '21:00',
  'NBC': '21:00',
  'CBS': '21:00',
  'FOX': '21:00',
  'The CW': '20:00',
  'Netflix': '00:00',
  'Apple TV+': '00:00',
  'Disney+': '00:00',
  'Max': '00:00',
  'Prime Video': '00:00',
  'Amazon Prime Video': '00:00',
  'Hulu': '00:00',
  'Peacock': '00:00',
  'Paramount+': '00:00',
  'Crunchyroll': '00:00',
};

function mapStatus(tmdbStatus: string): string {
  switch (tmdbStatus?.toLowerCase()) {
    case 'returning series':
      return 'airing';
    case 'ended':
      return 'ended';
    case 'canceled':
      return 'canceled';
    case 'in production':
    case 'planned':
      return 'upcoming';
    default:
      return 'airing';
  }
}

interface AirTimeResult {
  air_time: string;
  air_time_source: 'tmdb' | 'tvmaze' | 'network' | 'default';
  air_timezone: string;
}

async function getAirTime(
  showData: { name: string; external_ids?: { imdb_id?: string } },
  networkName: string | null
): Promise<AirTimeResult> {
  const imdbId = showData.external_ids?.imdb_id;

  if (imdbId) {
    try {
      const tvmazeResponse = await fetch(`${TVMAZE_BASE_URL}/lookup/shows?imdb=${imdbId}`);
      if (tvmazeResponse.ok) {
        const tvmazeData = await tvmazeResponse.json();
        if (tvmazeData.schedule?.time) {
          return {
            air_time: tvmazeData.schedule.time,
            air_time_source: 'tvmaze',
            air_timezone: tvmazeData.network?.country?.timezone || 'America/New_York',
          };
        }
      }
    } catch (e) {
      console.log('TVMaze lookup failed:', e);
    }
  }

  if (!imdbId) {
    try {
      const searchResponse = await fetch(
        `${TVMAZE_BASE_URL}/singlesearch/shows?q=${encodeURIComponent(showData.name)}`
      );
      if (searchResponse.ok) {
        const tvmazeData = await searchResponse.json();
        if (tvmazeData.schedule?.time) {
          return {
            air_time: tvmazeData.schedule.time,
            air_time_source: 'tvmaze',
            air_timezone: tvmazeData.network?.country?.timezone || 'America/New_York',
          };
        }
      }
    } catch (e) {
      console.log('TVMaze name search failed:', e);
    }
  }

  if (networkName && NETWORK_AIR_TIMES[networkName]) {
    return {
      air_time: NETWORK_AIR_TIMES[networkName],
      air_time_source: 'network',
      air_timezone: 'America/New_York',
    };
  }

  return {
    air_time: '21:00',
    air_time_source: 'default',
    air_timezone: 'America/New_York',
  };
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getDbUserId();
    const { tmdb_id } = await request.json();

    if (!tmdb_id) {
      return NextResponse.json({ error: 'tmdb_id is required' }, { status: 400 });
    }

    // Check if show already exists
    const existingShows = await sql`
      SELECT id FROM episodic_shows WHERE tmdb_id = ${tmdb_id}
    `;

    let showId: string;

    if (existingShows.length > 0) {
      showId = existingShows[0].id;

      // Check if show needs episode refresh
      const showDetails = await sql`
        SELECT last_synced_at FROM episodic_shows WHERE id = ${showId}::uuid
      `;
      const lastSynced = showDetails[0]?.last_synced_at ? new Date(showDetails[0].last_synced_at) : null;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const needsRefresh = !lastSynced || lastSynced < sevenDaysAgo;

      if (needsRefresh) {
        try {
          const tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdb_id}?api_key=${TMDB_API_KEY}`;
          const showResponse = await fetch(tmdbUrl);
          if (showResponse.ok) {
            const showData = await showResponse.json();

            const episodes: {
              id: string;
              show_id: string;
              season: number;
              episode: number;
              title: string;
              air_date: string | null;
              runtime: number | null;
              summary: string | null;
              still_url: string | null;
            }[] = [];

            for (let season = 1; season <= showData.number_of_seasons; season++) {
              const seasonResponse = await fetch(
                `${TMDB_BASE_URL}/tv/${tmdb_id}/season/${season}?api_key=${TMDB_API_KEY}`
              );
              if (seasonResponse.ok) {
                const seasonData = await seasonResponse.json();
                if (seasonData.episodes) {
                  for (const ep of seasonData.episodes) {
                    episodes.push({
                      id: `${showId}-s${season}e${ep.episode_number}`,
                      show_id: showId,
                      season: season,
                      episode: ep.episode_number,
                      title: ep.name || `Episode ${ep.episode_number}`,
                      air_date: ep.air_date || null,
                      runtime: ep.runtime || null,
                      summary: ep.overview || null,
                      still_url: ep.still_path || null,
                    });
                  }
                }
              }
            }

            if (episodes.length > 0) {
              for (const ep of episodes) {
                await sql`
                  INSERT INTO episodic_episodes (id, show_id, season, episode, title, air_date, runtime, summary, still_url)
                  VALUES (${ep.id}, ${ep.show_id}::uuid, ${ep.season}, ${ep.episode}, ${ep.title}, ${ep.air_date}, ${ep.runtime}, ${ep.summary}, ${ep.still_url})
                  ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    air_date = EXCLUDED.air_date,
                    runtime = EXCLUDED.runtime,
                    summary = EXCLUDED.summary,
                    still_url = EXCLUDED.still_url
                `;
              }
            }

            await sql`
              UPDATE episodic_shows SET last_synced_at = NOW() WHERE id = ${showId}::uuid
            `;
          }
        } catch (e) {
          console.log('Episode refresh for existing show failed:', e);
        }
      }
    } else {
      // Fetch show details from TMDB
      const tmdbUrl = `${TMDB_BASE_URL}/tv/${tmdb_id}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const showResponse = await fetch(tmdbUrl);

      if (!showResponse.ok) {
        throw new Error(`TMDB API error: ${showResponse.status}`);
      }

      const showData = await showResponse.json();

      if (!showData.name) {
        throw new Error(`TMDB returned invalid show data for tmdb_id ${tmdb_id}`);
      }

      const slug = showData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const networkName = showData.networks?.[0]?.name || null;
      const airTimeResult = await getAirTime(showData, networkName);

      // Insert show
      const newShow = await sql`
        INSERT INTO episodic_shows (
          title, slug, poster_url, backdrop_url, status, synopsis, tmdb_id,
          network, genre, rating, first_air_date, air_time, air_time_source, air_timezone
        )
        VALUES (
          ${showData.name},
          ${slug},
          ${showData.poster_path},
          ${showData.backdrop_path},
          ${mapStatus(showData.status)},
          ${showData.overview},
          ${tmdb_id},
          ${networkName},
          ${showData.genres?.[0]?.name || null},
          ${showData.vote_average},
          ${showData.first_air_date || null},
          ${airTimeResult.air_time},
          ${airTimeResult.air_time_source},
          ${airTimeResult.air_timezone}
        )
        RETURNING id
      `;

      showId = newShow[0].id;

      // Fetch and insert all episodes
      for (let season = 1; season <= showData.number_of_seasons; season++) {
        const seasonResponse = await fetch(
          `${TMDB_BASE_URL}/tv/${tmdb_id}/season/${season}?api_key=${TMDB_API_KEY}`
        );
        const seasonData = await seasonResponse.json();

        if (seasonData.episodes) {
          for (const ep of seasonData.episodes) {
            await sql`
              INSERT INTO episodic_episodes (id, show_id, season, episode, title, air_date, runtime, summary, still_url)
              VALUES (
                ${`${showId}-s${season}e${ep.episode_number}`},
                ${showId}::uuid,
                ${season},
                ${ep.episode_number},
                ${ep.name || `Episode ${ep.episode_number}`},
                ${ep.air_date || null},
                ${ep.runtime || null},
                ${ep.overview || null},
                ${ep.still_path || null}
              )
              ON CONFLICT (id) DO NOTHING
            `;
          }
        }
      }

      await sql`
        UPDATE episodic_shows SET last_synced_at = NOW() WHERE id = ${showId}::uuid
      `;
    }

    // Add to user's library
    await sql`
      INSERT INTO episodic_user_shows (user_id, show_id, status)
      VALUES (${userId}::uuid, ${showId}::uuid, 'watching')
      ON CONFLICT (user_id, show_id) DO NOTHING
    `;

    // Create user_episodes entries for all episodes
    const allEpisodes = await sql`
      SELECT id FROM episodic_episodes WHERE show_id = ${showId}::uuid
    `;

    for (const ep of allEpisodes) {
      await sql`
        INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, watched)
        VALUES (${userId}::uuid, ${ep.id}, ${showId}::uuid, false)
        ON CONFLICT (user_id, episode_id) DO NOTHING
      `;
    }

    // Get final episode count
    const countResult = await sql`
      SELECT COUNT(*) as count FROM episodic_episodes WHERE show_id = ${showId}::uuid
    `;

    return NextResponse.json({
      show_id: showId,
      episode_count: Number(countResult[0].count),
      success: true,
    });
  } catch (error) {
    console.error('[add-show] Error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add show' },
      { status: 500 }
    );
  }
}
