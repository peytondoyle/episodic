import { NextResponse } from 'next/server';
import { getDbUserId } from '@/lib/auth';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const userId = await getDbUserId();

    // Get all watched episodes (excluding bulk imports)
    const watchedEpisodes = await sql`
      SELECT
        ue.watched,
        ue.watched_at,
        ue.show_id,
        e.runtime
      FROM episodic_user_episodes ue
      JOIN episodic_episodes e ON e.id = ue.episode_id
      WHERE ue.user_id = ${userId}::uuid
        AND ue.watched = true
        AND (ue.watch_source IS NULL OR ue.watch_source = 'manual')
    `;

    // Get user shows with genres
    const userShows = await sql`
      SELECT
        us.status,
        s.id as show_id,
        s.genre
      FROM episodic_user_shows us
      JOIN episodic_shows s ON s.id = us.show_id
      WHERE us.user_id = ${userId}::uuid
    `;

    // Calculate statistics
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total episodes watched
    const totalEpisodesWatched = watchedEpisodes.length;

    // Total watch time in minutes
    const totalWatchTimeMinutes = watchedEpisodes.reduce((total, ep) => {
      return total + (ep.runtime || 0);
    }, 0);

    // Shows tracking and completed
    const showsTracking = userShows.length;
    const showsCompleted = userShows.filter(s => s.status === 'completed').length;

    // Episodes this month
    const episodesThisMonth = watchedEpisodes.filter(ep => {
      if (!ep.watched_at) return false;
      const watchedDate = new Date(ep.watched_at);
      return watchedDate >= startOfMonth;
    }).length;

    // Episodes this week
    const episodesThisWeek = watchedEpisodes.filter(ep => {
      if (!ep.watched_at) return false;
      const watchedDate = new Date(ep.watched_at);
      return watchedDate >= startOfWeek;
    }).length;

    // Top genres - count by show's genre
    const showGenreMap = new Map<string, string>();
    userShows.forEach(us => {
      if (us.show_id && us.genre) {
        showGenreMap.set(us.show_id, us.genre);
      }
    });

    const genreCountMap = new Map<string, number>();
    watchedEpisodes.forEach(ep => {
      const genre = showGenreMap.get(ep.show_id);
      if (genre) {
        genreCountMap.set(genre, (genreCountMap.get(genre) || 0) + 1);
      }
    });

    const topGenres = Array.from(genreCountMap.entries())
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Watching streak - count consecutive days with watched episodes
    let watchingStreakDays = 0;
    if (watchedEpisodes.length > 0) {
      const watchedDates = new Set<string>();
      watchedEpisodes.forEach(ep => {
        if (ep.watched_at) {
          const date = new Date(ep.watched_at);
          watchedDates.add(date.toISOString().split('T')[0]);
        }
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayStr = today.toISOString().split('T')[0];
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (watchedDates.has(todayStr) || watchedDates.has(yesterdayStr)) {
        let checkDate = watchedDates.has(todayStr) ? today : yesterday;

        while (watchedDates.has(checkDate.toISOString().split('T')[0])) {
          watchingStreakDays++;
          checkDate = new Date(checkDate);
          checkDate.setDate(checkDate.getDate() - 1);
        }
      }
    }

    // Average episodes per day (over the last 30 days)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    const episodesLast30Days = watchedEpisodes.filter(ep => {
      if (!ep.watched_at) return false;
      const watchedDate = new Date(ep.watched_at);
      return watchedDate >= thirtyDaysAgo;
    }).length;

    const averageEpisodesPerDay = Math.round((episodesLast30Days / 30) * 10) / 10;

    const statistics = {
      total_episodes_watched: totalEpisodesWatched,
      total_watch_time_minutes: totalWatchTimeMinutes,
      shows_tracking: showsTracking,
      shows_completed: showsCompleted,
      episodes_this_month: episodesThisMonth,
      episodes_this_week: episodesThisWeek,
      top_genres: topGenres,
      watching_streak_days: watchingStreakDays,
      average_episodes_per_day: averageEpisodesPerDay,
    };

    return NextResponse.json(statistics);
  } catch (error) {
    console.error('Error fetching statistics:', error);
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
  }
}
