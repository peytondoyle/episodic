import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: episodeId } = await params;
    const { show_id, watched, watched_at } = await request.json();

    if (!episodeId || !show_id || watched === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: episode_id, show_id, watched' },
        { status: 400 }
      );
    }

    // Determine watched_at timestamp
    let watchedTimestamp = null;
    if (watched) {
      watchedTimestamp = watched_at ? new Date(watched_at).toISOString() : new Date().toISOString();
    }

    // Upsert the user_episode record
    await sql`
      INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, watched, watched_at, skipped)
      VALUES (${userId}::uuid, ${episodeId}, ${show_id}::uuid, ${watched}, ${watchedTimestamp}, false)
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        watched = EXCLUDED.watched,
        watched_at = EXCLUDED.watched_at,
        skipped = false
    `;

    return NextResponse.json({ success: true, watched });
  } catch (error) {
    console.error('Error toggling watched:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to toggle watched' }, { status: 500 });
  }
}
