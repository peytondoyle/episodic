// src/app/search/page.tsx
import TMDBSearch from "@/components/TMDBSearch";

export default function SearchPage() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Search TMDB</h1>
      <TMDBSearch />
    </div>
  );
}