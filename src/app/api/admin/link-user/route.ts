import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

// Known Episodic users from Supabase - map email to UUID
const KNOWN_USERS: Record<string, string> = {
  'p6doyle@gmail.com': '548f3665-61f7-4411-89e1-cc724903cfa1',
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
    const { clerk_user_id } = body;

    if (!clerk_user_id) {
      return NextResponse.json({ error: 'Missing clerk_user_id' }, { status: 400 });
    }

    const client = await clerkClient();

    // Get the user from Clerk
    const user = await client.users.getUser(clerk_user_id);
    const email = user.emailAddresses[0]?.emailAddress?.toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'User has no email' }, { status: 400 });
    }

    const supabaseId = KNOWN_USERS[email];
    if (!supabaseId) {
      return NextResponse.json({ error: `Unknown email: ${email}` }, { status: 400 });
    }

    // Update the user's externalId
    await client.users.updateUser(clerk_user_id, {
      externalId: supabaseId,
    });

    console.log(`[admin] Linked ${email} (${clerk_user_id}) to database UUID: ${supabaseId}`);

    return NextResponse.json({
      success: true,
      email,
      clerk_user_id,
      external_id: supabaseId,
    });
  } catch (error) {
    console.error('[admin] Link user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link user' },
      { status: 500 }
    );
  }
}
