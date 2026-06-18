import { auth } from '@clerk/nextjs/server';
import { sql } from './db';

/**
 * Get the database user ID for the currently authenticated Clerk user.
 * Looks up the mapping in user_id_mapping table (populated by webhook + backfill).
 */
export async function getDbUserId(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Unauthorized');
  }

  const result = await sql`
    SELECT db_user_id FROM user_id_mapping WHERE clerk_user_id = ${userId}
  `;

  if (result.length === 0) {
    throw new Error('User not linked to database. Contact support.');
  }

  return result[0].db_user_id;
}

/**
 * Get the Clerk user ID from the current session.
 * Throws if not authenticated.
 */
export async function requireAuth(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Unauthorized');
  }

  return userId;
}
