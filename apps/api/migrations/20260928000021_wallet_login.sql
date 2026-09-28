ALTER TABLE users ADD COLUMN sui_address TEXT;

CREATE UNIQUE INDEX users_sui_address_key ON users (sui_address)
    WHERE sui_address IS NOT NULL;

CREATE TABLE auth_nonces (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_nonces_expires_at_index ON auth_nonces (expires_at);
