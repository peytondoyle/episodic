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
    const { show_id, skipped } = await request.json();

    if (!episodeId || !show_id || typeof skipped !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing required fields: episode_id, show_id, skipped' },
        { status: 400 }
      );
    }

    await sql`
      INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, skipped)
      VALUES (${userId}::uuid, ${episodeId}, ${show_id}::uuid, ${skipped})
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        skipped = EXCLUDED.skipped
    `;

    return NextResponse.json({ success: true, skipped });
  } catch (error) {
    console.error('Error toggling skipped:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to toggle skipped' }, { status: 500 });
  }
}
