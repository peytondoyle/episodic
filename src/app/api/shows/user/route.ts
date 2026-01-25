import { NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const userId = await getDbUserId();

    // Get user's shows with show data
    const userShows = await sql`
      SELECT
        us.id,
        us.user_id,
        us.show_id,
        us.status,
        us.rating,
        us.added_at,
        us.updated_at,
        s.id as show_id,
        s.title,
        s.slug,
        s.poster_url,
        s.backdrop_url,
        s.status as show_status,
        s.synopsis,
        s.tmdb_id,
        s.network,
        s.genre,
        s.rating as show_rating,
        s.first_air_date,
        s.updated_at as show_updated_at
      FROM episodic_user_shows us
      JOIN episodic_shows s ON s.id = us.show_id
      WHERE us.user_id = ${userId}::uuid
      ORDER BY us.updated_at DESC
    `;

    if (userShows.length === 0) {
      return NextResponse.json({ shows: [] });
    }

    const showIds = userShows.map(us => us.show_id);

    // Get episode counts per show
    const episodeCounts = await sql`
      SELECT show_id, COUNT(*) as count
      FROM episodic_episodes
      WHERE show_id = ANY(${showIds}::uuid[])
      GROUP BY show_id
    `;
    const episodeCountMap = new Map(episodeCounts.map(r => [r.show_id, Number(r.count)]));

    // Get watched episode counts per show for this user
    const watchedCounts = await sql`
      SELECT show_id, COUNT(*) as count
      FROM episodic_user_episodes
      WHERE user_id = ${userId}::uuid
        AND watched = true
        AND show_id = ANY(${showIds}::uuid[])
      GROUP BY show_id
    `;
    const watchedCountMap = new Map(watchedCounts.map(r => [r.show_id, Number(r.count)]));

    // Get all episodes for these shows
    const allEpisodes = await sql`
      SELECT id, show_id, season, episode, title, air_date, runtime, summary, still_url
      FROM episodic_episodes
      WHERE show_id = ANY(${showIds}::uuid[])
      ORDER BY season, episode
    `;

    // Get watched/skipped episode IDs for this user
    const userEpisodeRows = await sql`
      SELECT episode_id, show_id, watched, skipped
      FROM episodic_user_episodes
      WHERE user_id = ${userId}::uuid
        AND show_id = ANY(${showIds}::uuid[])
    `;

    const watchedByShow = new Map<string, Set<string>>();
    const skippedByShow = new Map<string, Set<string>>();

    for (const row of userEpisodeRows) {
      if (row.watched) {
        if (!watchedByShow.has(row.show_id)) {
          watchedByShow.set(row.show_id, new Set());
        }
        watchedByShow.get(row.show_id)!.add(row.episode_id);
      }

      if (row.skipped) {
        if (!skippedByShow.has(row.show_id)) {
          skippedByShow.set(row.show_id, new Set());
        }
        skippedByShow.get(row.show_id)!.add(row.episode_id);
      }
    }

    // Group episodes by show and find first unwatched
    const episodesByShow = new Map<string, typeof allEpisodes>();
    for (const ep of allEpisodes) {
      if (!episodesByShow.has(ep.show_id)) {
        episodesByShow.set(ep.show_id, []);
      }
      episodesByShow.get(ep.show_id)!.push(ep);
    }

    const nextEpisodeMap = new Map<string, typeof allEpisodes[0]>();
    for (const [showId, episodes] of episodesByShow) {
      const watchedIds = watchedByShow.get(showId) || new Set<string>();
      const skippedIds = skippedByShow.get(showId) || new Set<string>();
      const nextEp = episodes.find(
        ep => !watchedIds.has(ep.id) && !skippedIds.has(ep.id)
      );
      if (nextEp) {
        nextEpisodeMap.set(showId, nextEp);
      }
    }

    // Build response
    const showsWithProgress = userShows.map(userShow => {
      const showId = userShow.show_id;
      const totalCount = episodeCountMap.get(showId) || 0;
      const watchedCount = watchedCountMap.get(showId) || 0;
      const nextEpisode = nextEpisodeMap.get(showId) || null;

      return {
        show: {
          id: String(userShow.show_id),
          title: userShow.title ?? '',
          slug: userShow.slug ?? '',
          poster_url: userShow.poster_url ?? null,
          backdrop_url: userShow.backdrop_url ?? null,
          status: userShow.show_status ?? 'unknown',
          synopsis: userShow.synopsis ?? null,
          tmdb_id: userShow.tmdb_id ? String(userShow.tmdb_id) : '0',
          network: userShow.network ?? null,
          genre: userShow.genre ?? null,
          rating: userShow.show_rating ? parseFloat(userShow.show_rating) : null,
          first_air_date: userShow.first_air_date ?? null,
          updated_at: userShow.show_updated_at ?? null,
        },
        user_show: {
          id: String(userShow.id),
          user_id: String(userShow.user_id),
          show_id: String(userShow.show_id),
          status: userShow.status ?? 'watching',
          rating: userShow.rating ? parseInt(userShow.rating, 10) : null,
          added_at: userShow.added_at ?? null,
          updated_at: userShow.updated_at ?? null,
        },
        watched_count: watchedCount,
        total_count: totalCount,
        next_episode: nextEpisode ? {
          id: String(nextEpisode.id),
          show_id: String(nextEpisode.show_id),
          season: nextEpisode.season,
          episode: nextEpisode.episode,
          title: nextEpisode.title ?? '',
          air_date: nextEpisode.air_date ?? null,
          runtime: nextEpisode.runtime ?? null,
          summary: nextEpisode.summary ?? null,
          still_url: nextEpisode.still_url ?? null,
        } : null,
      };
    });

    return NextResponse.json({ shows: showsWithProgress, _version: 'v5' });
  } catch (error) {
    console.error('Error fetching user shows:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message === 'Unauthorized' || message.includes('Unauthorized')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (message.includes('not linked')) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
