export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS drej_events (
  id          BIGSERIAL   PRIMARY KEY,
  sandbox_id  TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  step_idx    INTEGER     NOT NULL,
  branch      INTEGER,
  event       TEXT        NOT NULL,
  payload     JSONB,
  error       TEXT,
  ts          BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS drej_events_sandbox_id ON drej_events(sandbox_id);
CREATE INDEX IF NOT EXISTS drej_events_name ON drej_events(name);

CREATE TABLE IF NOT EXISTS drej_environments (
  name        TEXT    PRIMARY KEY,
  snapshot_id TEXT    NOT NULL,
  image       TEXT    NOT NULL,
  built_at    BIGINT  NOT NULL
);
`;
