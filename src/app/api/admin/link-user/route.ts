import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

// Known Episodic users from Supabase - map email to UUID
const KNOWN_USERS: Record<string, string> = {
  'p6doyle@gmail.com': '548f3665-61f7-4411-89e1-cc724903cfa1',
  'peyton.doyle@icloud.com': '548f3665-61f7-4411-89e1-cc724903cfa1',
  'kaley.werder@gmail.com': '3ba378d6-20ce-4c50-9aee-e20ac498a99e',
};

/**
 * Admin endpoint to link a Clerk user to their database UUID
 * POST /api/admin/link-user
 * Body: { clerk_user_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clerk_user_id, external_id } = body;

    if (!clerk_user_id) {
      return NextResponse.json({ error: 'Missing clerk_user_id' }, { status: 400 });
    }

    const client = await clerkClient();

    // Get the user from Clerk
    const user = await client.users.getUser(clerk_user_id);
    const email = user.emailAddresses[0]?.emailAddress?.toLowerCase();

    // Use provided external_id or look up from known users
    let targetExternalId = external_id;
    if (!targetExternalId && email) {
      targetExternalId = KNOWN_USERS[email];
    }

    if (!targetExternalId) {
      return NextResponse.json({
        error: `No external_id provided and email not in known users: ${email}`
      }, { status: 400 });
    }

    // First, set publicMetadata (this should always work)
    await client.users.updateUser(clerk_user_id, {
      publicMetadata: {
        external_id: targetExternalId,
      },
    });
    console.log(`[admin] Set publicMetadata for ${email} (${clerk_user_id}): ${targetExternalId}`);

    // Try to also set externalId (may fail if taken by another user)
    try {
      await client.users.updateUser(clerk_user_id, {
        externalId: targetExternalId,
      });
      console.log(`[admin] Also set externalId: ${targetExternalId}`);
    } catch (externalIdError) {
      console.log(`[admin] Could not set externalId (may be taken):`, externalIdError);
      // This is OK - publicMetadata is set and iOS will use that
    }

    return NextResponse.json({
      success: true,
      email,
      clerk_user_id,
      external_id: targetExternalId,
    });
  } catch (error: unknown) {
    console.error('[admin] Link user error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
    console.error('[admin] Error details:', errorDetails);
    return NextResponse.json(
      { error: errorMessage, details: errorDetails },
      { status: 500 }
    );
  }
}
