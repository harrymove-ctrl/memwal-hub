-- One OpenAI-compatible model proxy per signed-in user. The API key is
-- AES-256-GCM encrypted with PROVIDER_CREDENTIAL_ENCRYPTION_KEY and never
-- returned by any route.
CREATE TABLE model_proxy_connections (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    connection_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model_id TEXT NOT NULL,
    key_ciphertext BYTEA NOT NULL,
    key_nonce BYTEA NOT NULL,
    max_output_tokens INTEGER NOT NULL DEFAULT 800,
    temperature REAL,
    status TEXT NOT NULL CHECK (status IN ('untested', 'ready', 'needs_attention', 'unavailable')),
    last_error_code TEXT,
    last_error TEXT,
    last_tested_at TIMESTAMPTZ,
    last_model_reported TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Walrus Memory write jobs. Fact text is not stored here; only a hash, so a
-- retry can be matched to its original idempotency key without keeping a copy.
CREATE TABLE memory_write_jobs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    text_sha256 TEXT NOT NULL,
    namespace TEXT NOT NULL,
    job_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('submitting', 'pending', 'running', 'uploaded', 'done', 'failed', 'uncertain')),
    blob_id TEXT,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, idempotency_key)
);

ALTER TABLE storage_connections
    ADD COLUMN last_error_code TEXT,
    ADD COLUMN network TEXT NOT NULL DEFAULT 'mainnet',
    ADD COLUMN owner_address TEXT;
