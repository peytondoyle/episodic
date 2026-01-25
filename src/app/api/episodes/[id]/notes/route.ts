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
    const body = await request.json();

    const showId = body?.show_id;
    const notes = Object.prototype.hasOwnProperty.call(body ?? {}, 'notes') ? body.notes : null;

    if (!episodeId || !showId) {
      return NextResponse.json(
        { error: 'Missing required fields: episode_id, show_id' },
        { status: 400 }
      );
    }

    if (notes !== null && typeof notes !== 'string') {
      return NextResponse.json(
        { error: 'Notes must be a string or null' },
        { status: 400 }
      );
    }

    await sql`
      INSERT INTO episodic_user_episodes (user_id, episode_id, show_id, notes)
      VALUES (${userId}::uuid, ${episodeId}, ${showId}::uuid, ${notes})
      ON CONFLICT (user_id, episode_id) DO UPDATE SET
        notes = EXCLUDED.notes
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving episode notes:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to save notes' }, { status: 500 });
  }
}
