// src/hooks/useShows.ts
import { useQuery } from "@tanstack/react-query";
import { getAllShows, getShowBySlug, searchShows } from "@/lib/shows";

export function useAllShows() {
  return useQuery({
    queryKey: ["shows"],
    queryFn: getAllShows,
  });
}

export function useShowBySlug(slug: string) {
  return useQuery({
    queryKey: ["show", slug],
    queryFn: () => getShowBySlug(slug),
    enabled: !!slug,
  });
}

export function useShowSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => searchShows(query),
    enabled: !!query,
  });
}