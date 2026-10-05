CREATE TABLE agent_device_authorizations (
    id UUID PRIMARY KEY,
    device_code_hash BYTEA NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE CHECK (char_length(user_code) = 9),
    agent_label TEXT NOT NULL CHECK (char_length(agent_label) BETWEEN 1 AND 64),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    gateway_key_id UUID REFERENCES gateway_keys(id) ON DELETE SET NULL,
    -- Plaintext key held only between approval and the agent's next poll,
    -- then nulled on consumption.
    issued_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX agent_device_authorizations_user_code_pending_idx
    ON agent_device_authorizations (user_code)
    WHERE status = 'pending';
