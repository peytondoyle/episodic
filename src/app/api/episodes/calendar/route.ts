import { NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const userId = await getDbUserId();

    // Get user's tracked shows (watching or paused)
    const userShows = await sql`
      SELECT
        us.show_id,
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
      return NextResponse.json({ episodes: [] });
    }

    const showIds = userShows.map(us => us.show_id);
    const showMap = new Map(userShows.map(us => [us.show_id, us]));

    const today = new Date().toISOString().split('T')[0];

    // Get ALL future episodes for tracked shows
    const episodes = await sql`
      SELECT id, show_id, season, episode, title, air_date, runtime, still_url
      FROM episodic_episodes
      WHERE show_id = ANY(${showIds}::uuid[])
        AND air_date >= ${today}
      ORDER BY air_date, show_id, season, episode
    `;

    const calendarEpisodes = episodes.map(ep => {
      const show = showMap.get(ep.show_id);
      return {
        show: {
          id: ep.show_id,
          title: show?.title || 'Unknown Show',
          slug: show?.slug || '',
          poster_url: show?.poster_url,
          backdrop_url: show?.backdrop_url,
          status: show?.show_status || 'airing',
          network: show?.network,
          air_time: show?.air_time,
          air_time_source: show?.air_time_source,
          air_timezone: show?.air_timezone,
        },
        episode: {
          id: ep.id,
          season: ep.season,
          episode: ep.episode,
          title: ep.title,
          air_date: ep.air_date,
          runtime: ep.runtime,
          still_url: ep.still_url,
        },
        progress: {
          watched: 0,
          total: 1,
        },
        available_count: null,
      };
    });

    return NextResponse.json({ episodes: calendarEpisodes });
  } catch (error) {
    console.error('Error fetching calendar:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch calendar' }, { status: 500 });
  }
}
