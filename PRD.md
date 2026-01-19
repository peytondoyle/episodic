# Episodic - Product Requirements Document

**Version:** 0.1.0 (Pre-Alpha)
**Last Updated:** December 30, 2025
**Current Platform:** Web (Next.js)
**Target Platform:** iOS 17.0+ (Native SwiftUI)
**Backend:** Supabase (PostgreSQL, Auth)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Non-Negotiable Contracts](#2-non-negotiable-contracts)
3. [Current State Assessment](#3-current-state-assessment)
4. [Product Vision](#4-product-vision)
5. [User Personas & Use Cases](#5-user-personas--use-cases)
6. [Feature Specification](#6-feature-specification)
7. [Screen-by-Screen UI Specification](#7-screen-by-screen-ui-specification)
8. [Design System](#8-design-system)
9. [Data Architecture](#9-data-architecture)
10. [Technical Architecture](#10-technical-architecture)
11. [Build Sequence](#11-build-sequence)
12. [Roadmap](#12-roadmap)

---

## 1. Executive Summary

### 1.1 Product Vision

Episodic is a TV show tracking app that helps users manage their watching across multiple streaming platforms. Users can track which episodes they've watched, see what's coming up next, and never lose their place in a series again.

### 1.2 Core Value Proposition

- **For Casual Viewers:** Know where you left off in any show
- **For Binge Watchers:** Track progress across multiple shows simultaneously
- **For Series Followers:** Get notified when new episodes air

### 1.3 Current Status

| Aspect | Status | Notes |
|--------|--------|-------|
| Web App | 30-40% Complete | Early prototype, functional but incomplete |
| iOS App | Not Started | Target platform |
| Backend | Partially Complete | Schema exists, some gaps |
| Authentication | Fake/Hardcoded | Critical blocker |
| TMDB Integration | Working | Core data source |

---

## 2. Non-Negotiable Contracts

These are architectural invariants that **must** be enforced. Breaking these causes the app to fail silently in confusing ways.

### 2.1 Data Integrity Invariants

> **Invariant 1: "If a show is in a user's library, it MUST have episodes."**

This is the exact failure mode in the current web prototype - shows get added but episodes never sync, making the tracker useless.

> **Invariant 2: "If a user_episodes row exists, the corresponding episodes row MUST exist."**

This protects against orphaned watch data during refresh jobs and partial migrations. Foreign key constraints enforce this at the DB level.

**Enforcement:**
1. **Add Show Operation** - Single atomic backend action (Supabase Edge Function) that guarantees:
   - Show exists in `shows` table
   - All episodes exist in `episodes` table
   - User link exists in `user_shows` table
   - User episode rows created in `user_episodes` (all unwatched)

2. **Nightly Refresh Job** - Cron job that:
   - Fetches newly aired episodes for all tracked shows
   - Updates episode air dates
   - Detects show status changes (ended, canceled)

3. **Foreign Key Constraints** - DB-level enforcement:
   - `user_episodes.episode_id REFERENCES episodes(id) ON DELETE CASCADE`
   - Cascade delete protects against orphans

**Why Edge Function:**
- iOS app stays simple (no TMDB API key in bundle)
- Single network call from client
- Transaction can rollback on partial failure
- Server controls retry logic
- **Security:** User ID derived from JWT, never trusted from client

### 2.2 "Up Next" Performance Contract

> **"Up Next must be a server-side query, not client-side filtering."**

Pulling all shows + all episodes to the client and filtering is:
- Slow on large libraries
- Battery-draining
- Creates waterfall network requests

**Implementation:** Database view or RPC function that returns per user:
- Next unwatched episode (first by air_date, then by season/episode)
- Show title, poster URL
- Season/episode numbers
- Episode title, air date
- Optional: "new since last open" flag

### 2.3 Canonical Show Status Values

> **"Every show in a user's library has exactly one status."**

**Canonical statuses:**

| Status | Definition |
|--------|------------|
| `watching` | Actively tracking, has unwatched episodes |
| `paused` | Taking a break, will resume |
| `completed` | Watched all available episodes |
| `dropped` | Abandoned, won't continue |

**Note:** "Watchlist" (want to watch but haven't started) is **not** a separate status. It's `watching` with 0 episodes watched. This keeps the model simple.

**Show status vs User status:**
- `shows.status` = Airing/Ended/Canceled/Upcoming (from TMDB)
- `user_shows.status` = Watching/Paused/Completed/Dropped (user's relationship)

---

## 3. Current State Assessment

### 3.1 What Exists (Web Prototype)

#### Working Features

| Feature | Location | Status |
|---------|----------|--------|
| TMDB Search | `/search` | ✅ Working |
| Add Show from TMDB | `TMDBSearch.tsx` | ✅ Working |
| View All Shows | `/shows` | ✅ Working |
| Episode Modal | `EpisodeModal.tsx` | ✅ Working |
| Toggle Episode Watched | `/api/toggle-watched` | ✅ Working |
| Basic Watchlist | `/watchlist` | ✅ Working |
| Site Navigation | `SiteHeader.tsx` | ✅ Working |

#### Broken/Incomplete Features

| Feature | Issue | Severity |
|---------|-------|----------|
| Authentication | Hardcoded UUID in `useUserId.ts` | 🔴 Critical |
| Home Page | Default Next.js template | 🟠 High |
| Show Detail Page | Stub only ("coming soon") | 🟠 High |
| Episode Sync | `syncEpisodesForShow` exists but never called | 🟠 High |
| Admin Import | Only logs to console, doesn't save | 🟡 Medium |
| Add to Watchlist | No UI to add show to user's watchlist | 🟠 High |

### 3.2 File Structure (Current)

```
episodic/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # ❌ Default Next.js (unused)
│   │   ├── layout.tsx                  # ✅ App layout with providers
│   │   ├── providers.tsx               # ✅ React Query provider
│   │   ├── globals.css                 # ✅ Tailwind globals
│   │   ├── shows/
│   │   │   ├── page.tsx                # ✅ All shows grid
│   │   │   └── [slug]/page.tsx         # ❌ Stub only
│   │   ├── search/page.tsx             # ✅ TMDB search
│   │   ├── watchlist/page.tsx          # ✅ User watchlist
│   │   ├── admin/page.tsx              # ⚠️ Partial (logs only)
│   │   └── api/
│   │       ├── toggle-watched/route.ts # ✅ Working
│   │       └── ok/route.ts             # ✅ Health check
│   ├── components/
│   │   ├── EpisodeCard.tsx             # ✅ Episode display
│   │   ├── EpisodeModal.tsx            # ✅ Episode list modal
│   │   ├── ShowCard.tsx                # ✅ Show card
│   │   ├── SiteHeader.tsx              # ✅ Navigation
│   │   ├── StatusBadge.tsx             # ✅ Status indicator
│   │   ├── TMDBSearch.tsx              # ✅ TMDB search UI
│   │   ├── ToggleWatchedButton.tsx     # ✅ Watch toggle
│   │   └── ui/dialog.tsx               # ✅ Radix dialog
│   ├── hooks/
│   │   ├── useShows.ts                 # ✅ Show queries
│   │   ├── useUserShows.ts             # ✅ User show queries
│   │   └── useUserId.ts                # ❌ Hardcoded UUID
│   └── lib/
│       ├── types.ts                    # ✅ TypeScript types
│       ├── shows.ts                    # ✅ Show operations
│       ├── userShows.ts                # ✅ User show operations
│       ├── tmdb.ts                     # ✅ TMDB API client
│       ├── addShowFromTMDB.ts          # ⚠️ Exists, not used
│       ├── supabase.ts                 # ✅ Supabase client
│       └── utils.ts                    # ✅ Utilities
├── public/
│   └── fallback.png                    # ✅ Fallback image
├── package.json
└── [config files]
```

### 3.3 Database Schema (Current)

```sql
-- Shows table (global, shared across all users)
CREATE TABLE shows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    poster_url  TEXT,
    status      TEXT,                    -- 'airing', 'ended', 'canceled', 'coming_soon'
    platform    TEXT,                    -- Actually stores homepage URL (misnamed)
    synopsis    TEXT,
    tmdb_id     TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Episodes table (per show)
CREATE TABLE episodes (
    id          TEXT PRIMARY KEY,        -- Format: "{showId}-s{season}e{episode}"
    show_id     UUID REFERENCES shows(id),
    season      INTEGER NOT NULL,
    episode     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    air_date    DATE,
    summary     TEXT
);

-- User's tracked shows
CREATE TABLE user_shows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,           -- Should reference auth.users
    show_id     UUID REFERENCES shows(id),
    status      TEXT DEFAULT 'watching',  -- 'watching', 'paused', 'completed', 'dropped'
    added_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, show_id)
);

-- User's episode watch status
CREATE TABLE user_episodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    episode_id  TEXT REFERENCES episodes(id),
    show_id     UUID REFERENCES shows(id),  -- Denormalized for queries
    watched     BOOLEAN DEFAULT FALSE,
    watched_at  TIMESTAMPTZ
);
```

### 3.4 Critical Bugs

#### Bug #1: Authentication is Fake

**Location:** `src/hooks/useUserId.ts`
```typescript
export function useUserId() {
  return '00000000-0000-0000-0000-000000000001'; // Hardcoded!
}
```

**Impact:** All users share the same data. No privacy, no personalization.

**Fix Required:** Implement Supabase Auth (Sign in with Apple, Email Magic Link).

#### Bug #2: Episodes Never Sync

**Problem:** When adding a show from TMDB, `insertShowFromTMDB` is called but `syncEpisodesForShow` is never invoked.

**Location:** `src/components/TMDBSearch.tsx` lines 28-43

**Result:** Shows are added to the database without any episodes, making the app useless for tracking.

**Fix Required:** Call `syncEpisodesForShow(showId, tmdbId)` after `insertShowFromTMDB`.

#### Bug #3: No Way to Add Shows to Personal Watchlist

**Problem:** The TMDB search adds shows to the global `shows` table, but never calls `addUserShow` to add them to the user's personal watchlist.

**Result:** Shows exist in the database but users can't track them.

#### Bug #4: Platform Field Misused

**Problem:** The `platform` column in `shows` table stores the show's homepage URL (from TMDB), not the streaming platform.

**Result:** Can't filter/group shows by streaming service.

---

## 4. Product Vision

### 4.1 Core Concept

Episodic tracks your TV watching progress across all streaming platforms. Unlike platform-specific "Continue Watching" features, Episodic works across Netflix, HBO, Apple TV+, and everything else.

### 4.2 Key Differentiators

| Feature | Episodic | Platform "Continue Watching" |
|---------|----------|------------------------------|
| Cross-platform | ✅ All services | ❌ One service only |
| Explicit tracking | ✅ You control it | ❌ Auto-tracked (often wrong) |
| Upcoming episodes | ✅ Air date tracking | ⚠️ Varies |
| Share recommendations | ✅ Future feature | ❌ No |

### 4.3 Target Users

1. **Multi-Platform Subscribers** - People with 3+ streaming services
2. **Household Sharers** - Families where multiple people watch the same show
3. **Binge Watchers** - People watching 5+ shows simultaneously
4. **Seasonal Watchers** - People who wait for seasons to complete

---

## 5. User Personas & Use Cases

### 4.1 Primary Personas

#### Persona A: Multi-Platform Mike
- Subscribes to Netflix, HBO, Apple TV+, Disney+
- Watches 8-10 shows actively
- Loses track of where he is in shows across platforms
- Wants: Single place to see "what's next" across all services

#### Persona B: Household Hannah
- Shares streaming accounts with family
- Platform "Continue Watching" gets polluted by others
- Wants: Her own personal watch history that no one else affects

#### Persona C: Seasonal Sam
- Waits for shows to finish airing before watching
- Follows 20+ shows but only actively watches 2-3
- Wants: To know when shows finish their seasons

### 4.2 Core Use Cases

| Use Case | Actor | Flow |
|----------|-------|------|
| Add Show to Track | Mike | Search → Find show → Add to Watchlist |
| Mark Episode Watched | Mike | Open show → Mark episode(s) watched |
| See What's Next | Mike | Open app → See "Up Next" across all shows |
| Check New Episodes | Sam | Open app → See shows with new episodes since last visit |
| Track Season Progress | Hannah | Open show → See X/Y episodes watched |

---

## 6. Feature Specification

### 5.1 MVP Features (iOS v1.0)

#### Authentication
| Feature | Priority | Status |
|---------|----------|--------|
| Sign in with Apple | P0 | 🔲 Not Started |
| Email Magic Link | P1 | 🔲 Not Started |
| Session Persistence | P0 | 🔲 Not Started |
| Sign Out | P0 | 🔲 Not Started |

#### Show Management
| Feature | Priority | Status |
|---------|----------|--------|
| Search TMDB | P0 | ✅ Web Working |
| Add Show to Watchlist | P0 | 🔲 UI Missing |
| Remove Show from Watchlist | P1 | 🔲 Not Started |
| View Show Details | P0 | ⚠️ Stub Only |
| Show Status Badge | P1 | ✅ Web Working |

#### Episode Tracking
| Feature | Priority | Status |
|---------|----------|--------|
| View Episode List | P0 | ✅ Web Working |
| Mark Episode Watched | P0 | ✅ Web Working |
| Mark Episode Unwatched | P0 | ✅ Web Working |
| Batch Mark (whole season) | P1 | 🔲 Not Started |
| Episode Air Dates | P0 | ✅ Data Available |

#### Ratings
| Feature | Priority | Status |
|---------|----------|--------|
| Episode Rating (5-star) | P1 | 🔲 Not Started |
| Season Rating (manual 5-star) | P1 | 🔲 Not Started |
| Season Average (computed) | P1 | 🔲 Not Started |
| Show Rating (optional) | P2 | 🔲 Not Started |

**Rating Design Decisions:**
- Ratings are **private/personal** (stored in `user_*` tables, future-proofed for friend sharing)
- 5-star control: tap to set, tap again to clear
- **Don't prompt** after marking watched (slows people down)
- Optional "Rate" quick action on episode detail
- Season rating: manual wins if set, otherwise displays "Avg" from rated episodes
- Unrated episodes don't count toward season average

**v1 Scope:**
- ✅ Episode stars
- ✅ Season stars (manual)
- ✅ Season "Avg from episodes" when manual not set
- ❌ Half-stars (skip)
- ❌ Rating prompts after every watch (skip)
- ❌ Written reviews (add later as "Add note")

#### Progress Tracking
| Feature | Priority | Status |
|---------|----------|--------|
| "Up Next" Episode per Show | P0 | 🔲 Not Started |
| Show Progress (X/Y watched) | P0 | 🔲 Not Started |
| Overall Watchlist Progress | P2 | 🔲 Not Started |

#### Discovery
| Feature | Priority | Status |
|---------|----------|--------|
| Browse All Shows | P1 | ✅ Web Working |
| Filter by Status | P2 | 🔲 Not Started |
| Sort Options | P2 | 🔲 Not Started |

### 5.2 Future Features (v1.1+)

| Feature | Priority | Notes |
|---------|----------|-------|
| Push Notifications (new episodes) | P1 | Requires backend job |
| Streaming Platform Tags | P2 | Where to watch |
| Watch History Timeline | P2 | When you watched what |
| Share Show Recommendations | P3 | Social feature |
| Widgets (Up Next) | P2 | iOS Home Screen |
| Statistics (hours watched) | P3 | Engagement feature |

---

## 7. Screen-by-Screen UI Specification

### 6.1 Tab Structure (iOS)

```
┌─────────────────────────────────────────────────────────────┐
│                      Episodic App                            │
├─────────────────────────────────────────────────────────────┤
│  Authenticated?                                              │
│  ├─ NO  → LoginView                                          │
│  └─ YES → MainTabView                                        │
│           ├─ Tab 1: Up Next (UpNextView)                     │
│           ├─ Tab 2: Shows (ShowsView)                        │
│           ├─ Tab 3: Search (SearchView)                      │
│           └─ Tab 4: Profile (ProfileView)                    │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 LoginView

**Purpose:** Authentication entry point

```
┌─────────────────────────────────────┐
│         [Gradient Background]        │
│                                      │
│              📺                       │
│           Episodic                   │
│     Track your TV watching          │
│                                      │
│    ┌─────────────────────────┐      │
│    │  Sign in with Apple    │      │
│    └─────────────────────────┘      │
│                                      │
│    ┌─────────────────────────┐      │
│    │  Continue with Email    │      │
│    └─────────────────────────┘      │
│                                      │
└─────────────────────────────────────┘
```

**Components:**
- App icon/logo
- Sign in with Apple button (primary)
- Email magic link button (secondary)

---

### 6.3 UpNextView (Home Tab)

**Purpose:** Show what to watch next across all shows

```
┌─────────────────────────────────────┐
│ Up Next                       [👤]  │
├─────────────────────────────────────┤
│                                      │
│ CONTINUE WATCHING (3)                │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] Severance              │ │
│ │          S2 E4 · "Woe's Hollow" │ │
│ │          45 min                 │ │
│ │          [▶ Continue]           │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] The Bear               │ │
│ │          S3 E7 · "Legacy"       │ │
│ │          32 min                 │ │
│ │          [▶ Continue]           │ │
│ └─────────────────────────────────┘ │
│                                      │
│ NEW EPISODES                         │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] Abbott Elementary      │ │
│ │          New: S4 E10 aired 2d   │ │
│ │          [+2 unwatched]         │ │
│ └─────────────────────────────────┘ │
│                                      │
│ COMING SOON                          │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] White Lotus             │ │
│ │          S3 premieres Feb 16    │ │
│ └─────────────────────────────────┘ │
│                                      │
└─────────────────────────────────────┘
   [Up Next]   [Shows]   [Search]  [Me]
```

**Sections:**
1. **Continue Watching** - Shows with partially-watched seasons (has next unwatched episode)
2. **New Episodes** - Shows with episodes that aired since you last watched
3. **Coming Soon** - Tracked shows with future air dates

**Card Design (UpNextCard):**
- Large poster image (100pt)
- Show title (16pt, semibold)
- Episode info: "S{X} E{Y} · {Title}"
- Air date or runtime
- Primary action button

---

### 6.4 ShowsView (Library Tab)

**Purpose:** View and manage all tracked shows

```
┌─────────────────────────────────────┐
│ My Shows                            │
├─────────────────────────────────────┤
│ [Watching ▼]  [Sort: A-Z ▼]   [🔍] │
├─────────────────────────────────────┤
│                                      │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │[POSTER]│ │[POSTER]│ │[POSTER]│   │
│ │        │ │        │ │        │   │
│ │Severanc│ │The Bear│ │Abbott  │   │
│ │ 3/10   │ │ 25/34  │ │ 45/48  │   │
│ │▓▓▓░░░░░│ │▓▓▓▓▓▓░░│ │▓▓▓▓▓▓▓░│   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │[POSTER]│ │[POSTER]│ │[POSTER]│   │
│ │        │ │        │ │        │   │
│ │Shogun  │ │Slow Hor│ │The Morn│   │
│ │ 10/10 ✓│ │ 6/8    │ │ 156/365│   │
│ │▓▓▓▓▓▓▓▓│ │▓▓▓▓▓▓░░│ │▓▓▓▓░░░░│   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
└─────────────────────────────────────┘
   [Up Next]   [Shows]   [Search]  [Me]
```

**Filters:**
- **All** - All tracked shows
- **Watching** - Shows with progress > 0 and < 100%
- **Not Started** - Shows with 0% progress
- **Completed** - Shows with 100% progress

**Sort Options:**
- **A-Z** - Alphabetical
- **Recent Activity** - Last watched
- **Progress** - Completion percentage
- **Air Date** - Most recent episode

**Card Design (ShowGridCard):**
- Poster image (fills card width)
- Show title (14pt, semibold)
- Progress text: "X/Y" episodes
- Progress bar (thin, accent color)
- Checkmark overlay if completed

---

### 6.5 ShowDetailView

**Purpose:** View show info and manage episode progress

```
┌─────────────────────────────────────┐
│ ←                            [⋯]    │
├─────────────────────────────────────┤
│         [HERO POSTER IMAGE]          │
│                                      │
│ Severance                            │
│ Drama · Apple TV+ · Returning       │
│ ★ 8.7/10 (TMDB)                     │
│                                      │
│ Your Rating: ☆☆☆☆☆ [tap to rate]   │
│                                      │
│ 3 of 19 episodes watched            │
│ ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░ 16%    │
│                                      │
│ [▶ Continue S2E4]    [Mark Watched] │
│                                      │
├─────────────────────────────────────┤
│ SEASON 2              ★★★★☆ 8/9    │
│ ┌─────────────────────────────────┐ │
│ │ ✓  E1 · "Hello, Ms. Cobel"     │ │
│ │     Jan 17, 2025 · 57m  ★★★★★  │ │
│ ├─────────────────────────────────┤ │
│ │ ✓  E2 · "Goodbye, Mrs. Selvig" │ │
│ │     Jan 17, 2025 · 48m  ★★★★☆  │ │
│ ├─────────────────────────────────┤ │
│ │ ✓  E3 · "Who Is Alive?"        │ │
│ │     Jan 24, 2025 · 52m  ★★★☆☆  │ │
│ ├─────────────────────────────────┤ │
│ │ ○  E4 · "Woe's Hollow"         │ │
│ │     Jan 31, 2025 · 49m         │ │
│ │     ← UP NEXT                  │ │
│ ├─────────────────────────────────┤ │
│ │ ○  E5 · "Trojan's Horse"       │ │
│ │     Feb 7, 2025 · 51m          │ │
│ └─────────────────────────────────┘ │
│                                      │
│ SEASON 1        ★★★★★ (Avg) [▶] 9/9│
│ ┌─────────────────────────────────┐ │
│ │ (Collapsed - all watched)      │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ABOUT                                │
│ Mark S. leads a team at Lumon...    │
│ [Read more]                          │
│                                      │
└─────────────────────────────────────┘
```

**Header:**
- Back button
- More menu: Remove from Library, Share

**Hero Section:**
- Large poster image (160pt height)
- Show title (24pt, bold)
- Metadata: Genre · Platform · Status
- TMDB rating (from API)
- **Your Rating:** 5-star control (tap to set, tap again to clear)
- Overall progress bar

**Actions:**
- **Continue** - Opens external link or marks next episode
- **Mark Watched** - Batch mark options

**Season Header:**
- "SEASON X" label
- **Season rating:** 5 stars (manual or computed "Avg")
- Progress badge (X/Y episodes)
- Expand/collapse chevron

**Episode Rows:**
- Watch status icon (✓ or ○)
- Episode number + title
- Air date + runtime
- **Episode rating:** Small stars if rated (shown inline)
- "UP NEXT" indicator for next unwatched

**Interaction Model (v1):**

| Gesture | Action |
|---------|--------|
| **Tap episode row** | Toggle watched status (fast, addictive) |
| **Long-press episode** | Opens context menu (Rate, Mark Watched/Unwatched, View Details) |
| **Swipe left** | Quick actions (Rate, Details) |
| **Tap season stars** | Set/clear manual season rating |
| **Tap show stars** | Set/clear show rating |

> **Design Decision:** Tap toggles watched because it's the most common action. Rating and details are secondary, accessed via long-press or swipe. This keeps the episode list snappy for binge-tracking.

---

### 6.6 SearchView

**Purpose:** Find and add new shows to track

```
┌─────────────────────────────────────┐
│ Search                              │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 🔍 Search TV shows...           │ │
│ └─────────────────────────────────┘ │
│                                      │
│ TRENDING                             │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │[POSTER]│ │[POSTER]│ │[POSTER]│   │
│ │Severanc│ │Squid Gm│ │White Lo│   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
│ POPULAR                              │
│ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │[POSTER]│ │[POSTER]│ │[POSTER]│   │
│ │Breaking│ │Game Thr│ │The Offi│   │
│ └────────┘ └────────┘ └────────┘   │
│                                      │
└─────────────────────────────────────┘

[After typing in search...]

┌─────────────────────────────────────┐
│ ┌─────────────────────────────────┐ │
│ │ 🔍 severance              [✕]   │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] Severance              │ │
│ │          2022 · Apple TV+       │ │
│ │          ★ 8.7 · 2 seasons      │ │
│ │          [+ Add to Library]     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [POSTER] Severance (2006)       │ │
│ │          2006 · Film            │ │
│ │          ★ 5.2                  │ │
│ │          [+ Add to Library]     │ │
│ └─────────────────────────────────┘ │
│                                      │
└─────────────────────────────────────┘
   [Up Next]   [Shows]   [Search]  [Me]
```

**States:**
1. **Empty** - Show trending/popular suggestions
2. **Typing** - Live search results from TMDB
3. **Results** - Show matches with add button

**Search Result Card:**
- Poster (60pt)
- Title + Year
- Platform/Network
- Rating + Season count
- Add button (or "In Library" badge)

---

### 6.7 ProfileView

**Purpose:** Account settings and preferences

```
┌─────────────────────────────────────┐
│ Profile                             │
├─────────────────────────────────────┤
│                                      │
│           ┌──────────┐              │
│           │  [PHOTO] │              │
│           │    📷    │              │
│           └──────────┘              │
│           John Doe                   │
│         john@email.com              │
│                                      │
├─────────────────────────────────────┤
│ APPEARANCE                           │
│ ┌─────────────────────────────────┐ │
│ │ ☀️  Appearance          Dark  → │ │
│ ├─────────────────────────────────┤ │
│ │ 🎨  Theme Color       Purple  → │ │
│ └─────────────────────────────────┘ │
│                                      │
│ STATISTICS                           │
│ ┌─────────────────────────────────┐ │
│ │  📺  Shows Tracking          12 │ │
│ ├─────────────────────────────────┤ │
│ │  ✓   Episodes Watched       847 │ │
│ ├─────────────────────────────────┤ │
│ │  🕐  Time Watched       ~423 hr │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ACCOUNT                              │
│ ┌─────────────────────────────────┐ │
│ │ 🚪  Sign Out                    │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ABOUT                                │
│ ┌─────────────────────────────────┐ │
│ │     Version              1.0.0  │ │
│ └─────────────────────────────────┘ │
│                                      │
└─────────────────────────────────────┘
   [Up Next]   [Shows]   [Search]  [Me]
```

---

## 8. Design System

### 7.1 Design Philosophy

Inspired by Wishlist iOS app:
- **Bold, Immersive Colors** - Palette-tinted backgrounds, not neutral gray
- **Clear Information Hierarchy** - Important info prominent, secondary info subtle
- **Generous Spacing** - Content has room to breathe
- **Large Media** - Posters are hero elements, not thumbnails

### 7.2 Color Architecture

#### Layer System (Elevation)

| Layer | Light Mode | Dark Mode | Usage |
|-------|------------|-----------|-------|
| Layer 0 | Warm cream (97%) | Deep charcoal (10%) | Global background |
| Layer 1 | White (100%) | Elevated (16%) | Cards, panels |
| Layer 2 | Soft warm (95%) | Element (20%) | Interactive surfaces |
| Layer 3 | Warm chip (92%) | Visible chip (26%) | Pills, tags |

#### Semantic Colors

| Token | Usage |
|-------|-------|
| `accent` | Primary actions, progress bars, selected states |
| `textPrimary` | Main content |
| `textSecondary` | Supporting content |
| `textMuted` | Timestamps, metadata |
| `success` | Watched indicators |
| `warning` | Upcoming episodes |
| `destructive` | Remove actions |

#### Palette Options (8 Initial)

| Palette | Accent Color | Vibe |
|---------|--------------|------|
| Purple | HSB(275, 70%, 54%) | Default, modern |
| Blue | HSB(210, 80%, 50%) | Professional |
| Teal | HSB(175, 80%, 52%) | Fresh |
| Pink | HSB(328, 80%, 58%) | Playful |
| Orange | HSB(30, 85%, 56%) | Warm |
| Green | HSB(145, 68%, 54%) | Natural |
| Red | HSB(0, 75%, 55%) | Bold |
| Indigo | HSB(240, 75%, 58%) | Deep |

### 7.3 Typography Scale

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `displayLarge` | 32pt | Bold | Hero headlines |
| `displayMedium` | 26pt | Bold | Screen titles |
| `headlineLarge` | 22pt | Semibold | Section headers |
| `headlineMedium` | 18pt | Semibold | Card titles |
| `bodyLarge` | 17pt | Regular | Primary body |
| `bodyMedium` | 15pt | Regular | Secondary body |
| `caption` | 13pt | Medium | Labels |
| `captionSmall` | 11pt | Medium | Timestamps |

### 7.4 Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4pt | Tight inline |
| `sm` | 8pt | Component internal |
| `md` | 12pt | Related elements |
| `lg` | 16pt | Standard padding |
| `xl` | 20pt | Screen edges |
| `xxl` | 24pt | Section spacing |
| `section` | 32pt | Major sections |

### 7.5 Corner Radii

| Token | Value | Usage |
|-------|-------|-------|
| `small` | 8pt | Badges, small elements |
| `medium` | 12pt | Buttons, inputs |
| `large` | 16pt | Cards, images |
| `xl` | 20pt | Main cards |
| `poster` | 12pt | Poster images |

### 7.6 Component Library

#### Cards
- `UpNextCard` - Large horizontal card for continue watching
- `ShowGridCard` - Poster grid card with progress
- `EpisodeRow` - Episode list item
- `SearchResultCard` - Search result with add action

#### Buttons
- `PrimaryButton` - Accent background, white text
- `SecondaryButton` - Outline style
- `GhostButton` - Text only

#### Badges
- `StatusBadge` - Show status (Airing, Ended, etc.)
- `ProgressBadge` - Episode count (X/Y)
- `WatchedBadge` - Checkmark indicator

#### Progress
- `ProgressBar` - Thin horizontal bar
- `CircularProgress` - Ring indicator (optional)

---

## 9. Data Architecture

### 8.1 Core Models (Swift)

```swift
// MARK: - Show

struct Show: Codable, Identifiable {
    let id: UUID
    var title: String
    var slug: String
    var posterUrl: String?
    var backdropUrl: String?
    var status: ShowStatus         // airing, ended, canceled, upcoming
    var synopsis: String?
    var tmdbId: String
    var network: String?           // e.g., "Apple TV+", "HBO"
    var genre: String?
    var rating: Double?
    var firstAirDate: Date?
    var updatedAt: Date
}

enum ShowStatus: String, Codable {
    case airing = "airing"
    case ended = "ended"
    case canceled = "canceled"
    case upcoming = "upcoming"
}

// MARK: - Episode

struct Episode: Codable, Identifiable {
    let id: String                 // Format: "{showId}-s{season}e{episode}"
    let showId: UUID
    var season: Int
    var episode: Int
    var title: String
    var airDate: Date?
    var runtime: Int?              // minutes
    var summary: String?
    var stillImageUrl: String?
}

// MARK: - User Tracking

enum WatchStatus: String, Codable {
    case watching = "watching"
    case paused = "paused"
    case completed = "completed"
    case dropped = "dropped"
}

struct UserEpisode: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let episodeId: String
    let showId: UUID               // Denormalized
    var watched: Bool
    var watchedAt: Date?
    var rating: Int?               // 1-5 stars, nil = unrated
}

struct UserSeason: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let showId: UUID
    var seasonNumber: Int
    var rating: Int?               // 1-5 stars, nil = unrated (use computed avg)
    var notes: String?             // Optional, for v1.1+
}

struct UserShow: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let showId: UUID
    var status: WatchStatus
    var rating: Int?               // Overall show rating (optional)
    var addedAt: Date
    var updatedAt: Date
}

// MARK: - View Models

struct ShowWithProgress {
    let show: Show
    let userShow: UserShow
    let watchedCount: Int
    let totalCount: Int
    let nextEpisode: Episode?

    var progress: Double {
        guard totalCount > 0 else { return 0 }
        return Double(watchedCount) / Double(totalCount)
    }
}

struct EpisodeWithStatus {
    let episode: Episode
    let watched: Bool
    let watchedAt: Date?
    let isUpNext: Bool
    let rating: Int?               // User's rating (1-5)
}

struct SeasonGroup {
    let seasonNumber: Int
    let episodes: [EpisodeWithStatus]
    let watchedCount: Int
    let manualRating: Int?         // User's manual season rating

    var totalCount: Int { episodes.count }
    var isComplete: Bool { watchedCount == totalCount }

    /// Computed average from rated episodes (nil if no episodes rated)
    var averageRating: Double? {
        let rated = episodes.compactMap { $0.rating }
        guard !rated.isEmpty else { return nil }
        return Double(rated.reduce(0, +)) / Double(rated.count)
    }

    /// Display rating: manual wins, otherwise computed average
    var displayRating: Double? {
        if let manual = manualRating { return Double(manual) }
        return averageRating
    }

    /// True if showing computed average (vs manual)
    var isAverageRating: Bool {
        manualRating == nil && averageRating != nil
    }
}
```

### 8.2 Updated Database Schema

```sql
-- Shows table (enhanced)
CREATE TABLE shows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    poster_url      TEXT,
    backdrop_url    TEXT,
    status          TEXT NOT NULL DEFAULT 'airing',
    synopsis        TEXT,
    tmdb_id         TEXT NOT NULL UNIQUE,
    network         TEXT,                -- Actual network/platform
    genre           TEXT,
    rating          DECIMAL(3,1),
    first_air_date  DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Episodes table (enhanced)
CREATE TABLE episodes (
    id              TEXT PRIMARY KEY,
    show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season          INTEGER NOT NULL,
    episode         INTEGER NOT NULL,
    title           TEXT NOT NULL,
    air_date        DATE,
    runtime         INTEGER,             -- minutes
    summary         TEXT,
    still_url       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(show_id, season, episode)
);

-- User shows (enhanced)
CREATE TABLE user_shows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'watching',
    rating          SMALLINT CHECK (rating >= 1 AND rating <= 5),  -- Overall show rating
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, show_id)
);

-- User seasons (NEW - for season-level ratings)
-- Separate table because seasons are repeating entities
CREATE TABLE user_seasons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    season_number   INTEGER NOT NULL,
    rating          SMALLINT CHECK (rating >= 1 AND rating <= 5),  -- Manual season rating
    notes           TEXT,                                          -- Optional, v1.1+
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, show_id, season_number)
);

-- User episodes (enhanced with rating)
CREATE TABLE user_episodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    episode_id      TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    show_id         UUID NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    watched         BOOLEAN DEFAULT FALSE,
    watched_at      TIMESTAMPTZ,
    rating          SMALLINT CHECK (rating >= 1 AND rating <= 5),  -- Episode rating
    UNIQUE(user_id, episode_id)
);

-- Indexes for performance
CREATE INDEX idx_episodes_show_id ON episodes(show_id);
CREATE INDEX idx_episodes_air_date ON episodes(air_date);
CREATE INDEX idx_user_shows_user_id ON user_shows(user_id);
CREATE INDEX idx_user_seasons_user_id ON user_seasons(user_id);
CREATE INDEX idx_user_seasons_show_id ON user_seasons(show_id);
CREATE INDEX idx_user_episodes_user_id ON user_episodes(user_id);
CREATE INDEX idx_user_episodes_show_id ON user_episodes(show_id);
```

### 8.3 Key Queries

```sql
-- Get user's shows with progress
SELECT
    s.*,
    us.status as watch_status,
    us.added_at,
    COUNT(e.id) as total_episodes,
    COUNT(ue.id) FILTER (WHERE ue.watched = true) as watched_episodes
FROM shows s
JOIN user_shows us ON s.id = us.show_id
LEFT JOIN episodes e ON s.id = e.show_id
LEFT JOIN user_episodes ue ON e.id = ue.episode_id AND ue.user_id = us.user_id
WHERE us.user_id = $1
GROUP BY s.id, us.id
ORDER BY us.updated_at DESC;

-- Get "Up Next" episodes
SELECT
    e.*,
    s.title as show_title,
    s.poster_url
FROM episodes e
JOIN shows s ON e.show_id = s.id
JOIN user_shows us ON s.id = us.show_id
LEFT JOIN user_episodes ue ON e.id = ue.episode_id AND ue.user_id = us.user_id
WHERE us.user_id = $1
  AND us.status = 'watching'
  AND (ue.watched IS NULL OR ue.watched = false)
  AND e.air_date <= CURRENT_DATE
ORDER BY e.air_date ASC, e.season ASC, e.episode ASC;

-- Get season ratings (manual + computed average)
SELECT
    e.season as season_number,
    us_season.rating as manual_rating,
    AVG(ue.rating) FILTER (WHERE ue.rating IS NOT NULL) as avg_rating,
    COUNT(ue.rating) FILTER (WHERE ue.rating IS NOT NULL) as rated_count,
    COALESCE(us_season.rating, AVG(ue.rating) FILTER (WHERE ue.rating IS NOT NULL)) as display_rating
FROM episodes e
LEFT JOIN user_episodes ue ON e.id = ue.episode_id AND ue.user_id = $1
LEFT JOIN user_seasons us_season ON us_season.show_id = e.show_id
    AND us_season.season_number = e.season
    AND us_season.user_id = $1
WHERE e.show_id = $2
GROUP BY e.season, us_season.rating
ORDER BY e.season;
```

---

## 10. Technical Architecture

### 9.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        iOS App                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SwiftUI Views + @StateObject ViewModels             │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Service Layer (async/await)                         │   │
│  │  AuthManager · ShowService · EpisodeService          │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
└───────────────────────────│──────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │    Auth     │  │  Postgres   │  │   Edge Functions    │ │
│  │  (Apple +   │  │   (Data)    │  │  - add-show         │ │
│  │   Email)    │  │             │  │  - search-tmdb      │ │
│  └─────────────┘  └─────────────┘  │  - get-up-next      │ │
│                                     └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       TMDB API                               │
│           (called by Edge Functions, not iOS)                │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Edge Functions (Server-Side)

#### `add-show` - Atomic Show Addition

**Input:**
```json
{
  "tmdb_id": 95396
}
```
> **Security:** `user_id` is derived from the Supabase auth JWT header, never from client payload. This prevents users from adding shows to other users' libraries.

**Operations (transactional):**
1. Extract `user_id` from JWT (`auth.uid()`)
2. Check if show exists in `shows` table
3. If not: fetch from TMDB, insert show
4. Fetch all seasons/episodes from TMDB
5. Upsert episodes into `episodes` table
6. Insert `user_shows` link (using JWT user_id)
7. Insert `user_episodes` rows (all unwatched)

**Output:**
```json
{
  "show_id": "uuid",
  "episode_count": 34
}
```

#### `search-tmdb` - TMDB Proxy

Keeps TMDB API key server-side. Simple passthrough. No auth required (search is public).

#### `get-up-next` - Up Next Query

**Input:** None (user_id from JWT)
```json
{}
```
> **Security:** `user_id` derived from JWT via `auth.uid()`

**Output:**
```json
{
  "up_next": [
    {
      "show_id": "uuid",
      "show_title": "Severance",
      "poster_url": "https://...",
      "episode_id": "...",
      "season": 2,
      "episode": 4,
      "episode_title": "Woe's Hollow",
      "air_date": "2025-01-31"
    }
  ]
}
```

### 9.3 Database Views/Functions

```sql
-- View: up_next_episodes
-- Returns the next unwatched episode per show for a user
CREATE OR REPLACE FUNCTION get_up_next(p_user_id UUID)
RETURNS TABLE (
  show_id UUID,
  show_title TEXT,
  poster_url TEXT,
  episode_id TEXT,
  season INT,
  episode INT,
  episode_title TEXT,
  air_date DATE
) AS $$
  SELECT DISTINCT ON (s.id)
    s.id as show_id,
    s.title as show_title,
    s.poster_url,
    e.id as episode_id,
    e.season,
    e.episode,
    e.title as episode_title,
    e.air_date
  FROM shows s
  JOIN user_shows us ON s.id = us.show_id
  JOIN episodes e ON s.id = e.show_id
  LEFT JOIN user_episodes ue ON e.id = ue.episode_id AND ue.user_id = p_user_id
  WHERE us.user_id = p_user_id
    AND us.status = 'watching'
    AND (ue.watched IS NULL OR ue.watched = false)
    -- Only include episodes that have aired (known date in past)
    -- Exclude NULL air_date to prevent unpredictable "Up Next" entries
    AND e.air_date IS NOT NULL
    AND e.air_date <= CURRENT_DATE
  ORDER BY s.id, e.season ASC, e.episode ASC;
  -- Note: Ordering by season/episode instead of air_date for reliability
  -- (air_date can be inconsistent across sources)
$$ LANGUAGE SQL;

-- Alternative: For shows where ALL episodes have NULL air_dates (rare),
-- fall back to season/episode ordering. Handle this case in app logic
-- by checking if a show has 0 "Up Next" results despite being "watching".
```

### 9.4 iOS Service Layer

| Service | Responsibility | Calls |
|---------|---------------|-------|
| `AuthManager` | Sign in/out, session state | Supabase Auth |
| `ShowService` | Library CRUD, add show | Edge Function `add-show` |
| `EpisodeService` | Watch status toggle | Supabase direct |
| `RatingService` | Episode/season/show ratings | Supabase direct |
| `SearchService` | TMDB search | Edge Function `search-tmdb` |
| `UpNextService` | Home screen data | Edge Function `get-up-next` |
| `ThemeManager` | Palette, appearance | Local only |

---

## 11. Build Sequence

This order produces something usable ASAP while keeping foundations correct.

### Phase 1: SwiftUI Shell + Theme System

**Goal:** Runnable app with navigation skeleton

- [ ] Create Xcode project (XcodeGen or manual)
- [ ] Set up tab navigation: Home, Shows, Search, Profile
- [ ] Implement `ThemeManager` with design tokens
- [ ] Create placeholder views for each tab
- [ ] Basic color palette system (start with 1-2 palettes)

**Deliverable:** App launches, tabs work, colors consistent

### Phase 2: Authentication

**Goal:** Real user IDs, real row-level security

- [ ] Supabase project setup (if not done)
- [ ] Implement `AuthManager` singleton
- [ ] Sign in with Apple flow
- [ ] Session persistence
- [ ] Gated navigation (LoginView vs MainTabView)
- [ ] Row Level Security policies on all tables

**Deliverable:** Users can sign in, sessions persist

### Phase 3: Library Tab (Your Tracked Shows)

**Goal:** See shows you're tracking

- [ ] `ShowService` - fetch user's shows with progress
- [ ] `ShowsView` - grid of shows with progress bars
- [ ] `ShowGridCard` component
- [ ] Tap → navigate to Show Detail (placeholder)
- [ ] Pull-to-refresh

**Deliverable:** Authenticated users see their library

### Phase 4: Search + Add Show

**Goal:** The "guaranteed sync" path

- [ ] Edge Function: `add-show` (atomic add with episodes)
- [ ] Edge Function: `search-tmdb` (proxy)
- [ ] `SearchService` - call search proxy
- [ ] `SearchView` - search UI with results
- [ ] `SearchResultCard` with "Add" button
- [ ] Add button calls `add-show`, refreshes library

**Deliverable:** Users can search TMDB and add shows (with episodes!)

### Phase 5: Show Detail + Episodes + Ratings

**Goal:** View and mark episodes, rate content

- [ ] `ShowDetailView` - poster, metadata, progress
- [ ] Episode list grouped by season (collapsible)
- [ ] `EpisodeRow` component with watched toggle
- [ ] `EpisodeService` - toggle watched status
- [ ] Batch mark season (P1, can defer)
- [ ] Update progress when marking watched
- [ ] `RatingService` - set/clear ratings (episode, season, show)
- [ ] `StarRatingControl` - reusable 5-star component (tap to set, tap to clear)
- [ ] Episode rating (inline small stars)
- [ ] Season rating (in header, manual or "Avg" computed)
- [ ] Show rating (optional, in hero section)
- [ ] `user_seasons` table migration

**Deliverable:** Full episode tracking + ratings work

### Phase 6: Home (Up Next)

**Goal:** Smart home screen powered by server query

- [ ] Edge Function or DB function: `get-up-next`
- [ ] `UpNextService` - fetch up next data
- [ ] `UpNextView` - continue watching section
- [ ] `UpNextCard` component
- [ ] One-tap "Mark watched" from card
- [ ] New episodes section (if time)

**Deliverable:** App feels "smart" - shows what to watch next

### Phase 7: Polish

**Goal:** Production-ready feel

- [ ] Empty states for all views
- [ ] Loading skeletons
- [ ] Error handling + retry
- [ ] Haptic feedback on key actions
- [ ] Pull-to-refresh everywhere
- [ ] Profile view (stats, sign out)

**Deliverable:** App ready for TestFlight

---

## 12. Roadmap

### 11.1 MVP (v1.0) - Core Tracking

**Target:** Working app with essential features

| Feature | Priority | Effort |
|---------|----------|--------|
| Authentication (Apple + Email) | P0 | Medium |
| Search & Add Shows | P0 | Low |
| View Library | P0 | Low |
| Show Detail + Episodes | P0 | Medium |
| Mark Episodes Watched | P0 | Low |
| Up Next View | P0 | Medium |
| Basic Progress Tracking | P0 | Low |

### 11.2 v1.1 - Enhancement

| Feature | Priority | Effort |
|---------|----------|--------|
| Batch Mark Season | P1 | Low |
| Sort/Filter Library | P1 | Low |
| Theme Palettes | P2 | Low |
| Statistics | P2 | Medium |
| Pull-to-refresh + Sync | P1 | Low |

### 11.3 v1.2 - Engagement

| Feature | Priority | Effort |
|---------|----------|--------|
| Push Notifications | P1 | High |
| Widgets | P2 | Medium |
| Watch History Timeline | P2 | Medium |

### 11.4 v2.0 - Social

| Feature | Priority | Effort |
|---------|----------|--------|
| Share Recommendations | P3 | Medium |
| Follow Friends | P3 | High |
| Activity Feed | P3 | High |

---

## Appendix A: TMDB API Reference

### Key Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/search/tv?query={q}` | Search shows |
| `/tv/{id}` | Show details |
| `/tv/{id}/season/{n}` | Season episodes |

### Rate Limits
- 40 requests per 10 seconds
- Cache responses where possible

### Data Mapping

| TMDB Field | Episodic Field |
|------------|----------------|
| `name` | `title` |
| `poster_path` | `posterUrl` (prefix with base URL) |
| `status` | `status` (map to enum) |
| `overview` | `synopsis` |
| `networks[0].name` | `network` |
| `vote_average` | `rating` |

---

## Appendix B: Comparison with Wishlist iOS

### What to Adopt from Wishlist

| Pattern | Description |
|---------|-------------|
| Service singletons | `@MainActor` isolated services with `shared` instance |
| 3-layer color system | Surface → Panel → Element elevation |
| Palette architecture | Brand hue + Accent color system |
| Component naming | `XxxCard`, `XxxBadge`, `XxxRow` conventions |
| Settings-style rows | iOS native feel for profile/settings |
| Haptic feedback | Systematic use throughout app |

### Episodic-Specific Needs

| Need | Difference from Wishlist |
|------|--------------------------|
| Progress tracking | Wishlist doesn't track completion % |
| Air date awareness | Shows need "airing" status logic |
| Episode granularity | More complex than item reservations |
| Poster-heavy UI | TV shows are visual, need big posters |
| External API (TMDB) | Wishlist only uses Supabase |

---

*Document generated December 30, 2025*
