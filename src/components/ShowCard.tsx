import type { Database } from "@/lib/types";

type Show = Database["public"]["Tables"]["shows"]["Row"];

export default function ShowCard({ show }: { show: Show }) {
  return (
    <div className="border rounded-lg p-4 shadow-sm hover:shadow-md transition">
      <img src={show.poster_url || ""} alt={show.title} className="w-full h-64 object-cover rounded" />
      <h2 className="mt-2 font-bold text-lg">{show.title}</h2>
      <p className="text-sm text-gray-500">{show.platform}</p>
      <p className="text-sm mt-1">{show.synopsis}</p>
    </div>
  );
}