'use client';

import { useEffect, useState } from "react";
import { useUserId } from "@/hooks/useUserId";
import { getUserShowsWithEpisodes } from "@/lib/userShows";
import EpisodeModal from "@/components/EpisodeModal"; // make sure this exists

type WatchedEpisode = {
  watched: boolean;
  watched_at: string | null;
  episode_id: string;
  episodes: {
    id: string;
    season: number;
    episode: number;
    title: string;
  };
};

type UserShowWithEpisodes = {
  show_id: string;
  episodes: WatchedEpisode[];
  shows: {
    id: string;
    title: string;
    slug: string;
  };
};

export default function WatchlistPage() {
  const userId = useUserId();
  const [shows, setShows] = useState<UserShowWithEpisodes[]>([]);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [initialEpisodeId, setInitialEpisodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    getUserShowsWithEpisodes(userId).then(setShows);
  }, [userId]);

  const unwatchedShows = shows.filter(show =>
    show.episodes?.some(ep => !ep.watched)
  );

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Watchlist</h1>
      {unwatchedShows.length === 0 ? (
        <p className="text-gray-500">You're all caught up!</p>
      ) : (
        <div className="space-y-6">
          {unwatchedShows.map(entry => (
            <div key={entry.show_id} className="border p-4 rounded-lg shadow-sm">
              <h2 className="text-xl font-semibold mb-2">{entry.shows?.title}</h2>
              <div className="space-y-2">
                {groupEpisodesBySeason(entry.episodes).map(([season, episodes]) => (
                  <div key={season}>
                    <h3 className="text-lg font-medium">Season {season}</h3>
                    <ul className="pl-4 list-disc">
                      {episodes.map(ep => (
                        <li
                          key={ep.episode_id}
                          className="cursor-pointer hover:text-blue-600"
                          onClick={() => {
                            setSelectedShowId(entry.show_id);
                            setInitialEpisodeId(ep.episode_id);
                          }}
                        >
                          {ep.episodes?.title || `Episode ${ep.episodes?.episode}`}{" "}
                          {!ep.watched && (
                            <span className="text-sm text-red-500">(Unwatched)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedShowId && initialEpisodeId && (
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

// Helper
function groupEpisodesBySeason(episodes: WatchedEpisode[] = []): [number, WatchedEpisode[]][] {
  const map = new Map<number, WatchedEpisode[]>();
  for (const ep of episodes) {
    const season = ep.episodes?.season ?? 0;
    if (!map.has(season)) map.set(season, []);
    map.get(season)!.push(ep);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}