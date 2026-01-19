import { NextRequest, NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

const validStatuses = ['watching', 'paused', 'completed', 'dropped'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getDbUserId();
    const { id: showId } = await params;
    const { status } = await request.json();

    if (!showId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: show_id, status' },
        { status: 400 }
      );
    }

    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    await sql`
      UPDATE episodic_user_shows
      SET status = ${status}, updated_at = NOW()
      WHERE user_id = ${userId}::uuid AND show_id = ${showId}::uuid
    `;

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('Error updating show status:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}
