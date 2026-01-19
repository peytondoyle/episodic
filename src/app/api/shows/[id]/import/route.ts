import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

interface ImportEpisode {
  season: number;
  episode: number;
  watched_at: string;
}

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: tmdb_id } = await params;
    const { episodes }: { episodes: ImportEpisode[] } = await request.json();

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
    } else {
      // Fetch show details from TMDB
      const showResponse = await fetch(
        `${TMDB_BASE_URL}/tv/${tmdb_id}?api_key=${TMDB_API_KEY}`
      );
      const showData = await showResponse.json();

      if (showData.status_code === 34) {
        return NextResponse.json(
          { error: 'Show not found on TMDB', success: false },
          { status: 404 }
        );
      }

      const slug = showData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // Insert show
      const newShow = await sql`
        INSERT INTO episodic_shows (
          title, slug, poster_url, backdrop_url, status, synopsis, tmdb_id,
          network, genre, rating, first_air_date
        )
        VALUES (
          ${showData.name},
          ${slug},
          ${showData.poster_path},
          ${showData.backdrop_path},
          ${mapStatus(showData.status)},
          ${showData.overview},
          ${tmdb_id},
          ${showData.networks?.[0]?.name || null},
          ${showData.genres?.[0]?.name || null},
          ${showData.vote_average},
          ${showData.first_air_date || null}
        )
        ON CONFLICT (tmdb_id) DO UPDATE SET title = EXCLUDED.title
        RETURNING id
      `;

      showId = newShow[0].id;

      // Fetch and insert all episodes from TMDB
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

      // Also fetch specials (season 0)
      try {
        const specialsResponse = await fetch(
          `${TMDB_BASE_URL}/tv/${tmdb_id}/season/0?api_key=${TMDB_API_KEY}`
        );
        const specialsData = await specialsResponse.json();
        if (specialsData.episodes) {
          for (const ep of specialsData.episodes) {
            await sql`
              INSERT INTO episodic_episodes (id, show_id, season, episode, title, air_date, runtime, summary, still_url)
              VALUES (
                ${`${showId}-s0e${ep.episode_number}`},
                ${showId}::uuid,
                0,
                ${ep.episode_number},
                ${ep.name || `Special ${ep.episode_number}`},
                ${ep.air_date || null},
                ${ep.runtime || null},
                ${ep.overview || null},
                ${ep.still_path || null}
              )
              ON CONFLICT (id) DO NOTHING
            `;
          }
        }
      } catch {
        // No specials, that's fine
      }
    }

    // Add to user's library
    await sql`
      INSERT INTO episodic_user_shows (user_id, show_id, status)
      VALUES (${userId}::uuid, ${showId}::uuid, 'watching')
      ON CONFLICT (user_id, show_id) DO NOTHING
    `;

    // Get all episodes for this show from DB
    const allEpisodes = await sql`
      SELECT id, season, episode, air_date
      FROM episodic_episodes
      WHERE show_id = ${showId}::uuid
    `;

    if (allEpisodes.length === 0) {
      return NextResponse.json({
        success: true,
        show_id: showId,
        imported_count: 0,
        message: 'Show added but no episodes found',
      });
    }

    // Build user_episodes with watch status
    const importedEpisodesMap = new Map<string, string>();
    for (const ep of episodes || []) {
      const key = `${ep.season}-${ep.episode}`;
      importedEpisodesMap.set(key, ep.watched_at);
    }

    let importedCount = 0;

    for (const ep of allEpisodes) {
      const key = `${ep.season}-${ep.episode}`;
      const importedWatchedAt = importedEpisodesMap.get(key);

      let watchedAt: string | null = null;
      if (importedWatchedAt) {
        importedCount++;
        const importDate = new Date(importedWatchedAt);
        const now = new Date();
        const isRecentImport = now.getTime() - importDate.getTime() < 24 * 60 * 60 * 1000;

        if (isRecentImport && ep.air_date) {
          watchedAt = new Date(ep.air_date).toISOString();
        } else {
          watchedAt = importedWatchedAt;
        }
      }

      await sql`
        INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, watched, watched_at)
        VALUES (${userId}::uuid, ${ep.id}, ${showId}::uuid, ${!!importedWatchedAt}, ${watchedAt})
        ON CONFLICT (user_id, episode_id) DO UPDATE SET
          watched = EXCLUDED.watched,
          watched_at = EXCLUDED.watched_at
      `;
    }

    // Update show status to 'completed' if all episodes are watched
    if (importedCount === allEpisodes.length && allEpisodes.length > 0) {
      await sql`
        UPDATE episodic_user_shows
        SET status = 'completed'
        WHERE user_id = ${userId}::uuid AND show_id = ${showId}::uuid
      `;
    }

    return NextResponse.json({
      success: true,
      show_id: showId,
      imported_count: importedCount,
      total_episodes: allEpisodes.length,
    });
  } catch (error) {
    console.error('Import show error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed', success: false },
      { status: 500 }
    );
  }
}
