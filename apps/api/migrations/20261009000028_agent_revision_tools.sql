-- Capabilities saved with each agent revision. Existing revisions predate this
-- column and keep both memory tools, which is what they could do before.
ALTER TABLE agent_revisions
    ADD COLUMN tools TEXT[] NOT NULL DEFAULT ARRAY['memwal_recall', 'memwal_remember']::TEXT[];
