import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// DEBUG ENDPOINT - returns sample show data structure
// Remove this after debugging
export async function GET() {
  try {
    // Find shows with problematic tmdb_id
    const problemShows = await sql`
      SELECT id, title, tmdb_id
      FROM episodic_shows
      WHERE tmdb_id IS NULL OR tmdb_id = ''
      LIMIT 10
    `;

    // Get all shows to check their tmdb_id values
    const allShows = await sql`
      SELECT id, title, tmdb_id,
             CASE WHEN tmdb_id IS NULL THEN 'null'
                  WHEN tmdb_id = '' THEN 'empty'
                  ELSE 'ok' END as status
      FROM episodic_shows
      ORDER BY title
    `;

    return NextResponse.json({
      problem_shows: problemShows,
      all_shows: allShows.map(s => ({
        title: s.title,
        tmdb_id: s.tmdb_id,
        status: s.status,
      })),
      version: 'v4',
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
