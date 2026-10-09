-- Saved assistant instructions. A run uses the newest revision for that user and agent.
CREATE TABLE agent_revisions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    revision INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, agent_key, revision),
    UNIQUE (user_id, request_id)
);
