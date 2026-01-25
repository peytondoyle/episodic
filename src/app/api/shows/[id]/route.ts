import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: showId } = await params;

    if (!showId) {
      return NextResponse.json({ error: 'show_id is required' }, { status: 400 });
    }

    await sql`
      DELETE FROM episodic_user_episodes
      WHERE user_id = ${userId}::uuid
        AND show_id = ${showId}::uuid
    `;

    await sql`
      DELETE FROM episodic_user_shows
      WHERE user_id = ${userId}::uuid
        AND show_id = ${showId}::uuid
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing show:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to remove show' }, { status: 500 });
  }
}
