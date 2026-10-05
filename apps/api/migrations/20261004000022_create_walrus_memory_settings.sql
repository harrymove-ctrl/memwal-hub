CREATE TABLE walrus_memory_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    account_id TEXT NOT NULL,
    server_url TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key_ciphertext BYTEA NOT NULL,
    key_nonce BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
