'use client';

import { useState } from 'react';
import { useAllShows } from '@/hooks/useShows';
import EpisodeModal from '@/components/EpisodeModal'; // make sure this path is right

export default function ShowsPage() {
  const { data, isLoading, error } = useAllShows();

  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [initialEpisodeId, setInitialEpisodeId] = useState<string | null>(null);

  if (isLoading) return <p className="p-4">Loading shows...</p>;
  if (error) return <p className="p-4 text-red-500">Error loading shows: {error.message}</p>;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">All Shows</h1>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.map(show => (
          <li
            key={show.id}
            className="border rounded-lg p-4 shadow hover:shadow-md transition cursor-pointer"
            onClick={() => {
              setSelectedShowId(show.id);
              setInitialEpisodeId(null); // or preload latest episode ID if desired
            }}
          >
            <h2 className="text-lg font-semibold">{show.title}</h2>
            {show.poster_url && (
                <img
                src={show.poster_url}
                alt={show.title}
                className="w-full h-auto mt-2 rounded"
                onError={(e) => {
                    e.currentTarget.src = "/fallback.png";
                }}
                />
            )}
            <p className="text-sm mt-1 italic text-gray-600">{show.status}</p>
            <p className="text-sm text-gray-600 mt-2">{show.platform}</p>
          </li>
        ))}
      </ul>

      {/* Modal Renderer */}
      {selectedShowId && (
        <EpisodeModal
          showId={selectedShowId}
          initialEpisodeId={initialEpisodeId}
          onClose={() => {
            setSelectedShowId(null);
            setInitialEpisodeId(null);
          }}
        />
      )}
    </div>
  );
}