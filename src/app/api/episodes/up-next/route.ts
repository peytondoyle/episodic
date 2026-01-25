import { NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

function getTodayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

export async function GET() {
  try {
    const userId = await getDbUserId();

    // Get user's tracked shows (watching or paused)
    const userShows = await sql`
      SELECT
        us.show_id,
        us.status,
        s.id,
        s.title,
        s.slug,
        s.poster_url,
        s.backdrop_url,
        s.status as show_status,
        s.network,
        s.air_time,
        s.air_time_source,
        s.air_timezone
      FROM episodic_user_shows us
      JOIN episodic_shows s ON s.id = us.show_id
      WHERE us.user_id = ${userId}::uuid
        AND us.status IN ('watching', 'paused')
    `;

    if (userShows.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const upNextItems = [];

    for (const userShow of userShows) {
      const showId = userShow.show_id;

      // Get all episodes for this show
      const episodes = await sql`
        SELECT id, show_id, season, episode, title, air_date, runtime, still_url
        FROM episodic_episodes
        WHERE show_id = ${showId}::uuid
        ORDER BY season, episode
      `;

      if (episodes.length === 0) continue;

      // Get user's watched/skipped episodes for this show
      const userEpisodeRows = await sql`
        SELECT episode_id, watched, skipped
        FROM episodic_user_episodes
        WHERE user_id = ${userId}::uuid
          AND show_id = ${showId}::uuid
      `;

      const watchedIds = new Set(
        userEpisodeRows.filter(row => row.watched).map(row => row.episode_id)
      );
      const skippedIds = new Set(
        userEpisodeRows.filter(row => row.skipped).map(row => row.episode_id)
      );

      // Find first unwatched episode
      const nextEpisode = episodes.find(
        ep => !watchedIds.has(ep.id) && !skippedIds.has(ep.id)
      );

      if (nextEpisode) {
        const watchedCount = watchedIds.size;
        const totalCount = episodes.length;

        const showTimezone = userShow.air_timezone || 'America/New_York';
        const todayInShowTZ = getTodayInTimezone(showTimezone);

        // Count available episodes (unwatched AND already aired)
        const availableCount = episodes.filter(ep => {
          if (watchedIds.has(ep.id) || skippedIds.has(ep.id)) return false;
          if (!ep.air_date) return false;
          return ep.air_date < todayInShowTZ;
        }).length;

        upNextItems.push({
          show: {
            id: userShow.id,
            title: userShow.title,
            slug: userShow.slug,
            poster_url: userShow.poster_url,
            backdrop_url: userShow.backdrop_url,
            status: userShow.show_status,
            network: userShow.network,
            air_time: userShow.air_time,
            air_time_source: userShow.air_time_source,
            air_timezone: userShow.air_timezone,
          },
          episode: {
            id: nextEpisode.id,
            season: nextEpisode.season,
            episode: nextEpisode.episode,
            title: nextEpisode.title,
            air_date: nextEpisode.air_date,
            runtime: nextEpisode.runtime,
            still_url: nextEpisode.still_url,
          },
          progress: {
            watched: watchedCount,
            total: totalCount,
          },
          available_count: availableCount,
        });
      }
    }

    // Sort by show title
    upNextItems.sort((a, b) => a.show.title.localeCompare(b.show.title));

    return NextResponse.json({ items: upNextItems });
  } catch (error) {
    console.error('Error fetching up-next:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch up-next' }, { status: 500 });
  }
}
