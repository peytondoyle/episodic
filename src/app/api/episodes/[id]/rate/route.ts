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
    const { show_id, rating } = await request.json();

    if (!episodeId || !show_id) {
      return NextResponse.json(
        { error: 'Missing required fields: episode_id, show_id' },
        { status: 400 }
      );
    }

    // Validate rating: must be 1-5 or null to clear
    if (rating !== null && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return NextResponse.json(
        { error: 'Rating must be a number between 1 and 5, or null to clear' },
        { status: 400 }
      );
    }

    // Upsert the user_episode record with rating (rating implies watched)
    await sql`
      INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, rating, watched, watched_at, skipped)
      VALUES (${userId}::uuid, ${episodeId}, ${show_id}::uuid, ${rating}, true, NOW(), false)
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        rating = EXCLUDED.rating,
        watched = true,
        watched_at = COALESCE(episodic_user_episodes.watched_at, NOW()),
        skipped = false
    `;

    return NextResponse.json({ success: true, rating });
  } catch (error) {
    console.error('Error rating episode:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to rate episode' }, { status: 500 });
  }
}
