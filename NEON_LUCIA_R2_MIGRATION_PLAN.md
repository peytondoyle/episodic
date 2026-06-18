# Neon + Clerk + R2 Migration Plan (All Repos)

This plan covers every repo in `/Users/peyton/Documents/Development` and moves each app to:

- **Clerk** for auth (supports Apple, SMS, Email)
- **Neon** for Postgres database
- **R2** for file storage (Cloudflare, zero egress fees)
- **Vercel API routes** to replace Supabase edge functions

**Migration strategy**: Full decoupling from Supabase. Each app gets its own Neon database and Clerk application. No shared auth = no shared failure domain.

**Key insight**: Clerk can **import users with bcrypt password hashes** — most users won't need to reset passwords! Use Clerk's Backend API to import existing users.

**Auth migration reality**:
- **OAuth users** (Apple/Google): Seamless — they sign in again and Clerk creates their account
- **Email/password users**: Import with bcrypt hashes via Clerk Backend API (no forced password reset!)

**What IS mostly find/replace**: Database queries, RLS policy syntax.

**What is NOT find/replace**: Auth (new SDK), Edge functions → API routes (different runtime, error handling, secrets, timeouts). Plan for real porting work there.

---

## Table of Contents

1. [Key Decisions (Revised)](#key-decisions-revised)
2. [Environment Variable Management](#environment-variable-management)
3. [Scan Highlights](#scan-highlights-supabase-usage-confirmed)
4. [Risk Matrix](#risk-matrix)
5. [Template Backend (Build Once Per Stack Type)](#template-backend)
6. [Global Migration Blueprint](#global-migration-blueprint)
7. [Testing Strategy](#testing-strategy)
8. [Rollback Strategy](#rollback-strategy)
9. [Decommission Criteria](#decommission-criteria)
10. [Repo Priority Tiers](#repo-priority-tiers)
11. [Repo-by-Repo Plan](#repo-by-repo-plan)
12. [Archived Repos](#archived-repos-archive)

---

## Key Decisions (Revised)

### Auth: Clerk

**Problem**: Multiple apps currently share the same Supabase Auth instance. One misconfiguration, outage, or rate limit affects everything. This coupling must be eliminated.

**Solution**: [Clerk](https://clerk.com) for authentication with dedicated Clerk applications per project:

```typescript
// src/middleware.ts
import { clerkMiddleware } from '@clerk/nextjs/server';
export default clerkMiddleware();

// src/app/api/shows/route.ts
import { getAuth } from '@clerk/nextjs/server';
import { neon } from '@neondatabase/serverless';

export async function GET(request: Request) {
  const { userId } = getAuth(request);
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Map Clerk ID to database UUID (see User ID Mapping section)
  const dbUserId = await getDbUserId(userId);
  const sql = neon(process.env.DATABASE_URL!);
  const shows = await sql`SELECT * FROM shows WHERE user_id = ${dbUserId}`;
  return Response.json(shows);
}
```

**Why Clerk:**

| Benefit | Detail |
|---------|--------|
| **Full auth method support** | Apple Sign In, SMS/Phone, Email/Password, Google, etc. |
| **iOS SDK** | Native `ClerkSDK` for Swift with prebuilt UI components |
| **User import with passwords** | Import bcrypt hashes via Backend API (no forced password reset!) |
| **User management dashboard** | Admin UI for managing users, sessions, organizations |
| **Webhooks** | Real-time user sync to your database |
| **One application per app** | Full isolation, no shared failure domains |

**Clerk pricing**: Free tier includes 10,000 monthly active users. Production apps need Pro ($25/mo + usage).

**How to enable**: Create a Clerk application at [dashboard.clerk.com](https://dashboard.clerk.com). Configure OAuth providers (Apple, Google) in Clerk Dashboard → User & Authentication → Social connections.

### User Migration Strategy

**Good news**: Clerk can **import users with bcrypt password hashes** — no forced password reset for most users!

| User Type | Migration Experience |
|-----------|---------------------|
| **OAuth users** (Apple/Google) | Sign in again → seamless (Clerk creates their account) |
| **Email/password users** | Import via Clerk Backend API with bcrypt hash → seamless login |

**How Clerk user import works:**
- Clerk's Backend API accepts `password_hasher: "bcrypt"` with the hash
- Users log in with their existing password — no reset required
- [Clerk Migration Guide](https://clerk.com/docs/deployments/migrate-overview)

**Import users via Clerk Backend API:**
```typescript
import { clerkClient } from '@clerk/clerk-sdk-node';

// Import a user with their bcrypt password hash
await clerkClient.users.createUser({
  emailAddress: ['user@example.com'],
  passwordHasher: 'bcrypt',
  passwordDigest: '$2a$10$...', // bcrypt hash from Supabase
  skipPasswordChecks: true,
  externalId: 'supabase-uuid-here', // Store old ID for mapping
});
```

**Critical step**: Clerk uses string IDs like `user_2abc123` while your database uses UUIDs. Create a mapping table (see User ID Mapping section below).

### Database Access Modes (Be Explicit)

With Clerk handling auth separately, database access is simpler. Two main modes:

| Mode | Env Var | Use For |
|------|---------|---------|
| **Direct Postgres** (Drizzle/SQL) | `DATABASE_URL` | Complex backend logic, migrations, admin scripts |
| **Serverless driver** (`@neondatabase/serverless`) | `DATABASE_URL` | Vercel functions with connection pooling |

**Recommended approach**: Use `@neondatabase/serverless` for all API routes (HTTP driver for stateless Vercel functions).

**Don't mix modes carelessly in the same request** — each has different connection semantics.

### User ID Mapping

Clerk uses string IDs like `user_2abc123` while your database uses UUIDs. Create a mapping table:

```sql
CREATE TABLE user_id_mapping (
  clerk_user_id TEXT PRIMARY KEY,
  db_user_id UUID NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for reverse lookup
CREATE INDEX idx_user_mapping_db_id ON user_id_mapping(db_user_id);
```

**Lookup helper:**
```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function getDbUserId(clerkUserId: string): Promise<string | null> {
  const result = await sql`
    SELECT db_user_id FROM user_id_mapping WHERE clerk_user_id = ${clerkUserId}
  `;
  return result[0]?.db_user_id ?? null;
}

export async function createUserMapping(clerkUserId: string, email: string): Promise<string> {
  const result = await sql`
    INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
    VALUES (${clerkUserId}, gen_random_uuid(), ${email})
    RETURNING db_user_id
  `;
  return result[0].db_user_id;
}
```

**When to create mappings:**
- **Imported users**: Create mapping during import script (Clerk `externalId` = old Supabase UUID)
- **New users**: Create mapping via Clerk webhook on `user.created` event
- **OAuth users**: Create mapping on first sign-in via webhook

### Security Boundaries

**Pick one primary enforcement and be consistent.** Recommendation:

| Layer | Responsibility |
|-------|---------------|
| **Database RLS** (primary) | Row-level access control — users can only see/modify their own data |
| **API routes** | Non-row-level rules: admin ops, cross-table invariants, rate limiting, audit logging |

**Why RLS as primary:**
- Closest to Supabase's model (less rewrite)
- Defense in depth (even if API has bugs, DB blocks unauthorized access)
- Works for all clients (web, iOS, any future client)

**What to enforce in API layer:**
- Rate limiting (Upstash Redis)
- Admin-only operations (not expressible in RLS)
- Complex authorization (cross-table checks, business rules)
- Audit logging for sensitive operations

**Do NOT duplicate RLS logic in API code** — that's a maintenance nightmare. Trust RLS for row-level, add API checks only for what RLS can't express.

### Database: Launch Apps Only Get Neon

"One Neon project per app" adds overhead:
- More connection strings / env vars
- More backups / branching decisions
- More small bills

**Revised strategy:**

| Tier | Database Strategy |
|------|-------------------|
| **Launch apps** (Wishlist, Episodic) | Own Neon project, full isolation |
| **Active development** (Verdant, Capsule, Tabby) | Migrate when launching, otherwise stay on Supabase |
| **Side projects** | Stay on Supabase indefinitely (or freeze) |
| **Archived** | No migration |

### Neon Connection Strategy

Neon supports multiple connection modes. Be intentional:

```typescript
// HTTP (serverless, no connection pooling, good for Vercel Functions)
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);

// WebSocket (connection pooling, better for long-running processes)
import { Pool } from '@neondatabase/serverless';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// With Drizzle
import { drizzle } from 'drizzle-orm/neon-http';
const db = drizzle(sql);
```

For Vercel API routes, use the **HTTP driver** (stateless, no pool management).

### Storage: R2 with Custom Domain

R2 presigned URLs require your API credentials + SigV4 signing. **Never generate these client-side.** All presigned URL generation happens in your API routes.

**Important**: The `*.r2.dev` public URL is for **development only**. Cloudflare rate-limits it and explicitly says it's not for production traffic.

| Environment | URL Pattern |
|-------------|-------------|
| Development | `https://your-bucket.xxx.r2.dev` (r2.dev subdomain) |
| Production | `https://uploads.yourapp.com` (custom domain) |

**Setup custom domain**: Cloudflare Dashboard → R2 → Your Bucket → Settings → Custom Domains → Add your domain.

### Realtime: Polling-First (With Upgrade Thresholds)

Don't rebuild Supabase Realtime unless you must. For confirmed realtime consumers:

| App | Current Usage | Recommendation |
|-----|---------------|----------------|
| `blank-slate-web` | Lobby sync | **Polling (2s)** — side project, don't over-engineer |
| `next-app` | Task sync | **Polling (3-5s)** + optimistic UI |
| `wishlist-ios` | List updates | **Polling (3s)** + pull-to-refresh |

**Upgrade thresholds** — switch to Pusher/Ably/SSE when:
- **>500 DAU** on a polling endpoint, OR
- **>100 req/min** sustained polling load, OR
- Users complain about "stale data" or latency

Polling can multiply load and cost fast. Set alerts for these thresholds and have a WebSocket plan ready.

---

## Environment Variable Management

**Goal**: Single source of truth, zero new costs, sync to Vercel with one command.

**Key insight**: OAuth config lives in Clerk Dashboard, not in env vars. Your sync scripts handle:
- `DATABASE_URL` (but Neon↔Vercel integration handles this for previews)
- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET` (for user sync webhooks)
- R2/Cloudflare credentials
- Upstash Redis credentials
- Cron secrets

### Setup: Split Secrets by App

Split secrets by app to reduce blast radius. One leaked file ≠ all apps compromised.

```bash
# Create secure secrets directory
mkdir -p ~/.secrets
chmod 700 ~/.secrets

# Create per-app + shared files
touch ~/.secrets/shared.env
touch ~/.secrets/wishlist.env
touch ~/.secrets/episodic.env
chmod 600 ~/.secrets/*.env
```

### Shared Secrets (used by all apps)

```bash
# ~/.secrets/shared.env

# ============================================
# CLOUDFLARE ACCOUNT (shared)
# ============================================
CLOUDFLARE_ACCOUNT_ID=your-account-id

# ============================================
# UPSTASH REDIS (rate limiting)
# Free tier: 10k requests/day — shared across apps is fine
# ============================================
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# ============================================
# SUPABASE (read-only, for data migration only)
# DELETE THESE after migration complete
# ============================================
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**R2 credentials: Use least-privilege per bucket, NOT a shared god-key.**

Create separate API tokens in Cloudflare for each bucket:
1. Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create token with "Object Read & Write" scoped to ONE bucket
3. Store in per-app env file (not shared.env)

This way, a leaked Wishlist credential can't access Episodic's bucket.

### Per-App: Wishlist

```bash
# ~/.secrets/wishlist.env

# ============================================
# NEON (database only)
# ============================================
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require

# ============================================
# CLERK (authentication)
# ============================================
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
CLERK_WEBHOOK_SECRET=whsec_xxx  # For user sync webhooks

# ============================================
# R2 STORAGE (app-specific bucket + credentials)
# ============================================
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=wishlist-uploads
R2_PUBLIC_URL=https://uploads.wishlist.app  # Custom domain for prod

# ============================================
# CRON (required for any cron touching user data)
# ============================================
CRON_SECRET=xxx  # Generate with: openssl rand -base64 32 | tr -d '\n'

# NOTE: OAuth (Apple, Google) is configured in Clerk Dashboard, NOT here.
```

### Per-App: Episodic

```bash
# ~/.secrets/episodic.env

# ============================================
# NEON (database only)
# ============================================
DATABASE_URL=postgresql://user:pass@ep-yyy.us-east-1.aws.neon.tech/neondb?sslmode=require

# ============================================
# CLERK (authentication)
# ============================================
CLERK_PUBLISHABLE_KEY=pk_live_xxx
CLERK_SECRET_KEY=sk_live_xxx
CLERK_WEBHOOK_SECRET=whsec_xxx

# ============================================
# R2 STORAGE
# ============================================
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=episodic-uploads
R2_PUBLIC_URL=https://uploads.episodic.app

# ============================================
# CRON
# ============================================
CRON_SECRET=xxx

# NOTE: OAuth configured in Clerk Dashboard
```

### Neon↔Vercel Integration (Preview Branches)

**For Tier 1 launch apps, use Neon's Vercel integration** — it automatically:
- Creates a Neon branch per preview deployment
- Injects `DATABASE_URL` into the preview environment
- Cleans up branches when previews are deleted

Setup: Neon Console → Integrations → Vercel → Connect

### Preview Env Contract (Tier 1 Apps)

| Env Var | Production | Preview | Notes |
|---------|------------|---------|-------|
| `DATABASE_URL` | `~/.secrets/<app>.env` | Auto-injected by Neon integration | Pooled connection string |
| `CLERK_PUBLISHABLE_KEY` | Production key | **Use test key for previews** | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | Production key | **Use test key for previews** | Clerk Dashboard → API Keys |

**Clerk environments**: Clerk has separate Development and Production instances. Use Development keys for preview deployments to avoid polluting production user data.

**How to configure Clerk for previews:**
1. In Clerk Dashboard, you have separate Development and Production instances
2. Set preview environment variables in Vercel to use Development keys
3. Users created in preview deployments won't appear in production

### Browser vs Server Env Vars

**Rule**: Clerk's publishable key is safe for the browser; secret key is server-only.

| Env Var | Prefix | Access |
|---------|--------|--------|
| `CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser (required for Clerk components) |
| `CLERK_SECRET_KEY` | None | Server-only (API routes, webhooks) |
| `DATABASE_URL` | None | Server-only |
| `CLERK_WEBHOOK_SECRET` | None | Server-only |

**For this migration**: Clerk's Next.js SDK automatically handles the publishable key. Database access goes through API routes only.

### Sync Script (Production Only)

**Important**: `vercel env add` doesn't update in place. You must remove then add.

```bash
#!/bin/bash
# ~/.secrets/sync-wishlist.sh
# Syncs PRODUCTION secrets only. Previews use Neon↔Vercel integration + Clerk dev keys.

set -e

# Load secrets
source ~/.secrets/shared.env
source ~/.secrets/wishlist.env

# Helper: remove then add (Vercel doesn't support update-in-place)
sync_env() {
    local name=$1
    local value=$2
    local env=${3:-production}

    echo "  Syncing $name..."
    vercel env rm "$name" "$env" --yes 2>/dev/null || true
    echo "$value" | vercel env add "$name" "$env" --yes
}

cd ~/Documents/Development/wishlist

echo "=== Syncing Wishlist (production) ==="

# Neon (production only — previews use Neon↔Vercel integration)
sync_env DATABASE_URL "$DATABASE_URL" production

# Clerk (auth)
sync_env NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "$CLERK_PUBLISHABLE_KEY" production
sync_env CLERK_SECRET_KEY "$CLERK_SECRET_KEY" production
sync_env CLERK_WEBHOOK_SECRET "$CLERK_WEBHOOK_SECRET" production

# R2 Storage
sync_env CLOUDFLARE_ACCOUNT_ID "$CLOUDFLARE_ACCOUNT_ID"
sync_env R2_ACCESS_KEY_ID "$R2_ACCESS_KEY_ID"
sync_env R2_SECRET_ACCESS_KEY "$R2_SECRET_ACCESS_KEY"
sync_env R2_BUCKET_NAME "$R2_BUCKET_NAME"
sync_env R2_PUBLIC_URL "$R2_PUBLIC_URL"

# Rate limiting
sync_env UPSTASH_REDIS_REST_URL "$UPSTASH_REDIS_REST_URL"
sync_env UPSTASH_REDIS_REST_TOKEN "$UPSTASH_REDIS_REST_TOKEN"

# Cron (REQUIRED for any cron touching user data or external APIs)
sync_env CRON_SECRET "$CRON_SECRET"

echo "=== Done ==="
echo ""
echo "NOTE: OAuth is configured in Clerk Dashboard, not here."
echo "NOTE: Preview deployments should use Clerk Development keys."
```

Create a similar `sync-episodic.sh` for Episodic.

```bash
# Make executable and run
chmod +x ~/.secrets/sync-wishlist.sh
~/.secrets/sync-wishlist.sh
```

### Local Development

**Do NOT source secrets in .zshrc** — that exposes secrets to every process and risks leaking them in logs.

Instead, generate per-project `.env.local` files on demand:

```bash
#!/bin/bash
# ~/.secrets/generate-env-local.sh

set -e

PROJECT=$1

case $PROJECT in
  wishlist)
    source ~/.secrets/shared.env
    source ~/.secrets/wishlist.env
    cat > ~/Documents/Development/wishlist/.env.local << EOF
# Neon
DATABASE_URL=$DATABASE_URL

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET=$CLERK_WEBHOOK_SECRET

# R2 Storage
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=$R2_BUCKET_NAME
R2_PUBLIC_URL=$R2_PUBLIC_URL

# Rate limiting
UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN

# Cron
CRON_SECRET=$CRON_SECRET
EOF
    echo "Generated wishlist/.env.local"
    ;;
  episodic)
    source ~/.secrets/shared.env
    source ~/.secrets/episodic.env
    cat > ~/Documents/Development/episodic-api/.env.local << EOF
# Neon
DATABASE_URL=$DATABASE_URL

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=$CLERK_SECRET_KEY
CLERK_WEBHOOK_SECRET=$CLERK_WEBHOOK_SECRET

# R2 Storage
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID
R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME=$R2_BUCKET_NAME
R2_PUBLIC_URL=$R2_PUBLIC_URL

# Rate limiting
UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN

# Cron
CRON_SECRET=$CRON_SECRET
EOF
    echo "Generated episodic-api/.env.local"
    ;;
  *)
    echo "Unknown project: $PROJECT"
    echo "Usage: generate-env-local.sh [wishlist|episodic]"
    exit 1
    ;;
esac
```

```bash
# Usage
chmod +x ~/.secrets/generate-env-local.sh
~/.secrets/generate-env-local.sh wishlist
~/.secrets/generate-env-local.sh episodic
```

**Sanity check**: Use `vercel env pull` to verify Vercel has the right production values:
```bash
cd ~/Documents/Development/wishlist
vercel env pull .env.vercel.local
# Compare with .env.local
```

### Rotating Secrets

When you need to rotate a secret:

1. Update the relevant file in `~/.secrets/` (shared.env or app-specific)
2. Run the app's sync script: `~/.secrets/sync-wishlist.sh`
3. Regenerate local env: `~/.secrets/generate-env-local.sh wishlist`
4. Redeploy: `vercel --prod`

### Required Env Var Check (Fail Fast with Zod)

Use a proper schema validator (Zod) and configure per-repo based on features used:

```bash
npm install zod
```

```typescript
// src/lib/env.ts
import { z } from 'zod';

// Base schema — always required
const baseSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
});

// Clerk auth — required for all authenticated apps
const clerkSchema = z.object({
  CLERK_SECRET_KEY: z.string().startsWith('sk_'),
  CLERK_WEBHOOK_SECRET: z.string().optional(), // Only if using webhooks
});

// Feature flags — only validate if the repo uses that feature
const storageSchema = z.object({
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_URL: z.string().url(),
});

const rateLimitSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

const cronSchema = z.object({
  CRON_SECRET: z.string().min(32),  // Require 32+ chars for security
});

// Configure per-repo — only include schemas for features you use
// Example for Wishlist (uses Clerk + storage + rate limiting + cron):
const wishlistSchema = baseSchema
  .merge(clerkSchema)
  .merge(storageSchema)
  .merge(rateLimitSchema)
  .merge(cronSchema);

// Example for a repo with NO file uploads:
const noStorageSchema = baseSchema
  .merge(clerkSchema)
  .merge(rateLimitSchema)
  .merge(cronSchema);

// Validate at startup
export function validateEnv() {
  const result = wishlistSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid env vars: ${missing}`);
  }

  return result.data;
}

// Call in your app's entry point (e.g., instrumentation.ts or layout.tsx)
export const env = validateEnv();
```

**Per-repo configuration:**

| Repo | Schema | Notes |
|------|--------|-------|
| `wishlist` | `baseSchema + clerkSchema + storageSchema + rateLimitSchema + cronSchema` | Full stack |
| `episodic-api` | `baseSchema + clerkSchema + storageSchema + rateLimitSchema + cronSchema` | Full stack |
| Side projects | `baseSchema + clerkSchema + rateLimitSchema` | No storage, no cron |

**Preview vs Production:**
- **Preview**: `DATABASE_URL` injected by Neon↔Vercel integration, Clerk dev keys
- **Production**: `DATABASE_URL` from `~/.secrets/<app>.env` via sync script, Clerk production keys

Document this rule once per repo so there's no confusion.

---

## Scan Highlights (Supabase usage confirmed)

### Realtime Usage
| App | File(s) | Recommendation |
|-----|---------|----------------|
| `blank-slate-web` | `src/app/lobby/[code]/page.tsx` | Polling (2s) |
| `next-app` | `Next/Shared/Services/TaskStore.swift` | Polling (3-5s) |
| `wishlist-ios` | `ListService.swift`, `RealtimeMonitor.swift` | Polling (3s) + pull-to-refresh |

### Storage Usage
| App | Files | Content Type | Migration Priority |
|-----|-------|--------------|-------------------|
| `wishlist` | `api/upload-image/route.ts` | Gift images | High |
| `wishlist-ios` | `AvatarService.swift` | User avatars | High |
| `capsule` | `PhotoService.swift` | Photos/albums | Medium |
| `episodic-ios` | `ProfileView.swift` | Profile images | Medium |
| `verdant` | `SupabaseMediaStorage.ts` | Plant images | Medium |

### Edge Functions (must be replaced with API routes)
| App | Functions | Complexity | Hidden Work |
|-----|-----------|------------|-------------|
| `episodic-ios` | 16 functions | High | TMDB API integration, cron for refresh-all |
| `wishlist` | 12 functions | High | OTP delivery if migrating auth, guest token management |
| `verdant` | 4 functions | Medium | OpenAI integration for plant AI |
| `werk-room` | 5 functions | Medium | Scraping logic, cron jobs |
| `wine-de-louton` | 1 function | Low | AI enrichment |

### Service Role Usage (becomes "god key" in your backend)
Heavy in: `wishlist`, `tabby`, `werk-room`, `verdant` scripts, `streaming-guide`, `wallpeypers` scripts.

**Warning**: When you port service-role calls to your API, your backend becomes the privileged actor. You need:
- Rate limiting on all endpoints
- Authorization checks (not just authentication)
- Audit logging for sensitive operations

---

## Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Data loss during migration** | Critical | Low | Export full backup before each migration, verify row counts |
| **Auth regression (users locked out)** | Critical | Low | Keep Supabase Auth running during entire migration |
| **Broken file URLs** | High | Medium | Keep Supabase Storage read-only, URL rewriting in DB |
| **Missing RLS enforcement** | High | Medium | Document RLS policies, implement in API middleware |
| **Service-role abuse** | High | Medium | Rate limiting, authz checks, audit logs |
| **iOS app rejection** | High | Low | TestFlight extensively before submission |
| **Edge function logic bugs** | Medium | Medium | Port one at a time, test against prod data copies |
| **Cron job failures** | Medium | Medium | Vercel Cron with alerting, manual fallback |

---

## Template Backend

**The migration path**: Use Clerk for auth (Next.js SDK) and `@neondatabase/serverless` for database access.

### Installation

```bash
npm install @clerk/nextjs @neondatabase/serverless
```

### Template: Clerk Middleware

```typescript
// src/middleware.ts
import { clerkMiddleware } from '@clerk/nextjs/server';

export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
```

### Template: Database Client

```typescript
// src/lib/db.ts
import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL!);

// For connection pooling in long-running processes
import { Pool } from '@neondatabase/serverless';
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

### Template: User ID Mapping

```typescript
// src/lib/user-mapping.ts
import { sql } from './db';

export async function getDbUserId(clerkUserId: string): Promise<string | null> {
  const result = await sql`
    SELECT db_user_id FROM user_id_mapping WHERE clerk_user_id = ${clerkUserId}
  `;
  return result[0]?.db_user_id ?? null;
}

export async function createUserMapping(
  clerkUserId: string,
  email: string,
  existingDbId?: string
): Promise<string> {
  if (existingDbId) {
    // For imported users — preserve their existing database UUID
    await sql`
      INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
      VALUES (${clerkUserId}, ${existingDbId}::uuid, ${email})
      ON CONFLICT (clerk_user_id) DO NOTHING
    `;
    return existingDbId;
  }

  // For new users — generate a new UUID
  const result = await sql`
    INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
    VALUES (${clerkUserId}, gen_random_uuid(), ${email})
    RETURNING db_user_id
  `;
  return result[0].db_user_id;
}
```

### Template: Protected API Route

```typescript
// src/app/api/items/route.ts
import { getAuth } from '@clerk/nextjs/server';
import { sql } from '@/lib/db';
import { getDbUserId } from '@/lib/user-mapping';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { userId } = getAuth(request);
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dbUserId = await getDbUserId(userId);
  if (!dbUserId) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const items = await sql`
    SELECT * FROM items WHERE user_id = ${dbUserId}::uuid
  `;

  return Response.json(items);
}

export async function POST(request: NextRequest) {
  const { userId } = getAuth(request);
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dbUserId = await getDbUserId(userId);
  if (!dbUserId) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await request.json();

  const result = await sql`
    INSERT INTO items (user_id, name, description)
    VALUES (${dbUserId}::uuid, ${body.name}, ${body.description})
    RETURNING *
  `;

  return Response.json(result[0], { status: 201 });
}
```

### Template: Clerk Webhook (User Sync)

```typescript
// src/app/api/webhooks/clerk/route.ts
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { WebhookEvent } from '@clerk/nextjs/server';
import { createUserMapping } from '@/lib/user-mapping';

export async function POST(request: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    throw new Error('Missing CLERK_WEBHOOK_SECRET');
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return Response.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  const payload = await request.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: WebhookEvent;

  try {
    event = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'user.created') {
    const { id, email_addresses, external_id } = event.data;
    const email = email_addresses[0]?.email_address;

    // If external_id exists, this is an imported user — preserve their DB ID
    await createUserMapping(id, email, external_id ?? undefined);

    console.log(`Created user mapping for ${email}`);
  }

  return Response.json({ received: true });
}
```

### RLS Policy Approach

With Clerk, RLS is **optional** — you can enforce access control in your API routes instead. However, RLS provides defense-in-depth.

**If using RLS with Clerk**, you need to pass the database user ID to Postgres. One approach:

```typescript
// Set the user ID in session for RLS
await sql`SET LOCAL app.current_user_id = ${dbUserId}`;
const items = await sql`SELECT * FROM items`; // RLS uses app.current_user_id
```

```sql
-- RLS policy using session variable
CREATE POLICY "Users can view own items" ON items
  FOR SELECT USING (user_id = current_setting('app.current_user_id')::uuid);
```

**Simpler approach**: Skip RLS and enforce access in API routes (as shown above). This is cleaner when Clerk handles auth externally.

### CORS for iOS Clients

If your iOS app calls the API directly, add CORS headers. Combine with Clerk middleware:

```typescript
// src/middleware.ts (Next.js with Clerk + CORS)
import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default clerkMiddleware((auth, request) => {
  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*', // iOS apps don't send credentials via cookies
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

**Note**: iOS apps send tokens via `Authorization` header, not cookies. `Access-Control-Allow-Origin: *` is fine in this case.

### Optional: Drizzle ORM (Phase 2)

If you want type-safe queries later, add Drizzle alongside the serverless driver:

```typescript
// src/db/drizzle.ts (add later, after migration is stable)
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

// Use for new code / gradual refactor
const items = await db.select().from(schema.items).where(eq(schema.items.userId, userId));
```

Don't block migration on Drizzle. Get off Supabase first, then refactor.

### Template: iOS Authentication (Clerk SDK)

**Installation**: Add the Clerk iOS SDK via Swift Package Manager:
```
https://github.com/clerk/clerk-ios
```

```swift
// iOS: App.swift
import SwiftUI
import ClerkSDK

@main
struct YourApp: App {
    init() {
        Clerk.configure(publishableKey: "pk_live_xxx")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

```swift
// iOS: AuthService.swift
import ClerkSDK
import AuthenticationServices

@MainActor
class AuthService: ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: ClerkSDK.User?

    init() {
        // Listen for auth state changes
        Task {
            for await session in Clerk.shared.sessionPublisher.values {
                self.isAuthenticated = session != nil
                self.currentUser = Clerk.shared.user
            }
        }
    }

    // MARK: - Apple Sign In

    func signInWithApple() async throws {
        // Create an Apple Sign In strategy
        let signIn = try await Clerk.shared.signIn.create(strategy: .oauth(.apple))

        // Complete the OAuth flow
        try await signIn.authenticateWithRedirect()
    }

    // MARK: - Email/Password Login

    func login(email: String, password: String) async throws {
        let signIn = try await Clerk.shared.signIn.create(
            strategy: .identifier(email, password: password)
        )

        // Check if sign-in is complete
        guard signIn.status == .complete else {
            throw AuthError.signInIncomplete
        }
    }

    // MARK: - Email Sign Up

    func signUp(email: String, password: String) async throws {
        let signUp = try await Clerk.shared.signUp.create(
            strategy: .standard(emailAddress: email, password: password)
        )

        // User may need to verify email
        if signUp.status == .missingRequirements {
            // Handle email verification flow
            try await signUp.prepareVerification(strategy: .emailCode)
        }
    }

    // MARK: - SMS/Phone Login

    func signInWithPhone(phoneNumber: String) async throws {
        let signIn = try await Clerk.shared.signIn.create(
            strategy: .identifier(phoneNumber)
        )

        // Send verification code
        try await signIn.prepareFirstFactor(strategy: .phoneCode)
    }

    func verifyPhoneCode(code: String) async throws {
        guard let signIn = Clerk.shared.signIn else { return }

        try await signIn.attemptFirstFactor(
            strategy: .phoneCode(code: code)
        )
    }

    // MARK: - Token for API Calls

    func getSessionToken() async throws -> String? {
        return try await Clerk.shared.session?.getToken()
    }

    // MARK: - Logout

    func logout() async throws {
        try await Clerk.shared.signOut()
    }
}

enum AuthError: Error {
    case signInIncomplete
    case signInFailed
}
```

### Template: iOS API Client (with Clerk Token)

```swift
// iOS: APIClient.swift
import Foundation
import ClerkSDK

class APIClient {
    static let shared = APIClient()

    private let baseURL = "https://your-app.vercel.app"

    func fetch<T: Decodable>(
        _ endpoint: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> T {
        guard let url = URL(string: "\(baseURL)\(endpoint)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add Clerk session token
        if let token = try await Clerk.shared.session?.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode)
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    // Example: Get user's items
    func getItems() async throws -> [Item] {
        return try await fetch("/api/items")
    }

    // Example: Create item
    func createItem(name: String, description: String) async throws -> Item {
        struct CreateItemRequest: Encodable {
            let name: String
            let description: String
        }
        return try await fetch(
            "/api/items",
            method: "POST",
            body: CreateItemRequest(name: name, description: description)
        )
    }
}

enum APIError: Error {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)
}
```

### Template: R2 Presigned URLs

```typescript
// src/lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function getUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 });
}

export async function getDownloadUrl(key: string) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(r2, command, { expiresIn: 3600 });
}

export function getPublicUrl(key: string) {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
```

### Template: Rate Limiting (Upstash Redis)

**Important**: In-memory rate limiting doesn't work on Vercel — each lambda instance has its own memory, and they don't coordinate. Use Upstash Redis (free tier: 10k requests/day).

```bash
npm install @upstash/ratelimit @upstash/redis
```

```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Different limits for different endpoints
export const authRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 attempts per minute
  analytics: true,
  prefix: 'ratelimit:auth',
});

export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
  analytics: true,
  prefix: 'ratelimit:api',
});

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ success: boolean; remaining: number }> {
  const { success, remaining } = await limiter.limit(identifier);
  return { success, remaining };
}

// Middleware wrapper
export function withRateLimit(
  handler: (req: Request) => Promise<Response>,
  limiter: Ratelimit,
  getKey: (req: Request) => string
) {
  return async (request: Request) => {
    const key = getKey(request);
    const { success, remaining } = await checkRateLimit(limiter, key);

    if (!success) {
      return Response.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'X-RateLimit-Remaining': remaining.toString() },
        }
      );
    }

    return handler(request);
  };
}
```

**Protect these endpoints with `authRateLimit`:**
- `/api/auth/sign-in/*`
- `/api/auth/sign-up/*`
- `/api/auth/forget-password`
- `/api/auth/reset-password`

**Env vars to add:**
```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
```

Get these free at https://upstash.com (10k requests/day free tier).

### Template: Cron Endpoint

**⚠️ All schedules are UTC** — "0 9 * * *" is 9am UTC, not 9am ET. Adjust for ET + DST.

**Vercel Cron behavior:**
1. **No automatic retries** — If your cron fails, it doesn't retry. Build idempotency + alerting.
2. **300s max duration** — For longer jobs, use chunking with checkpoints.
3. **vercel.json doesn't interpolate env vars** — secrets must be validated in the handler.

**Requirements for production crons:**
1. **Authenticated**: Verify `CRON_SECRET` in Authorization header (required for any cron touching user data)
2. **Idempotent**: Safe to run twice (use timestamps, not "process all unprocessed")
3. **Observable**: Structured logs with `cron`, `durationMs`, `processed`, `errors`
4. **Alertable**: Wire failures to Sentry or logging service
5. **Concurrency-safe**: Prevent overlapping executions with advisory locks
6. **Backpressure-aware**: Chunk large jobs to avoid function timeouts

**Security: CRON_SECRET is required**

Per [Vercel guidance](https://vercel.com/docs/cron-jobs#securing-cron-jobs), protect cron endpoints with a secret:

```typescript
// src/app/api/cron/example/route.ts
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const startTime = Date.now();

  // REQUIRED: Verify CRON_SECRET in Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('Cron auth failed - invalid or missing secret');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // OPTIONAL: Also check x-vercel-cron header for extra verification
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron) {
    console.warn('Request missing x-vercel-cron header');
    // Decide: reject or allow (CRON_SECRET is the primary guardrail)
  }

  try {
    // IDEMPOTENT: Use time windows, not "all unprocessed"
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h
    const result = await processItemsSince(since);

    const duration = Date.now() - startTime;

    // OBSERVABLE: Log metrics
    console.log(JSON.stringify({
      cron: 'example',
      processed: result.count,
      errors: result.errors,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    }));

    return Response.json({
      success: true,
      processed: result.count,
      errors: result.errors,
      durationMs: duration,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    // ALERTABLE: Structured log for log aggregators
    console.error(JSON.stringify({
      cron: 'example',
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    }));

    // Send to Sentry (recommended for production crons)
    if (process.env.SENTRY_DSN) {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(error, { tags: { cron: 'example' } });
    }

    return Response.json({
      error: 'Cron failed',
      message: String(error),
      durationMs: duration,
    }, { status: 500 });
  }
}
```

**Note on CRON_SECRET**: Vercel warns about newline characters in secrets. Generate with:
```bash
openssl rand -base64 32 | tr -d '\n'
```

### Cron Guardrail: Advisory Lock (Prevent Overlap)

If a cron job runs longer than expected, prevent overlapping executions:

```typescript
// Using Postgres advisory lock
async function withCronLock<T>(
  lockId: number,
  fn: () => Promise<T>
): Promise<T | null> {
  // Try to acquire lock (non-blocking)
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock($1) as acquired',
    [lockId]
  );

  if (!rows[0].acquired) {
    console.log('Cron already running, skipping');
    return null;
  }

  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
  }
}

// Usage
export async function GET(request: Request) {
  // ... auth check ...

  const result = await withCronLock(123456, async () => {
    return await processItems();
  });

  if (result === null) {
    return Response.json({ skipped: true, reason: 'already running' });
  }

  return Response.json(result);
}
```

### Cron Guardrail: Backpressure (Chunk Large Jobs)

If a job can exceed Vercel's function timeout (300s max), checkpoint progress:

```typescript
async function processInChunks() {
  const CHUNK_SIZE = 100;
  const MAX_DURATION_MS = 250_000; // Leave buffer before 300s timeout
  const startTime = Date.now();

  let cursor: string | null = await getLastCursor(); // From DB
  let totalProcessed = 0;

  while (Date.now() - startTime < MAX_DURATION_MS) {
    const items = await getNextChunk(cursor, CHUNK_SIZE);
    if (items.length === 0) break;

    await processItems(items);
    totalProcessed += items.length;

    cursor = items[items.length - 1].id;
    await saveCheckpoint(cursor); // Persist progress
  }

  return { processed: totalProcessed, cursor, completed: cursor === null };
}
```

### Template: vercel.json for Cron

**Plain paths only** — vercel.json does NOT interpolate env vars:

```json
{
  "crons": [
    {
      "path": "/api/cron/example",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**How Vercel calls your cron endpoint:**
- Vercel makes a GET request to the path
- Vercel sets the `x-vercel-cron: 1` header
- Vercel does NOT auto-send your CRON_SECRET — you must validate it in the handler

**Security model:**
1. **CRON_SECRET in Authorization header** (primary) — you verify `Bearer ${CRON_SECRET}` in the handler
2. **x-vercel-cron header** (secondary) — confirms request came from Vercel scheduler

**How to send CRON_SECRET:** Since vercel.json doesn't interpolate, Vercel cannot send the secret in the URL or headers automatically. The secret is verified server-side against `process.env.CRON_SECRET`.

**This means**: Anyone who knows your cron URL can hit it, but they'll get 401 without the secret. The x-vercel-cron header adds a second layer (harder to spoof from outside Vercel).

**Common schedule conversions (ET → UTC):**
| What you want | ET | UTC (vercel.json) |
|---------------|-----|-------------------|
| 9am daily | 9am ET | `0 14 * * *` (winter) / `0 13 * * *` (summer) |
| Every 6 hours | — | `0 */6 * * *` |
| Midnight daily | 12am ET | `0 5 * * *` (winter) / `0 4 * * *` (summer) |

**Tip**: For user-facing schedules, pick UTC times that are reasonable in your primary timezone and document them.

---

## Global Migration Blueprint

### Phase 0: Pre-Migration Setup (do once)

```bash
# 1. Create Neon account
# https://console.neon.tech — sign up with GitHub

# 2. Install CLIs
brew install neonctl
npm install -g wrangler drizzle-kit

# 3. Authenticate
neonctl auth
wrangler login

# 4. Create secrets directory
mkdir -p ~/.secrets && chmod 700 ~/.secrets
touch ~/.secrets/neon-r2-migration.env && chmod 600 ~/.secrets/neon-r2-migration.env

# 5. Create R2 bucket (first app)
wrangler r2 bucket create wishlist-uploads
```

### Phase A: Data & Schema Migration

#### A1. Export Supabase Schema
```bash
# If you have migrations directory
cat supabase/migrations/*.sql > full-schema.sql

# Or dump directly
supabase db dump --schema public > schema.sql
```

#### A2. Document RLS Policies (CRITICAL)
```sql
-- Run in Supabase SQL Editor, save output
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public';
```

Save to `docs/rls-policies.md`. Every policy becomes an authorization check in your API.

#### A3. Create Neon Project
```bash
neonctl projects create --name wishlist-prod --region aws-us-east-1
neonctl connection-string wishlist-prod
# Save to ~/.secrets/neon-r2-migration.env as WISHLIST_DATABASE_URL
```

#### A4. Create Drizzle Schema
```typescript
// src/db/schema.ts
import { pgTable, text, timestamp, uuid, boolean, jsonb } from 'drizzle-orm/pg-core';

// Map your Supabase tables here
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Add your columns...
});

// Continue for all tables...
```

#### A5. Apply Schema
```bash
npx drizzle-kit generate
npx drizzle-kit push
```

#### A6. Backfill Data
```typescript
// scripts/migrate-data.ts
import { createClient } from '@supabase/supabase-js';
import { db } from '../src/db';
import { users } from '../src/db/schema';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function migrateTable<T>(
  tableName: string,
  drizzleTable: any,
  transform?: (row: any) => T
) {
  console.log(`Migrating ${tableName}...`);

  let offset = 0;
  const batchSize = 1000;
  let total = 0;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    const rows = transform ? data.map(transform) : data;
    await db.insert(drizzleTable).values(rows);

    total += data.length;
    offset += batchSize;
    console.log(`  ${total} rows migrated...`);
  }

  console.log(`✓ ${tableName}: ${total} rows`);
  return total;
}

async function verify(tableName: string, expectedCount: number) {
  const { count } = await supabase
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (count !== expectedCount) {
    throw new Error(`Mismatch: expected ${expectedCount}, got ${count}`);
  }
  console.log(`✓ Verified ${tableName}: ${count} rows`);
}

// Run
const userCount = await migrateTable('users', users);
await verify('users', userCount);
```

---

### Phase B: Storage Migration (R2)

#### B1. Create R2 Bucket
```bash
wrangler r2 bucket create <app>-uploads

# Configure CORS via dashboard or:
# Cloudflare Dashboard > R2 > <bucket> > Settings > CORS
```

CORS config:
```json
[
  {
    "AllowedOrigins": ["https://yourapp.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

#### B2. Migrate Existing Files
```typescript
// scripts/migrate-storage.ts
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const supabase = createClient(/*...*/);
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

async function migrateBucket(bucketName: string) {
  console.log(`Migrating bucket: ${bucketName}`);

  const { data: files } = await supabase.storage.from(bucketName).list('', {
    limit: 1000,
  });

  for (const file of files || []) {
    const { data } = await supabase.storage.from(bucketName).download(file.name);
    if (!data) continue;

    const buffer = await data.arrayBuffer();
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${bucketName}/${file.name}`,
      Body: Buffer.from(buffer),
      ContentType: file.metadata?.mimetype || 'application/octet-stream',
    }));

    console.log(`  ✓ ${file.name}`);
  }
}

await migrateBucket('avatars');
await migrateBucket('images');
```

#### B3. Rewrite URLs in Database
```typescript
async function rewriteUrls(table: string, column: string) {
  const oldPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/`;
  const newPrefix = process.env.R2_PUBLIC_URL;

  await db.execute(sql`
    UPDATE ${sql.identifier(table)}
    SET ${sql.identifier(column)} = REPLACE(
      ${sql.identifier(column)},
      ${oldPrefix},
      ${newPrefix}
    )
    WHERE ${sql.identifier(column)} LIKE ${oldPrefix + '%'}
  `);
}
```

---

### Phase C: API Routes (Replace Edge Functions)

#### C1. Port Edge Functions One at a Time

```typescript
// Before: supabase/functions/get-data/index.ts (Deno)
serve(async (req) => {
  const supabase = createClient(/*...*/);
  const { data } = await supabase.from('items').select('*');
  return new Response(JSON.stringify(data));
});

// After: src/app/api/data/route.ts (Next.js)
import { db } from '@/db';
import { items } from '@/db/schema';
import { withAuth } from '@/lib/auth';

export const GET = withAuth(async (request, user) => {
  const data = await db
    .select()
    .from(items)
    .where(eq(items.userId, user.id));

  return Response.json(data);
});
```

#### C2. Authorization Checklist (per endpoint)

For each endpoint, verify:
- [ ] User is authenticated
- [ ] User owns the resource (or has permission)
- [ ] Rate limiting applied
- [ ] Input validated

---

### Phase D: Cron Migration

| Current (Supabase) | New (Vercel Cron) | Schedule |
|--------------------|-------------------|----------|
| `pg_cron` in migrations | `/api/cron/refresh-shows` | `0 */6 * * *` |
| Edge function + scheduler | `/api/cron/send-reminders` | `0 9 * * *` |

#### D1. Vercel Cron Setup

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/refresh-shows",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 0 * * *"
    }
  ]
}
```

#### D2. Cron Endpoint Pattern

```typescript
// src/app/api/cron/refresh-shows/route.ts
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  // Always verify the secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Your logic
    const refreshed = await refreshAllShows();

    return Response.json({
      success: true,
      refreshed: refreshed.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Cron failed:', error);
    // Consider alerting (email, Slack, etc.)
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
```

---

### Phase E: Realtime Replacement (Polling)

#### E1. Polling Hook

```typescript
// src/hooks/usePolling.ts
import { useState, useEffect, useCallback } from 'react';

export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 3000
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    try {
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, intervalMs);
    return () => clearInterval(interval);
  }, [refetch, intervalMs]);

  return { data, loading, error, refetch };
}

// Usage
function WishlistItems({ listId }: { listId: string }) {
  const { data: items, loading, refetch } = usePolling(
    () => fetch(`/api/lists/${listId}/items`).then(r => r.json()),
    3000
  );

  return (
    <div>
      <button onClick={refetch}>Refresh</button>
      {items?.map(item => <Item key={item.id} {...item} />)}
    </div>
  );
}
```

#### E2. iOS Polling

```swift
class PollingService {
    private var timer: Timer?
    private let interval: TimeInterval

    init(interval: TimeInterval = 3.0) {
        self.interval = interval
    }

    func start(fetch: @escaping () async -> Void) {
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            Task { await fetch() }
        }
        // Initial fetch
        Task { await fetch() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }
}

// Usage
class ListViewModel: ObservableObject {
    @Published var items: [Item] = []
    private let polling = PollingService(interval: 3.0)

    func startPolling(listId: String) {
        polling.start { [weak self] in
            let items = try? await API.shared.getItems(listId: listId)
            await MainActor.run {
                self?.items = items ?? []
            }
        }
    }
}
```

---

### Phase F: Auth Migration (Clerk User Import)

**Good news**: Clerk can import users with bcrypt password hashes — no forced password reset!

| User Type | Migration Experience |
|-----------|---------------------|
| **OAuth users** | Sign in again → seamless (Clerk creates account) |
| **Email/password users** | Import via Clerk Backend API with bcrypt hash → seamless login |

#### F1. Export Users from Supabase

Export user info INCLUDING password hashes (Clerk can import them):

```typescript
// scripts/export-users-for-clerk.ts
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function exportUsersForClerk() {
  // Get users via admin API
  const { data: users, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;

  // For password hashes, you need direct DB access to auth.users table
  // Run this SQL in Supabase SQL Editor:
  // SELECT id, email, encrypted_password, raw_app_meta_data FROM auth.users;

  const exported = users.users.map((u) => ({
    supabaseId: u.id,  // Will become externalId in Clerk
    email: u.email,
    emailVerified: !!u.email_confirmed_at,
    createdAt: u.created_at,
    provider: u.app_metadata?.provider || 'email',
    metadata: u.user_metadata,
    // Password hash must be fetched separately via SQL
  }));

  fs.writeFileSync('users-export.json', JSON.stringify(exported, null, 2));
  console.log(`Exported ${exported.length} users`);
  console.log(`  OAuth: ${exported.filter(u => u.provider !== 'email').length}`);
  console.log(`  Email/password: ${exported.filter(u => u.provider === 'email').length}`);
}

await exportUsersForClerk();
```

**To get password hashes**, run this in Supabase SQL Editor:
```sql
SELECT id, email, encrypted_password
FROM auth.users
WHERE raw_app_meta_data->>'provider' = 'email';
```

Export the results and merge with your user export.

#### F2. Import Users to Clerk

```typescript
// scripts/import-users-to-clerk.ts
import { clerkClient } from '@clerk/clerk-sdk-node';
import fs from 'fs';

interface ExportedUser {
  supabaseId: string;
  email: string;
  emailVerified: boolean;
  passwordHash?: string;  // bcrypt hash from Supabase
  provider: string;
  metadata: Record<string, any>;
}

async function importUsersToClerk() {
  const users: ExportedUser[] = JSON.parse(
    fs.readFileSync('users-export.json', 'utf8')
  );

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of users) {
    try {
      // Skip OAuth users — they'll create accounts on first sign-in
      if (user.provider !== 'email') {
        console.log(`Skipping OAuth user: ${user.email}`);
        skipped++;
        continue;
      }

      // Import email/password user with bcrypt hash
      await clerkClient.users.createUser({
        emailAddress: [user.email],
        passwordHasher: 'bcrypt',
        passwordDigest: user.passwordHash!,
        skipPasswordChecks: true,
        externalId: user.supabaseId,  // Store old ID for mapping
        publicMetadata: {
          migratedFromSupabase: true,
          originalId: user.supabaseId,
        },
      });

      console.log(`Imported: ${user.email}`);
      imported++;
    } catch (err: any) {
      if (err.errors?.[0]?.code === 'form_identifier_exists') {
        console.log(`Already exists: ${user.email}`);
        skipped++;
      } else {
        console.error(`Error importing ${user.email}:`, err.message);
        errors++;
      }
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);
}

await importUsersToClerk();
```

#### F3. Create User ID Mapping Table

Clerk uses string IDs like `user_2abc123`, but your database uses UUIDs. Create a mapping:

```sql
-- Run this migration in Neon
CREATE TABLE user_id_mapping (
  clerk_user_id TEXT PRIMARY KEY,
  db_user_id UUID NOT NULL UNIQUE,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_mapping_db_id ON user_id_mapping(db_user_id);
```

#### F4. Populate Mapping for Imported Users

```typescript
// scripts/create-user-mappings.ts
import { clerkClient } from '@clerk/clerk-sdk-node';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function createMappingsForImportedUsers() {
  // Get all Clerk users with externalId (imported users)
  const users = await clerkClient.users.getUserList({ limit: 500 });

  for (const user of users.data) {
    if (!user.externalId) continue;  // Skip non-imported users

    const email = user.emailAddresses[0]?.emailAddress;

    // externalId contains the original Supabase UUID
    await sql`
      INSERT INTO user_id_mapping (clerk_user_id, db_user_id, email)
      VALUES (${user.id}, ${user.externalId}::uuid, ${email})
      ON CONFLICT (clerk_user_id) DO NOTHING
    `;

    console.log(`Mapped: ${email} (${user.id} → ${user.externalId})`);
  }
}

await createMappingsForImportedUsers();
```

#### F5. Set Up Webhook for New Users

Configure a Clerk webhook to create mappings for new users and OAuth sign-ins:

1. Go to Clerk Dashboard → Webhooks → Add Endpoint
2. URL: `https://your-app.vercel.app/api/webhooks/clerk`
3. Events: `user.created`
4. Copy the signing secret to `CLERK_WEBHOOK_SECRET`

See "Template: Clerk Webhook (User Sync)" in the Template Backend section for the implementation.

#### F6. Verification Checklist

Before going live:

- [ ] Users exported from Supabase (with password hashes for email users)
- [ ] Email/password users imported to Clerk via Backend API
- [ ] User ID mapping table created and populated
- [ ] Clerk webhook configured for new user sync
- [ ] OAuth providers configured in Clerk Dashboard (Apple, Google, SMS)
- [ ] Test: Imported email user can log in with original password
- [ ] Test: OAuth user can sign in (creates new Clerk account, webhook creates mapping)
- [ ] Test: New user can sign up (webhook creates mapping)
- [ ] Test: API routes correctly map Clerk ID → database UUID

#### F7. Migration Summary

| User Type | Experience |
|-----------|------------|
| **OAuth users** | Sign in with Apple/Google → seamless (Clerk creates account, webhook creates mapping) |
| **Email/password users** | Log in with existing password → seamless (imported with bcrypt hash) |
| **New users** | Normal signup flow (webhook creates mapping) |

---

## Testing Strategy

### Pre-Migration Checklist
- [ ] Supabase backup exported
- [ ] RLS policies documented
- [ ] Row counts recorded per table

### Post-Migration Verification
```typescript
// scripts/verify-migration.ts
async function verifyAll() {
  const tables = ['users', 'lists', 'items', /* ... */];

  for (const table of tables) {
    const { count: supabaseCount } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    const [{ count: neonCount }] = await db
      .select({ count: sql`count(*)` })
      .from(sql.identifier(table));

    console.log(`${table}: Supabase=${supabaseCount}, Neon=${neonCount}`);

    if (supabaseCount !== Number(neonCount)) {
      console.error(`  ❌ MISMATCH`);
    } else {
      console.log(`  ✓ Match`);
    }
  }
}
```

### Manual Testing Checklist
- [ ] API routes return correct data
- [ ] File uploads work (R2)
- [ ] File downloads/display work
- [ ] Auth works with Clerk (email/password, OAuth)
- [ ] User ID mapping resolves correctly
- [ ] iOS app works with new endpoints + Clerk SDK
- [ ] Cron jobs execute successfully

---

## Rollback Strategy

### If Data Migration Fails
1. Neon project is independent — just don't switch the app to use it
2. Supabase remains primary
3. Delete Neon project, try again

### If API Routes Have Bugs
1. Revert deployment (Vercel instant rollback)
2. App continues using old Supabase direct access

### If Storage Migration Fails
1. Keep Supabase Storage as primary
2. R2 is additive — old URLs still work

### Nuclear Option
Everything stays on Supabase. This migration is additive until you flip the switch.

---

## Decommission Criteria

**Do NOT turn off Supabase until ALL of these are true:**

### Per-App Checklist
- [ ] All tables migrated to Neon and verified
- [ ] Clerk application created and configured
- [ ] Users imported to Clerk (with bcrypt hashes for email/password users)
- [ ] User ID mapping table populated
- [ ] OAuth users can sign in via Clerk
- [ ] Email/password users can sign in with original password
- [ ] All storage migrated to R2 and URLs rewritten
- [ ] All edge functions ported to API routes
- [ ] Cron jobs running on Vercel Cron for 2+ weeks without issues
- [ ] Zero Supabase API calls in production logs for 7+ days
- [ ] iOS app update shipped and 90%+ users upgraded

### Global Checklist
- [ ] Final Supabase backup exported and stored (data + auth)
- [ ] All env vars updated (Supabase vars removed)
- [ ] Documentation updated
- [ ] Supabase billing reviewed (no surprise charges)
- [ ] Supabase project deleted (after 30-day observation period)

---

## Repo Priority Tiers

### Tier 1: Launch Apps (Migrate Now)

| Repo | Database | Storage | Auth | Realtime |
|------|----------|---------|------|----------|
| `episodic-ios` | → Neon | → R2 | → Clerk | N/A |
| `wishlist` + `wishlist-ios` | → Neon | → R2 | → Clerk | → Polling |

### Tier 2: Active (Migrate When Launching)

| Repo | Action |
|------|--------|
| `verdant` + `verdant-ios` | Stay on Supabase until launch |
| `capsule` | Stay on Supabase until launch |
| `tabby` | Stay on Supabase until launch |

### Tier 3: Side Projects (Stay on Supabase)

`blank-slate-web`, `next-app`, `streaming-guide`, `werk-room`, `wine-de-louton`, `amex-benefits-tracker`, `shelf-life`, `wallpeypers`

### Tier 4: No Migration

`housewives-*`, `mtg-guide`, `sundial`, `winter26-dashboard`, `~Archive/*`

---

## Repo-by-Repo Plan

### wishlist (web) — SECOND

**After Episodic is stable**, apply the same pattern to Wishlist.

**Migration Order:**
1. Neon project + data migration
2. Clerk application + user import
3. Storage → R2 (custom domain)
4. Clerk SDK + direct Neon queries
5. Realtime → Polling

**Week 1: Neon Project + Data Migration**
- [ ] Create Neon project: `wishlist-prod`
- [ ] Set up Neon↔Vercel integration for preview branches
- [ ] Export schema from Supabase
- [ ] Apply schema to Neon
- [ ] Create `user_id_mapping` table
- [ ] Backfill app tables (lists, items, households, etc.)
- [ ] Verify row counts

**Week 2: Clerk Application + User Import**
- [ ] Create Clerk application at dashboard.clerk.com
- [ ] Configure OAuth providers in Clerk Dashboard (Apple, Google)
- [ ] Export users from Supabase (with password hashes)
- [ ] Import email/password users to Clerk via Backend API
- [ ] Create user ID mappings for imported users
- [ ] Set up Clerk webhook for new user sync
- [ ] Test: Imported users can log in with original password
- [ ] Test: OAuth users can sign in (webhook creates mapping)

**Week 3: Storage (R2)**
- [ ] Create R2 bucket: `wishlist-uploads`
- [ ] **Set up custom domain** for production
- [ ] Migrate existing images from Supabase Storage
- [ ] Rewrite URLs in database

**Week 4: Code Migration**
- [ ] Install `@clerk/nextjs` and `@neondatabase/serverless`
- [ ] Set up Clerk middleware
- [ ] Update API routes to use `getAuth()` + user ID mapping
- [ ] Port edge functions to API routes
- [ ] Replace RealtimeMonitor with polling (3s interval)

**Week 5: Ship + Monitor**
- [ ] Deploy to production
- [ ] Monitor auth flows, error rates
- [ ] Verify: Imported users sign in seamlessly
- [ ] Verify: OAuth users sign in (webhook creates mapping)

---

### wishlist-ios — THIRD (after wishlist web)

**After web is stable:**
- [ ] Add Clerk iOS SDK via Swift Package Manager
- [ ] Configure Clerk with publishable key in App.swift
- [ ] Update API base URL to new Vercel deployment
- [ ] Implement Clerk authentication (Apple Sign In, Email/Password)
- [ ] Update API calls to use Clerk session token
- [ ] Implement polling for list updates (replace RealtimeMonitor)
- [ ] TestFlight testing with existing users
- [ ] Verify: Imported users can sign in with original password
- [ ] Verify: OAuth users can sign in via Clerk
- [ ] Ship update

---

### episodic-ios — FIRST

**Note**: Episodic is iOS-only, so you need a backend API project.

**Key insight**: Clerk handles all auth (including iOS SDK). Database queries use `@neondatabase/serverless` directly.

**Migration Order:**
1. Create Neon project + backend API
2. Create Clerk application + import users (with bcrypt hashes!)
3. Migrate data + set up user ID mapping
4. Storage → R2 (custom domain for prod)
5. Build API routes with Clerk + Neon
6. Update iOS app with Clerk SDK
7. Ship

**Week 1: Neon Project + Data Migration**
- [ ] Create Neon project: `episodic-prod`
- [ ] Set up Neon↔Vercel integration for preview branches
- [ ] Export schema from `episodic-ios/supabase/migrations`
- [ ] Apply schema to Neon
- [ ] Create `user_id_mapping` table
- [ ] Backfill app tables (shows, episodes, watch_history, ratings, etc.)
- [ ] Verify row counts match Supabase

**Week 2: Clerk Application + User Import**
- [ ] Create Clerk application at dashboard.clerk.com
- [ ] Configure Apple OAuth provider in Clerk Dashboard
- [ ] Export users from Supabase (with password hashes via SQL)
- [ ] Import email/password users to Clerk via Backend API (bcrypt hashes preserved!)
- [ ] Create user ID mappings for imported users
- [ ] Set up Clerk webhook for new user sync
- [ ] Test: Imported users can log in with original password
- [ ] Test: Apple Sign In works (webhook creates mapping)

**Week 3: Storage (R2)**
- [ ] Create R2 bucket: `episodic-uploads`
- [ ] **Set up custom domain** (not r2.dev for production)
- [ ] Migrate profile images from Supabase Storage
- [ ] Rewrite URLs in database (old Supabase URLs → R2 URLs)
- [ ] Create `/api/upload` presigned URL endpoint

**Week 4: Backend API (Clerk + Neon)**
- [ ] Create `episodic-api` Next.js project
- [ ] Install `@clerk/nextjs` and `@neondatabase/serverless`
- [ ] Set up Clerk middleware
- [ ] Implement user ID mapping helper
- [ ] Create API routes with `getAuth()` + direct SQL queries

Edge functions to port:
- [ ] `/api/shows/search`, `/api/shows/add`, `/api/shows/[id]/import`
- [ ] `/api/shows/user`, `/api/shows/[id]/status`, `/api/shows/[id]/refresh`, `/api/shows/[id]/rate`
- [ ] `/api/episodes/calendar`, `/api/episodes/up-next`, `/api/episodes/[id]/toggle`, `/api/episodes/[id]/rate`
- [ ] `/api/seasons/[id]/watched`
- [ ] `/api/history`, `/api/statistics`
- [ ] `/api/cron/refresh-all-shows` + vercel.json cron config
- [ ] `/api/webhooks/clerk` for user sync

**Week 5: iOS App Update**
- [ ] Add Clerk iOS SDK via Swift Package Manager
- [ ] Configure Clerk with publishable key in App.swift
- [ ] Update API base URL to new Vercel deployment
- [ ] Implement Clerk authentication (Apple Sign In, Email/Password)
- [ ] Update API calls to use Clerk session token
- [ ] Handle R2 presigned URLs for uploads
- [ ] TestFlight build and testing
- [ ] Verify: Imported users sign in with original password
- [ ] Verify: OAuth users sign in via Clerk

**Week 6: Ship**
- [ ] Remove Supabase Swift package from iOS
- [ ] Remove Supabase env vars from Vercel
- [ ] Deploy API to production
- [ ] Submit iOS update to App Store
- [ ] Monitor error rates for 1 week

---

## Quick Reference

```bash
# Neon
neonctl projects create --name <name> --region aws-us-east-1
neonctl connection-string <project>

# Drizzle
npx drizzle-kit generate
npx drizzle-kit push
npx drizzle-kit studio

# R2
wrangler r2 bucket create <name>
wrangler r2 bucket list

# Secrets sync
~/.secrets/sync-to-vercel.sh

# Vercel
vercel env ls
vercel --prod
```

---

## Execution Summary

1. **Episodic**: Neon project + Clerk application → Import users (with bcrypt hashes!) → Data migration → Clerk SDK + Neon queries → iOS update
2. **Wishlist web**: Same pattern after Episodic proven
3. **Wishlist iOS**: Clerk iOS SDK + point to new API, polling for realtime
4. **Everything else**: Stay on Supabase until you need to launch it

**User experience during migration:**
- **OAuth users**: Sign in again → seamless (Clerk creates account, webhook creates mapping)
- **Email/password users**: Log in with existing password → seamless (imported with bcrypt hash)
- **New users**: Normal signup flow (webhook creates mapping)

**Code migration:**
- Use `@clerk/nextjs` for auth (middleware + `getAuth()`)
- Use `@neondatabase/serverless` for database queries
- Create user ID mapping table (Clerk string ID → database UUID)
- Set up Clerk webhook for automatic user sync

**Full isolation achieved:**
- Each app has its own Neon database
- Each app has its own Clerk application
- Each app has its own R2 bucket (custom domain for prod)
- No shared failure domains

This gives you complete decoupling from Supabase with better auth features (Apple, SMS, Email).

---

## Sources

- [Clerk Documentation](https://clerk.com/docs) — **Start here for auth**
- [Clerk Migration Guide](https://clerk.com/docs/deployments/migrate-overview) — User import with password hashes
- [Clerk iOS SDK](https://clerk.com/docs/quickstarts/ios) — Native Swift SDK
- [Clerk Backend API](https://clerk.com/docs/reference/backend-api) — User import, webhooks
- [@neondatabase/serverless](https://neon.tech/docs/serverless/serverless-driver) — Database driver for Vercel
- [Neon↔Vercel Integration](https://neon.tech/docs/guides/vercel)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Cloudflare R2 Custom Domains](https://developers.cloudflare.com/r2/buckets/public-buckets/#custom-domains)
- [Neon Pricing](https://neon.tech/pricing)
- [Clerk Pricing](https://clerk.com/pricing) — Free tier: 10k MAU
