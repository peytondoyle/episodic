import { auth, clerkClient } from '@clerk/nextjs/server';

/**
 * Get the database user ID for the currently authenticated Clerk user.
 * Uses Clerk's externalId which stores the original Supabase UUID.
 */
export async function getDbUserId(): Promise<string> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error('Unauthorized');
  }

  const client = await clerkClient();
  const user = await client.users.getUser(userId);

  if (!user.externalId) {
    throw new Error('User not linked to database. Contact support.');
  }

  return user.externalId;
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
