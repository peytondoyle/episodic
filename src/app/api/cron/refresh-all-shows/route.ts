import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret if configured
    if (CRON_SECRET) {
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Parse request body for optional filters
    let forceAll = false;
    let showIds: string[] | null = null;

    try {
      const body = await request.json();
      forceAll = body.force_all || false;
      showIds = body.show_ids || null;
    } catch {
      // No body is fine
    }

    // Get all shows that need refresh
    let shows;
    if (showIds && showIds.length > 0) {
      shows = await sql`
        SELECT id, tmdb_id, title, last_synced_at
        FROM episodic_shows
        WHERE id = ANY(${showIds}::uuid[])
      `;
    } else {
      shows = await sql`
        SELECT id, tmdb_id, title, last_synced_at
        FROM episodic_shows
      `;
    }

    if (shows.length === 0) {
      return NextResponse.json({ message: 'No shows to refresh', refreshed: 0 });
    }

    const results: {
      show_id: string;
      title: string;
      status: string;
      reason?: string;
      episodes_synced?: number;
      seasons?: number;
    }[] = [];

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const show of shows) {
      // Skip if recently synced (unless force_all)
      if (!forceAll && show.last_synced_at) {
        const lastSynced = new Date(show.last_synced_at);
        if (lastSynced > sevenDaysAgo) {
          results.push({
            show_id: show.id,
            title: show.title,
            status: 'skipped',
            reason: 'recently_synced',
          });
          continue;
        }
      }

      try {
        // Fetch show details from TMDB
        const showResponse = await fetch(
          `${TMDB_BASE_URL}/tv/${show.tmdb_id}?api_key=${TMDB_API_KEY}`
        );

        if (!showResponse.ok) {
          results.push({
            show_id: show.id,
            title: show.title,
            status: 'error',
            reason: `TMDB error: ${showResponse.status}`,
          });
          continue;
        }

        const showData = await showResponse.json();

        // Fetch all episodes for all seasons
        for (let season = 1; season <= showData.number_of_seasons; season++) {
          // Add small delay to avoid rate limiting
          if (season > 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          const seasonResponse = await fetch(
            `${TMDB_BASE_URL}/tv/${show.tmdb_id}/season/${season}?api_key=${TMDB_API_KEY}`
          );

          if (!seasonResponse.ok) {
            console.log(`Skipping season ${season} for ${show.title}: ${seasonResponse.status}`);
            continue;
          }

          const seasonData = await seasonResponse.json();

          if (seasonData.episodes) {
            for (const ep of seasonData.episodes) {
              await sql`
                INSERT INTO episodic_episodes (id, show_id, season, episode, title, air_date, runtime, summary, still_url)
                VALUES (
                  ${`${show.id}-s${season}e${ep.episode_number}`},
                  ${show.id}::uuid,
                  ${season},
                  ${ep.episode_number},
                  ${ep.name || `Episode ${ep.episode_number}`},
                  ${ep.air_date || null},
                  ${ep.runtime || null},
                  ${ep.overview || null},
                  ${ep.still_path || null}
                )
                ON CONFLICT (id) DO UPDATE SET
                  title = EXCLUDED.title,
                  air_date = EXCLUDED.air_date,
                  runtime = EXCLUDED.runtime,
                  summary = EXCLUDED.summary,
                  still_url = EXCLUDED.still_url
              `;
            }
          }
        }

        // Update last_synced_at
        await sql`
          UPDATE episodic_shows SET last_synced_at = NOW() WHERE id = ${show.id}::uuid
        `;

        // Get episode count
        const countResult = await sql`
          SELECT COUNT(*) as count FROM episodic_episodes WHERE show_id = ${show.id}::uuid
        `;

        results.push({
          show_id: show.id,
          title: show.title,
          status: 'success',
          episodes_synced: Number(countResult[0].count),
          seasons: showData.number_of_seasons,
        });

        // Rate limit protection - wait between shows
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (e) {
        results.push({
          show_id: show.id,
          title: show.title,
          status: 'error',
          reason: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    return NextResponse.json({
      total: shows.length,
      refreshed: successCount,
      errors: errorCount,
      skipped: skippedCount,
      results,
    });
  } catch (error) {
    console.error('Refresh all shows error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Refresh failed' },
      { status: 500 }
    );
  }
}
