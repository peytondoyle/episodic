CREATE TABLE IF NOT EXISTS user_id_mapping (
    clerk_user_id TEXT PRIMARY KEY,
    db_user_id UUID NOT NULL UNIQUE,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mapping_db_id ON user_id_mapping(db_user_id);
