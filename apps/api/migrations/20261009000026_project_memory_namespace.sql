-- Immutable Walrus namespace for a project. The browser cannot choose or
-- rename it. Existing rows, if any, get a scope derived from their id.
ALTER TABLE projects ADD COLUMN memory_namespace TEXT;
UPDATE projects SET memory_namespace = 'project/' || id::text WHERE memory_namespace IS NULL;
ALTER TABLE projects ALTER COLUMN memory_namespace SET NOT NULL;
CREATE UNIQUE INDEX projects_owner_namespace ON projects (user_id, memory_namespace);
