/* src/app/admin/page.tsx */

'use client';

import { useState } from 'react';
import { searchShows, getShowDetails } from '@/lib/tmdb';

export default function AdminPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const data = await searchShows(query);
    setResults(data.results || []);
    setLoading(false);
  }

  async function handleImport(tmdbId: number) {
    const showDetails = await getShowDetails(tmdbId);
    console.log('Fetched TMDB details:', showDetails);
    // You’ll later insert this into Supabase
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Admin: Add Show from TMDB</h1>
      <form onSubmit={handleSearch} className="mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search TV shows..."
          className="border px-3 py-2 rounded w-full"
        />
        <button
          type="submit"
          className="mt-2 bg-blue-600 text-white px-4 py-2 rounded"
          disabled={loading}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <ul className="grid gap-4">
          {results.map((show) => (
            <li key={show.id} className="border rounded p-4 flex items-center justify-between">
              <div>
                <strong>{show.name}</strong>
                <p className="text-sm text-gray-600">TMDB ID: {show.id}</p>
              </div>
              <button
                className="bg-green-600 text-white px-3 py-1 rounded"
                onClick={() => handleImport(show.id)}
              >
                Import
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}