import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// DEBUG ENDPOINT - returns sample show data structure
// Remove this after debugging
export async function GET() {
  try {
    // Get first user's first show to see the structure
    const userShows = await sql`
      SELECT
        us.id,
        us.user_id,
        us.show_id,
        us.status,
        us.rating,
        us.added_at,
        us.updated_at,
        s.id as s_id,
        s.title,
        s.slug,
        s.poster_url,
        s.backdrop_url,
        s.status as show_status,
        s.synopsis,
        s.tmdb_id,
        s.network,
        s.genre,
        s.rating as show_rating,
        s.first_air_date,
        s.updated_at as show_updated_at
      FROM episodic_user_shows us
      JOIN episodic_shows s ON s.id = us.show_id
      LIMIT 1
    `;

    if (userShows.length === 0) {
      return NextResponse.json({ debug: 'no shows found' });
    }

    const userShow = userShows[0];

    // Return raw data and transformed data for comparison
    return NextResponse.json({
      raw: {
        tmdb_id_value: userShow.tmdb_id,
        tmdb_id_type: typeof userShow.tmdb_id,
        tmdb_id_truthy: !!userShow.tmdb_id,
      },
      transformed: {
        id: String(userShow.show_id),
        title: userShow.title ?? '',
        slug: userShow.slug ?? '',
        poster_url: userShow.poster_url ?? null,
        backdrop_url: userShow.backdrop_url ?? null,
        status: userShow.show_status ?? 'unknown',
        synopsis: userShow.synopsis ?? null,
        tmdb_id: userShow.tmdb_id ? String(userShow.tmdb_id) : '0',
        network: userShow.network ?? null,
        genre: userShow.genre ?? null,
        rating: userShow.show_rating ? parseFloat(userShow.show_rating) : null,
        first_air_date: userShow.first_air_date ?? null,
        updated_at: userShow.show_updated_at ?? null,
      },
      version: 'v3',
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
