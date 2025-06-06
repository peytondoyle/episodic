import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { episodeId, watched } = body;

  const { error } = await supabase
    .from("user_episodes")
    .update({
      watched,
      watched_at: watched ? new Date().toISOString() : null,
    })
    .eq("episode_id", episodeId);

  if (error) {
    console.error("Supabase update error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}