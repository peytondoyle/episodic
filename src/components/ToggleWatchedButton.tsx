"use client";

import { useState } from "react";

type Props = {
  episodeId: string;
  watched: boolean;
};

export default function ToggleWatchedButton({ episodeId, watched }: Props) {
  const [isWatched, setIsWatched] = useState(watched);
  const [loading, setLoading] = useState(false);

  const toggleWatched = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/toggle-watched`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId, watched: !isWatched }),
      });

      if (!res.ok) throw new Error("Failed to update watched status");
      setIsWatched(!isWatched);
    } catch (err) {
      console.error("Error toggling watched:", err);
      alert("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={toggleWatched}
      disabled={loading}
      className={`px-2 py-1 text-sm rounded ${
        isWatched ? "bg-green-500 text-white" : "bg-gray-200 text-gray-800"
      }`}
    >
      {loading ? "Saving..." : isWatched ? "Watched" : "Mark Watched"}
    </button>
  );
}