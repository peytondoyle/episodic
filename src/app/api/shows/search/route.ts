import { NextRequest, NextResponse } from 'next/server';

const TMDB_API_KEY = process.env.TMDB_API_KEY!;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ results: [] });
    }

    const searchUrl = `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=1`;
    const response = await fetch(searchUrl);
    const data = await response.json();

    const results = data.results?.map((show: {
      id: number;
      name: string;
      poster_path: string | null;
      backdrop_path: string | null;
      first_air_date: string | null;
      overview: string | null;
      vote_average: number;
    }) => ({
      tmdb_id: show.id.toString(),
      title: show.name,
      poster_path: show.poster_path,
      backdrop_path: show.backdrop_path,
      first_air_date: show.first_air_date,
      overview: show.overview,
      vote_average: show.vote_average,
    })) || [];

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    );
  }
}
