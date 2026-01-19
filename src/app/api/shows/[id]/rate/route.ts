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
    const { rating } = await request.json();

    if (!showId) {
      return NextResponse.json(
        { error: 'Missing required field: show_id' },
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

    await sql`
      UPDATE episodic_user_shows
      SET rating = ${rating}, updated_at = NOW()
      WHERE user_id = ${userId}::uuid AND show_id = ${showId}::uuid
    `;

    return NextResponse.json({ success: true, rating });
  } catch (error) {
    console.error('Error rating show:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to rate show' }, { status: 500 });
  }
}
