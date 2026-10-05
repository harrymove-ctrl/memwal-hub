CREATE TABLE storage_connections (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('walrus_memory')),
    account_id TEXT NOT NULL,
    server_url TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key_ciphertext BYTEA NOT NULL,
    key_nonce BYTEA NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('key_stored', 'verified', 'requires_reconnect')),
    last_verified_at TIMESTAMPTZ,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider)
);
