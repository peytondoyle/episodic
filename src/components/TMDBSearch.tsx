"use client";

import { useState } from "react";
import { insertShowFromTMDB } from "@/lib/shows";
import { searchTMDB } from "@/lib/tmdb";
import { getShowDetails } from "@/lib/tmdb";

type TMDBResult = {
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  first_air_date: string;
};

export default function TMDBSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TMDBResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<number[]>([]);

  const handleSearch = async () => {
    setLoading(true);
    const data = await searchTMDB(query);
    setResults(data.results); // <--- unwrap the results field
  };

const handleAdd = async (show: TMDBResult) => {
  try {
    const details = await getShowDetails(show.id);

    await insertShowFromTMDB({
      ...show,
      status: details.status,
      homepage: details.homepage,
    });

    setAdded((prev) => [...prev, show.id]);
  } catch (err) {
    alert("Error adding show. Check console.");
    console.error(err);
  }
};

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          className="border px-3 py-2 w-full rounded"
          placeholder="Search TMDB shows..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query}
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {results.map((show) => (
          <div key={show.id} className="border rounded p-2">
            <img
                src={
                    show.poster_path
                    ? `https://image.tmdb.org/t/p/w300${show.poster_path}`
                    : "https://placehold.co/300x450?text=No+Poster&font=roboto&size=24"
                }
                alt={show.name}
                className="w-full rounded"
                />
            <h2 className="text-sm font-semibold mt-2">{show.name}</h2>
            <button
              onClick={() => handleAdd(show)}
              disabled={added.includes(show.id)}
              className={`mt-2 px-3 py-1 rounded text-sm ${
                added.includes(show.id)
                  ? "bg-green-500 text-white"
                  : "bg-black text-white"
              }`}
            >
              {added.includes(show.id) ? "Added" : "Add"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}