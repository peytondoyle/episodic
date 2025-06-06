"use client";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { getShowDetailsWithUserProgress } from "@/lib/shows";
import ToggleWatchedButton from "../components/ToggleWatchedButton";

export default function EpisodeModal({
  showId,
  initialEpisodeId,
  onClose,
}: {
  showId: string;
  initialEpisodeId?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await getShowDetailsWithUserProgress(showId);
        setData(result);
      } catch (err) {
        console.error("🚨 Failed to load show details:", err);
        setError("Failed to load episode data.");
      }
    };
    fetch();
  }, [showId]);

  if (error) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>{error}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (!data) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent aria-describedby="dialog-description">
        <DialogHeader>
          <DialogTitle>{data.show.title}</DialogTitle>
          <DialogDescription id="dialog-description">
            Select an episode below to mark it watched
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {data.episodes.map((ep: any) => (
            <div
              key={ep.id}
              className={`p-2 border rounded ${
                ep.id === initialEpisodeId ? "bg-yellow-50" : ""
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-medium">
                    S{ep.season}E{ep.episode}: {ep.title}
                  </div>
                  <div className="text-sm text-gray-600">{ep.air_date}</div>
                </div>
                <ToggleWatchedButton episodeId={ep.id} watched={ep.userWatched} />
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}