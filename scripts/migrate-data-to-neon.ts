/**
 * Migrate data from Supabase to Neon
 * Run with: npx tsx scripts/migrate-data-to-neon.ts
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const sql = neon(process.env.DATABASE_URL!);

async function migrateData() {
  console.log('Starting data migration from Supabase to Neon...\n');

  // 1. Migrate shows
  console.log('Migrating shows...');
  const { data: shows, error: showsError } = await supabase
    .from('episodic_shows')
    .select('*');

  if (showsError) {
    console.error('Error fetching shows:', showsError);
    return;
  }

  for (const show of shows || []) {
    try {
      await sql`
        INSERT INTO episodic_shows (
          id, title, slug, poster_url, backdrop_url, status, synopsis, tmdb_id,
          network, genre, rating, first_air_date, created_at, updated_at,
          last_synced_at, air_time, air_time_source, air_timezone,
          watch_providers, watch_providers_updated_at
        ) VALUES (
          ${show.id}::uuid, ${show.title}, ${show.slug}, ${show.poster_url}, ${show.backdrop_url},
          ${show.status}, ${show.synopsis}, ${show.tmdb_id}, ${show.network}, ${show.genre},
          ${show.rating}, ${show.first_air_date}, ${show.created_at}, ${show.updated_at},
          ${show.last_synced_at}, ${show.air_time}, ${show.air_time_source}, ${show.air_timezone},
          ${show.watch_providers ? JSON.stringify(show.watch_providers) : null}, ${show.watch_providers_updated_at}
        )
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          slug = EXCLUDED.slug,
          poster_url = EXCLUDED.poster_url,
          backdrop_url = EXCLUDED.backdrop_url,
          status = EXCLUDED.status,
          synopsis = EXCLUDED.synopsis,
          tmdb_id = EXCLUDED.tmdb_id,
          network = EXCLUDED.network,
          genre = EXCLUDED.genre,
          rating = EXCLUDED.rating,
          first_air_date = EXCLUDED.first_air_date,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          last_synced_at = EXCLUDED.last_synced_at,
          air_time = EXCLUDED.air_time,
          air_time_source = EXCLUDED.air_time_source,
          air_timezone = EXCLUDED.air_timezone,
          watch_providers = EXCLUDED.watch_providers,
          watch_providers_updated_at = EXCLUDED.watch_providers_updated_at
      `;
    } catch (e) {
      console.error(`  Error migrating show ${show.title}:`, e);
    }
  }
  console.log(`  ✓ Migrated ${shows?.length || 0} shows`);

  // 2. Migrate episodes
  console.log('Migrating episodes...');
  const { data: episodes, error: episodesError } = await supabase
    .from('episodic_episodes')
    .select('*');

  if (episodesError) {
    console.error('Error fetching episodes:', episodesError);
    return;
  }

  let epCount = 0;
  for (const ep of episodes || []) {
    try {
      await sql`
        INSERT INTO episodic_episodes (
          id, show_id, season, episode, title, air_date, runtime, summary, still_url, created_at
        ) VALUES (
          ${ep.id}, ${ep.show_id}::uuid, ${ep.season}, ${ep.episode}, ${ep.title},
          ${ep.air_date}, ${ep.runtime}, ${ep.summary}, ${ep.still_url}, ${ep.created_at}
        )
        ON CONFLICT (id) DO UPDATE SET
          show_id = EXCLUDED.show_id,
          season = EXCLUDED.season,
          episode = EXCLUDED.episode,
          title = EXCLUDED.title,
          air_date = EXCLUDED.air_date,
          runtime = EXCLUDED.runtime,
          summary = EXCLUDED.summary,
          still_url = EXCLUDED.still_url,
          created_at = EXCLUDED.created_at
      `;
      epCount++;
    } catch (e) {
      console.error(`  Error migrating episode ${ep.id}:`, e);
    }
  }
  console.log(`  ✓ Migrated ${epCount} episodes`);

  // 3. Migrate user_shows
  console.log('Migrating user_shows...');
  const { data: userShows, error: userShowsError } = await supabase
    .from('episodic_user_shows')
    .select('*');

  if (userShowsError) {
    console.error('Error fetching user_shows:', userShowsError);
    return;
  }

  for (const us of userShows || []) {
    try {
      await sql`
        INSERT INTO episodic_user_shows (
          id, user_id, show_id, status, rating, added_at, updated_at
        ) VALUES (
          ${us.id}::uuid, ${us.user_id}::uuid, ${us.show_id}::uuid, ${us.status},
          ${us.rating}, ${us.added_at}, ${us.updated_at}
        )
        ON CONFLICT (user_id, show_id) DO UPDATE SET
          status = EXCLUDED.status,
          rating = EXCLUDED.rating,
          added_at = EXCLUDED.added_at,
          updated_at = EXCLUDED.updated_at
      `;
    } catch (e) {
      console.error(`  Error migrating user_show:`, e);
    }
  }
  console.log(`  ✓ Migrated ${userShows?.length || 0} user_shows`);

  // 4. Migrate user_episodes
  console.log('Migrating user_episodes...');
  const { data: userEpisodes, error: userEpisodesError } = await supabase
    .from('episodic_user_episodes')
    .select('*');

  if (userEpisodesError) {
    console.error('Error fetching user_episodes:', userEpisodesError);
    return;
  }

  let ueCount = 0;
  for (const ue of userEpisodes || []) {
    try {
      await sql`
        INSERT INTO episodic_user_episodes (
          id, user_id, episode_id, show_id, watched, watched_at, rating, notes, skipped, watch_source
        ) VALUES (
          ${ue.id}::uuid, ${ue.user_id}::uuid, ${ue.episode_id}, ${ue.show_id}::uuid,
          ${ue.watched}, ${ue.watched_at}, ${ue.rating}, ${ue.notes || null}, ${ue.skipped || false}, ${ue.watch_source}
        )
        ON CONFLICT (user_id, episode_id) DO UPDATE SET
          show_id = EXCLUDED.show_id,
          watched = EXCLUDED.watched,
          watched_at = EXCLUDED.watched_at,
          rating = EXCLUDED.rating,
          notes = EXCLUDED.notes,
          skipped = EXCLUDED.skipped,
          watch_source = EXCLUDED.watch_source
      `;
      ueCount++;
    } catch (e) {
      console.error(`  Error migrating user_episode:`, e);
    }
  }
  console.log(`  ✓ Migrated ${ueCount} user_episodes`);

  console.log('\n✅ Migration complete!');
}

migrateData().catch(console.error);
