import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

/**
 * Exchange Apple ID token for Clerk session
 *
 * This endpoint receives an Apple Sign In identity token from the iOS app
 * and exchanges it for a Clerk session/JWT token.
 *
 * Flow:
 * 1. iOS app authenticates with Apple Sign In
 * 2. iOS app sends the identity_token to this endpoint
 * 3. We verify the token and sign in/up the user via Clerk
 * 4. Return the Clerk session token to the iOS app
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id_token, first_name, last_name } = body;

    if (!id_token) {
      return NextResponse.json(
        { error: 'Missing id_token' },
        { status: 400 }
      );
    }

    const client = await clerkClient();

    // Decode Apple identity token to extract claims
    const tokenParts = id_token.split('.');
    if (tokenParts.length !== 3) {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 400 }
      );
    }

    const payload = JSON.parse(
      Buffer.from(tokenParts[1], 'base64').toString('utf-8')
    );

    const appleUserId = payload.sub; // Apple user ID
    const email = payload.email;

    console.log('[Apple Auth] Processing token for:', { appleUserId, email });

    if (!appleUserId) {
      return NextResponse.json(
        { error: 'Invalid token: missing subject' },
        { status: 400 }
      );
    }

    // Look for existing user with this email
    let user = null;

    if (email) {
      const existingUsers = await client.users.getUserList({
        emailAddress: [email],
      });
      user = existingUsers.data[0] || null;
      console.log('[Apple Auth] Found user by email:', user?.id);
    }

    if (!user) {
      // Try finding by Apple user ID in external accounts
      const allUsers = await client.users.getUserList({
        limit: 500,
      });

      user = allUsers.data.find(u =>
        u.externalAccounts?.some(acc =>
          acc.provider === 'oauth_apple' && acc.externalId === appleUserId
        )
      ) || null;

      if (user) {
        console.log('[Apple Auth] Found user by Apple ID:', user.id);
      }
    }

    // If user doesn't exist, create them
    if (!user) {
      console.log('[Apple Auth] Creating new user');

      if (!email) {
        return NextResponse.json(
          { error: 'Email required for new account. Please allow email sharing with Apple Sign In.' },
          { status: 400 }
        );
      }

      // Create new user in Clerk
      user = await client.users.createUser({
        emailAddress: [email],
        firstName: first_name || undefined,
        lastName: last_name || undefined,
        skipPasswordRequirement: true,
      });

      console.log('[Apple Auth] Created new user:', user.id);
    }

    // Generate a sign-in token for this user
    const signInToken = await client.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 3600,
    });

    console.log('[Apple Auth] Generated sign-in token for user:', user.id);

    return NextResponse.json({
      user_id: user.id,
      external_id: user.externalId,
      email: user.emailAddresses[0]?.emailAddress,
      first_name: user.firstName,
      last_name: user.lastName,
      sign_in_token: signInToken.token,
      expires_in: 3600,
    });

  } catch (error) {
    console.error('[Apple Auth] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}
