// src/hooks/useUserShows.ts
import { useQuery } from "@tanstack/react-query";
import { getUserShows } from "@/lib/userShows";

export function useUserShows(userId: string | null) {
  return useQuery({
    queryKey: ["userShows", userId],
    queryFn: () => getUserShows(userId!),
    enabled: !!userId,
  });
}