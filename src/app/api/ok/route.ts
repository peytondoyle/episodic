import { NextResponse } from "next/server";

export function GET() {
  const must = [
    "DATABASE_URL",
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SECRET",
    "TMDB_API_KEY",
    "CRON_SECRET",
  ];
  const missing = must.filter((k) => !process.env[k]);
  return NextResponse.json({
    env: process.env.VERCEL_ENV,
    ok: missing.length === 0,
    missing,
  });
}
