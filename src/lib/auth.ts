import { auth, clerkClient } from '@clerk/nextjs/server';

/**
 * Get the database user ID for the currently authenticated Clerk user.
 * Uses Clerk's externalId which stores the original Supabase UUID.
 * Falls back to publicMetadata.external_id if externalId is not set.
 */
export async function getDbUserId(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Unauthorized');
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  // Check externalId first, then fall back to publicMetadata
  const dbUserId = user.externalId ||
    (user.publicMetadata as { external_id?: string })?.external_id;

  if (!dbUserId) {
    throw new Error('User not linked to database. Contact support.');
  }

  return dbUserId;
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
