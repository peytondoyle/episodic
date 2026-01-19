-- Episodic Schema for Neon
-- No RLS (auth handled in API layer via Clerk)

-- Shows table (global, shared across all users)
CREATE TABLE IF NOT EXISTS episodic_shows (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                       TEXT NOT NULL,
    slug                        TEXT NOT NULL UNIQUE,
    poster_url                  TEXT,
    backdrop_url                TEXT,
    status                      TEXT NOT NULL DEFAULT 'airing',
    synopsis                    TEXT,
    tmdb_id                     TEXT NOT NULL UNIQUE,
    network                     TEXT,
    genre                       TEXT,
    rating                      DECIMAL(3,1),
    first_air_date              DATE,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW(),
    last_synced_at              TIMESTAMPTZ,
    -- Air time columns
    air_time                    VARCHAR(5),
    air_time_source             VARCHAR(20),
    air_timezone                VARCHAR(50) DEFAULT 'America/New_York',
    -- Watch providers
    watch_providers             JSONB,
    watch_providers_updated_at  TIMESTAMPTZ
);

-- Episodes table (per show)
CREATE TABLE IF NOT EXISTS episodic_episodes (
    id              TEXT PRIMARY KEY,
    show_id         UUID NOT NULL REFERENCES episodic_shows(id) ON DELETE CASCADE,
    season          INTEGER NOT NULL,
    episode         INTEGER NOT NULL,
    title           TEXT NOT NULL,
    air_date        DATE,
    runtime         INTEGER,
    summary         TEXT,
    still_url       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(show_id, season, episode)
);

-- User's tracked shows (user_id is the Supabase UUID stored in Clerk externalId)
CREATE TABLE IF NOT EXISTS episodic_user_shows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    show_id         UUID NOT NULL REFERENCES episodic_shows(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'watching',
    rating          SMALLINT CHECK (rating >= 1 AND rating <= 5),
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, show_id)
);

-- User's episode watch status
CREATE TABLE IF NOT EXISTS episodic_user_episodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    episode_id      TEXT NOT NULL REFERENCES episodic_episodes(id) ON DELETE CASCADE,
    show_id         UUID NOT NULL REFERENCES episodic_shows(id) ON DELETE CASCADE,
    watched         BOOLEAN DEFAULT FALSE,
    watched_at      TIMESTAMPTZ,
    rating          SMALLINT CHECK (rating >= 1 AND rating <= 5),
    skipped         BOOLEAN DEFAULT FALSE,
    watch_source    TEXT,
    UNIQUE(user_id, episode_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_episodic_episodes_show_id ON episodic_episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_episodic_episodes_air_date ON episodic_episodes(air_date);
CREATE INDEX IF NOT EXISTS idx_episodic_user_shows_user_id ON episodic_user_shows(user_id);
CREATE INDEX IF NOT EXISTS idx_episodic_user_episodes_user_id ON episodic_user_episodes(user_id);
CREATE INDEX IF NOT EXISTS idx_episodic_user_episodes_show_id ON episodic_user_episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_episodic_user_episodes_skipped ON episodic_user_episodes(user_id, show_id, skipped) WHERE skipped = TRUE;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS episodic_shows_updated_at ON episodic_shows;
CREATE TRIGGER episodic_shows_updated_at BEFORE UPDATE ON episodic_shows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS episodic_user_shows_updated_at ON episodic_user_shows;
CREATE TRIGGER episodic_user_shows_updated_at BEFORE UPDATE ON episodic_user_shows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
