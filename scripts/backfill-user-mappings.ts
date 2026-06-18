/**
 * One-time script to backfill user_id_mapping table from existing Clerk users.
 *
 * For each Clerk user with an externalId (set during Supabase import),
 * inserts a row into user_id_mapping so getDbUserId() can resolve via DB.
 *
 * Safe to run multiple times (ON CONFLICT DO NOTHING).
 *
 * Run with:
 *   npx tsx scripts/backfill-user-mappings.ts
 */

import { config } from 'dotenv';
import { createClerkClient } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY) {
  console.error('Missing CLERK_SECRET_KEY in .env.local');
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const sql = neon(DATABASE_URL);

async function backfill() {
  // Fetch all Clerk users (paginated)
  let offset = 0;
  const limit = 100;
  let totalInserted = 0;
  let totalSkipped = 0;

  while (true) {
    const { data: users } = await clerk.users.getUserList({ limit, offset });

    if (users.length === 0) break;

    for (const user of users) {
      const dbUserId =
        user.externalId ||
        (user.publicMetadata as { external_id?: string })?.external_id;

      if (!dbUserId) {
        console.log(`  Skipping ${user.emailAddresses[0]?.emailAddress ?? user.id} — no externalId`);
        totalSkipped++;
        continue;
      }

      const email = user.emailAddresses[0]?.emailAddress ?? null;

      const result = await sql`
        INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
        VALUES (${user.id}, ${dbUserId}::uuid, ${email})
        ON CONFLICT (clerk_user_id) DO NOTHING
      `;

      // neon returns the number of affected rows
      if (result.length === 0) {
        console.log(`  Already exists: ${email ?? user.id}`);
      } else {
        console.log(`  Inserted: ${email ?? user.id} -> ${dbUserId}`);
        totalInserted++;
      }
    }

    offset += users.length;
    if (users.length < limit) break;
  }

  console.log(`\nDone. Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
