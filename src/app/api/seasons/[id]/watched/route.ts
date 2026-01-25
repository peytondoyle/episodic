import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: showId } = await params;
    const { season } = await request.json();

    if (!showId || season === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: show_id, season' },
        { status: 400 }
      );
    }

    // Get all episodes for this show/season
    const episodes = await sql`
      SELECT id FROM episodic_episodes
      WHERE show_id = ${showId}::uuid AND season = ${season}
    `;

    if (episodes.length === 0) {
      return NextResponse.json({ success: true, marked_count: 0 });
    }

    // Mark all episodes as watched
    const now = new Date().toISOString();
    for (const episode of episodes) {
      await sql`
        INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, watched, watched_at, skipped)
        VALUES (${userId}::uuid, ${episode.id}, ${showId}::uuid, true, ${now}, false)
        ON CONFLICT (user_id, episode_id) DO UPDATE SET
          watched = true,
          watched_at = COALESCE(episodic_user_episodes.watched_at, ${now}),
          skipped = false
      `;
    }

    return NextResponse.json({ success: true, marked_count: episodes.length });
  } catch (error) {
    console.error('Error marking season watched:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to mark season watched' }, { status: 500 });
  }
}
