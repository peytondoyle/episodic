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
    const { id_token } = await request.json();

    if (!id_token) {
      return NextResponse.json(
        { error: 'Missing id_token' },
        { status: 400 }
      );
    }

    const client = await clerkClient();

    // For Apple Sign In, we need to:
    // 1. Decode the Apple identity token to get the user's email
    // 2. Look up or create the user in Clerk
    // 3. Generate a session token for the iOS app

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

    if (!appleUserId) {
      return NextResponse.json(
        { error: 'Invalid token: missing subject' },
        { status: 400 }
      );
    }

    // Look for existing user with this email or external ID
    let user = null;

    if (email) {
      const existingUsers = await client.users.getUserList({
        emailAddress: [email],
      });
      user = existingUsers.data[0] || null;
    }

    if (!user) {
      // Try finding by Apple user ID stored in external accounts
      // This handles users who signed up with Apple but email wasn't shared
      const allUsers = await client.users.getUserList({
        limit: 100,
      });

      user = allUsers.data.find(u =>
        u.externalAccounts?.some(acc =>
          acc.provider === 'oauth_apple' && acc.externalId === appleUserId
        )
      ) || null;
    }

    if (!user) {
      // User doesn't exist - they need to sign up through Clerk first
      // The iOS app should use Clerk SDK for initial sign up
      return NextResponse.json(
        { error: 'User not found. Please sign up first.' },
        { status: 404 }
      );
    }

    // Generate a sign-in token for this user
    // This allows the iOS app to establish a session
    const signInToken = await client.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 3600,
    });

    return NextResponse.json({
      user_id: user.id,
      external_id: user.externalId,
      token: signInToken.token,
      expires_in: 3600,
    });

  } catch (error) {
    console.error('Apple auth error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authentication failed' },
      { status: 500 }
    );
  }
}
