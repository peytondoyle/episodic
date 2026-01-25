import { NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: showId } = await params;

    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }

    const rows = await sql`
      SELECT
        e.id,
        e.show_id,
        e.season,
        e.episode,
        e.title,
        e.air_date,
        e.runtime,
        e.summary,
        e.still_url,
        ue.watched,
        ue.watched_at,
        ue.rating,
        ue.notes,
        ue.skipped
      FROM episodic_episodes e
      LEFT JOIN episodic_user_episodes ue
        ON ue.episode_id = e.id
       AND ue.user_id = ${userId}::uuid
      WHERE e.show_id = ${showId}::uuid
      ORDER BY e.season, e.episode
    `;

    const episodes = rows.map(row => ({
      episode: {
        id: row.id,
        show_id: row.show_id,
        season: row.season,
        episode: row.episode,
        title: row.title,
        air_date: row.air_date,
        runtime: row.runtime,
        summary: row.summary,
        still_url: row.still_url,
      },
      watched: row.watched ?? false,
      watched_at: row.watched_at,
      rating: row.rating,
      notes: row.notes,
      skipped: row.skipped ?? false,
    }));

    return NextResponse.json({ episodes });
  } catch (error) {
    console.error('Error fetching show episodes:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch show episodes' }, { status: 500 });
  }
}
