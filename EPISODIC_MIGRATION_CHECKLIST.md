# Episodic Reference Migration

**Scope**: Episodic only. All other repos are out of scope until this ships successfully.

**Architecture**: Clerk (auth) + Neon (database) + Vercel (API routes)

**Deferred**: R2 storage, RLS policies, Drizzle ORM, all other repos

---

## Phase 1: Auth + API (ship to TestFlight)

### 1.1 Clerk Setup
- [ ] Create Clerk application at dashboard.clerk.com
- [ ] Configure Apple Sign In in Clerk Dashboard
- [ ] Get `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- [ ] Set up webhook endpoint, get `CLERK_WEBHOOK_SECRET`

### 1.2 User Import
- [ ] Export users from Supabase (email, id, provider)
- [ ] Export password hashes via SQL: `SELECT id, email, encrypted_password FROM auth.users`
- [ ] Import email/password users to Clerk with bcrypt hashes
- [ ] Verify: imported user can log in with original password

### 1.3 Neon Database
- [ ] Create Neon project: `episodic-prod`
- [ ] Export schema from `episodic-ios/supabase/migrations`
- [ ] Apply schema to Neon (no RLS policies yet)
- [ ] Create `users` table (canonical app user, keyed by clerk_user_id)
- [ ] Backfill data: shows, episodes, watch_history, ratings
- [ ] Populate users table for imported users (preserving original UUIDs)
- [ ] Verify row counts match Supabase

```sql
-- users table (not a separate mapping table)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- All other tables reference users.id
-- Foreign key: user_id UUID REFERENCES users(id)
```

### 1.4 Backend API
- [ ] Create `episodic-api` Next.js project
- [ ] Install `@clerk/nextjs` and `@neondatabase/serverless`
- [ ] Set up Clerk middleware
- [ ] Implement `getDbUserId()` helper (lookup by clerk_user_id)
- [ ] Create `/api/webhooks/clerk` for new user sync (idempotent: `ON CONFLICT DO NOTHING`)

Port edge functions (plain SQL, no ORM):
- [ ] `/api/shows/search`, `/api/shows/add`, `/api/shows/[id]/import`
- [ ] `/api/shows/user`, `/api/shows/[id]/status`, `/api/shows/[id]/refresh`, `/api/shows/[id]/rate`
- [ ] `/api/episodes/calendar`, `/api/episodes/up-next`, `/api/episodes/[id]/toggle`, `/api/episodes/[id]/rate`
- [ ] `/api/seasons/[id]/watched`
- [ ] `/api/history`, `/api/statistics`
- [ ] `/api/internal/cron/refresh-all-shows` + vercel.json (protected by cron secret, NOT Clerk auth)

### 1.5 iOS App Update
- [ ] Add Clerk iOS SDK via SPM
- [ ] Configure Clerk in App.swift
- [ ] Update API base URL
- [ ] Implement Clerk auth (Apple Sign In, Email/Password)
- [ ] Update all API calls to use Clerk session token
- [ ] Remove Supabase Swift package
- [ ] TestFlight build

### 1.6 Environment Variables
- [ ] Create `~/.secrets/episodic.env` with Clerk + Neon credentials
- [ ] Run sync script to push to Vercel production
- [ ] Verify preview deployments use Clerk dev keys

---

## Phase 1 Success Criteria

**Phase 1 is complete when:**
- [ ] Imported users can sign in with original password
- [ ] Apple Sign In creates account + webhook creates mapping
- [ ] All 16 edge functions ported and returning correct data
- [ ] TestFlight build works end-to-end
- [ ] Zero Supabase calls in iOS app

**Ship to TestFlight. Observe 7-14 days.**

---

## Phase 2: Storage + Polish (after stability)

### 2.1 R2 Migration
- [ ] Create R2 bucket: `episodic-uploads`
- [ ] Set up custom domain (not r2.dev)
- [ ] Migrate profile images from Supabase Storage
- [ ] Rewrite URLs in database
- [ ] Create `/api/upload` presigned URL endpoint
- [ ] Update iOS to use R2 for new uploads

### 2.2 Hardening
- [ ] Add RLS policies (defense-in-depth)
- [ ] Add rate limiting (Upstash Redis)
- [ ] Add Drizzle ORM for type safety (optional)

### 2.3 Cleanup
- [ ] Remove Supabase env vars from Vercel
- [ ] Delete Supabase project (after 30-day observation)

---

## Do Not Touch During Episodic Phase

- Wishlist
- Verdant
- Capsule
- Tabby
- All side projects

These become copy-paste exercises after Episodic ships.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth | Clerk | Apple + SMS + Email, iOS SDK, bcrypt import |
| Database | Neon (plain SQL) | Simple, no ORM overhead during migration |
| Storage | Supabase (read-only) | Defer R2 to Phase 2, reduce risk |
| RLS | Disabled | Enforce auth in API routes only, add later |
| ORM | None | Plain SQL via @neondatabase/serverless |

---

## Quick Reference

```typescript
// Clerk user import (with bcrypt hash)
await clerkClient.users.createUser({
  emailAddress: [email],
  passwordHasher: 'bcrypt',
  passwordDigest: hash,
  externalId: supabaseUuid,  // preserves original DB UUID
});

// API route auth check — use auth(), not manual JWT parsing
import { auth } from '@clerk/nextjs/server';

const { userId } = await auth();
if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

const dbUserId = await getDbUserId(userId);

// Plain SQL query
const shows = await sql`
  SELECT * FROM shows WHERE user_id = ${dbUserId}::uuid
`;

// Webhook idempotency
await sql`
  INSERT INTO users (id, clerk_user_id, email)
  VALUES (${externalId || 'gen_random_uuid()'}, ${clerkUserId}, ${email})
  ON CONFLICT (clerk_user_id) DO NOTHING
`;
```

---

## Rollback

If anything goes wrong:
1. iOS app still has Supabase code until TestFlight passes
2. Supabase stays up throughout migration
3. Neon project is additive — just don't switch to it
4. Clerk users can be deleted, Supabase auth still works

Migration is not committed until App Store submission.
