import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// DEBUG ENDPOINT - returns sample show data structure
// Remove this after debugging
export async function GET() {
  try {
    // Use the same query as the main endpoint
    const userId = '548f3665-61f7-4411-89e1-cc724903cfa1'; // Test user

    const userShows = await sql`
      SELECT
        us.id,
        us.user_id,
        us.show_id,
        us.status,
        us.rating,
        us.added_at,
        us.updated_at,
        s.id as show_id,
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
      WHERE us.user_id = ${userId}::uuid
      ORDER BY us.updated_at DESC
      LIMIT 20
    `;

    if (userShows.length === 0) {
      return NextResponse.json({ debug: 'no shows for user' });
    }

    // Build the exact response structure the main endpoint uses
    const allShows = userShows.map(userShow => ({
      show: {
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
      user_show: {
        id: String(userShow.id),
        user_id: String(userShow.user_id),
        show_id: String(userShow.show_id),
        status: userShow.status ?? 'watching',
        rating: userShow.rating ? parseInt(userShow.rating, 10) : null,
        added_at: userShow.added_at ?? null,
        updated_at: userShow.updated_at ?? null,
      },
      watched_count: 0,
      total_count: 0,
      next_episode: null,
    }));

    return NextResponse.json({
      shows: allShows,
      count: allShows.length,
      version: 'v6',
    });
  } catch (error) {
    console.error('Debug error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
