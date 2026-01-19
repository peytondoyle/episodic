/**
 * One-time script to import existing Episodic users to Clerk.
 *
 * Prerequisites:
 * 1. Create Clerk application at dashboard.clerk.com
 * 2. Enable Email/Password and Apple Sign In
 * 3. Add CLERK_SECRET_KEY to .env.local
 * 4. Get password hash from Supabase
 *
 * Run with:
 *   npx tsx scripts/import-users-to-clerk.ts "YOUR_BCRYPT_HASH_HERE"
 */

import { config } from 'dotenv';
import { createClerkClient } from '@clerk/backend';

// Load .env.local
config({ path: '.env.local' });

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const PASSWORD_HASH = process.argv[2];

if (!CLERK_SECRET_KEY) {
  console.error('❌ Missing CLERK_SECRET_KEY in .env.local');
  console.error('   Add it from dashboard.clerk.com');
  process.exit(1);
}

if (!PASSWORD_HASH) {
  console.error('❌ Missing password hash argument');
  console.error('   Run: npx tsx scripts/import-users-to-clerk.ts "YOUR_HASH"');
  console.error('');
  console.error('   Get hash from Supabase SQL editor:');
  console.error("   SELECT encrypted_password FROM auth.users WHERE email = 'p6doyle@gmail.com';");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

// Episodic users to import
const users = [
  {
    email: 'p6doyle@gmail.com',
    supabaseId: '548f3665-61f7-4411-89e1-cc724903cfa1',
    provider: 'email' as const,
    passwordHash: PASSWORD_HASH,
  },
  {
    email: 'kaley.werder@gmail.com',
    supabaseId: '3ba378d6-20ce-4c50-9aee-e20ac498a99e',
    provider: 'apple' as const,
    passwordHash: null,
  },
];

async function importUsers() {
  for (const user of users) {
    console.log(`\nProcessing ${user.email}...`);

    // Check if user already exists in Clerk
    const existingUsers = await clerk.users.getUserList({
      emailAddress: [user.email],
    });

    if (existingUsers.data.length > 0) {
      const existing = existingUsers.data[0];

      // Update externalId if not set
      if (!existing.externalId) {
        await clerk.users.updateUser(existing.id, {
          externalId: user.supabaseId,
        });
        console.log(`  ✓ Updated externalId for existing user`);
      } else {
        console.log(`  ✓ User already exists with externalId: ${existing.externalId}`);
      }
      continue;
    }

    // Create new user
    if (user.provider === 'email' && user.passwordHash && user.passwordHash !== 'PASTE_BCRYPT_HASH_HERE') {
      // Email user with password
      await clerk.users.createUser({
        emailAddress: [user.email],
        externalId: user.supabaseId,
        passwordDigest: user.passwordHash,
        passwordHasher: 'bcrypt',
      });
      console.log(`  ✓ Created email user with password`);
    } else if (user.provider === 'apple') {
      // Apple user - they'll sign in with Apple, we'll link after
      console.log(`  ⚠ Apple user - will need to sign in with Apple first`);
      console.log(`    After they sign in, run:`);
      console.log(`    clerk.users.updateUser(THEIR_CLERK_ID, { externalId: '${user.supabaseId}' })`);
    } else {
      console.log(`  ⚠ Skipped - missing password hash`);
    }
  }

  console.log('\n✅ Import complete!');
  console.log('\nNext steps:');
  console.log('1. Have Apple users sign in with Apple');
  console.log('2. Set their externalId via Clerk dashboard or API');
}

importUsers().catch(console.error);
