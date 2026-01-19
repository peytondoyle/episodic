import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sql } from '@/lib/db';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAuth();
    const { id: showId } = await params;

    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }

    // Get show from DB
    const shows = await sql`
      SELECT id, tmdb_id, title, watch_providers_updated_at
      FROM episodic_shows
      WHERE id = ${showId}::uuid
    `;

    if (shows.length === 0) {
      return NextResponse.json({ error: 'Show not found' }, { status: 404 });
    }

    const show = shows[0];
    const tmdbId = show.tmdb_id;

    // Fetch show details from TMDB
    const showResponse = await fetch(
      `${TMDB_BASE_URL}/tv/${tmdbId}?api_key=${TMDB_API_KEY}`
    );

    if (!showResponse.ok) {
      if (showResponse.status === 429) {
        return NextResponse.json(
          { error: 'TMDB API rate limited. Please try again later.' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: `TMDB API error: ${showResponse.statusText}` },
        { status: 502 }
      );
    }

    const showData = await showResponse.json();

    // Refresh watch providers if stale
    let providersRefreshed = false;
    const PROVIDER_TTL_DAYS = 7;
    const providerUpdateDate = show.watch_providers_updated_at
      ? new Date(show.watch_providers_updated_at)
      : null;
    const now = new Date();
    const isProviderStale =
      !providerUpdateDate ||
      now.getTime() - providerUpdateDate.getTime() > PROVIDER_TTL_DAYS * 24 * 60 * 60 * 1000;

    if (isProviderStale) {
      try {
        const providersResponse = await fetch(
          `${TMDB_BASE_URL}/tv/${tmdbId}/watch/providers?api_key=${TMDB_API_KEY}`
        );
        if (providersResponse.ok) {
          const providersData = await providersResponse.json();
          const usProviders = providersData.results?.US || null;

          await sql`
            UPDATE episodic_shows
            SET watch_providers = ${JSON.stringify(usProviders)},
                watch_providers_updated_at = ${now.toISOString()}
            WHERE id = ${showId}::uuid
          `;
          providersRefreshed = true;
        }
      } catch (e) {
        console.log('Watch providers refresh failed:', e);
      }
    }

    // Get existing episodes
    const existingEpisodes = await sql`
      SELECT id, season, episode FROM episodic_episodes WHERE show_id = ${showId}::uuid
    `;

    const existingEpisodeMap = new Map<string, string>();
    for (const ep of existingEpisodes) {
      existingEpisodeMap.set(`${ep.season}-${ep.episode}`, ep.id);
    }

    // Fetch all seasons from TMDB
    const seasonNumbers =
      showData.seasons?.map((s: { season_number: number }) => s.season_number).filter((n: number) => n !== undefined) || [];

    if (seasonNumbers.length === 0 && showData.number_of_seasons > 0) {
      for (let i = 1; i <= showData.number_of_seasons; i++) {
        seasonNumbers.push(i);
      }
    }

    let updatedCount = 0;
    let insertedCount = 0;

    for (const seasonNum of seasonNumbers) {
      const seasonResponse = await fetch(
        `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNum}?api_key=${TMDB_API_KEY}`
      );

      if (seasonResponse.status === 429) {
        return NextResponse.json(
          { error: 'TMDB API rate limited. Please try again later.' },
          { status: 429 }
        );
      }

      if (!seasonResponse.ok) continue;

      const seasonData = await seasonResponse.json();

      if (seasonData.episodes) {
        for (const ep of seasonData.episodes) {
          const episodeKey = `${seasonNum}-${ep.episode_number}`;
          const existingId = existingEpisodeMap.get(episodeKey);

          if (existingId) {
            // Update existing episode
            await sql`
              UPDATE episodic_episodes
              SET title = ${ep.name || `Episode ${ep.episode_number}`},
                  air_date = ${ep.air_date || null},
                  runtime = ${ep.runtime || null},
                  summary = ${ep.overview || null},
                  still_url = ${ep.still_path || null}
              WHERE id = ${existingId}
            `;
            updatedCount++;
          } else {
            // Insert new episode
            const newEpisodeId = `${showId}-s${seasonNum}e${ep.episode_number}`;
            await sql`
              INSERT INTO episodic_episodes (id, show_id, season, episode, title, air_date, runtime, summary, still_url)
              VALUES (
                ${newEpisodeId},
                ${showId}::uuid,
                ${seasonNum},
                ${ep.episode_number},
                ${ep.name || `Episode ${ep.episode_number}`},
                ${ep.air_date || null},
                ${ep.runtime || null},
                ${ep.overview || null},
                ${ep.still_path || null}
              )
            `;
            insertedCount++;

            // Create user_episodes entries for all users tracking this show
            const usersTrackingShow = await sql`
              SELECT user_id FROM episodic_user_shows WHERE show_id = ${showId}::uuid
            `;

            for (const userShow of usersTrackingShow) {
              await sql`
                INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, watched)
                VALUES (${userShow.user_id}::uuid, ${newEpisodeId}, ${showId}::uuid, false)
                ON CONFLICT (user_id, episode_id) DO NOTHING
              `;
            }
          }
        }
      }
    }

    // Update last_synced_at
    const lastSyncedAt = new Date().toISOString();
    await sql`
      UPDATE episodic_shows SET last_synced_at = ${lastSyncedAt} WHERE id = ${showId}::uuid
    `;

    // Get total episode count
    const countResult = await sql`
      SELECT COUNT(*) as count FROM episodic_episodes WHERE show_id = ${showId}::uuid
    `;

    return NextResponse.json({
      success: true,
      show_id: showId,
      episodes_updated: updatedCount,
      episodes_inserted: insertedCount,
      episodes_total: Number(countResult[0].count),
      providers_refreshed: providersRefreshed,
      last_synced_at: lastSyncedAt,
    });
  } catch (error) {
    console.error('Refresh show episodes error:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refresh failed' },
      { status: 500 }
    );
  }
}
