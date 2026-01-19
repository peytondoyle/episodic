import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const userId = await getDbUserId();

    // Parse pagination parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get watched episodes sorted by watched_at descending
    const userEpisodes = await sql`
      SELECT watched_at, rating, episode_id, show_id
      FROM episodic_user_episodes
      WHERE user_id = ${userId}::uuid
        AND watched = true
        AND watched_at IS NOT NULL
      ORDER BY watched_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    if (userEpisodes.length === 0) {
      return NextResponse.json({ history: [] });
    }

    // Get unique episode and show IDs
    const episodeIds = [...new Set(userEpisodes.map(ue => ue.episode_id))];
    const showIds = [...new Set(userEpisodes.map(ue => ue.show_id))];

    // Fetch episodes
    const episodes = await sql`
      SELECT id, season, episode, title, runtime
      FROM episodic_episodes
      WHERE id = ANY(${episodeIds}::text[])
    `;

    // Fetch shows
    const shows = await sql`
      SELECT id, title, poster_url
      FROM episodic_shows
      WHERE id = ANY(${showIds}::uuid[])
    `;

    // Create lookup maps
    const episodeMap = new Map(episodes.map(e => [e.id, e]));
    const showMap = new Map(shows.map(s => [s.id, s]));

    // Build the history array
    const history = userEpisodes
      .filter(ue => {
        const episode = episodeMap.get(ue.episode_id);
        const show = showMap.get(ue.show_id);
        return episode && show;
      })
      .map(ue => {
        const episode = episodeMap.get(ue.episode_id)!;
        const show = showMap.get(ue.show_id)!;

        return {
          watched_at: ue.watched_at,
          episode: {
            id: episode.id,
            season: episode.season,
            episode: episode.episode,
            title: episode.title,
            runtime: episode.runtime,
          },
          show: {
            id: show.id,
            title: show.title,
            poster_url: show.poster_url,
          },
          rating: ue.rating,
        };
      });

    return NextResponse.json({ history });
  } catch (error) {
    console.error('Error fetching history:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
