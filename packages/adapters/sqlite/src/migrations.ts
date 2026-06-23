export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS drej_events (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  sandbox_id  TEXT     NOT NULL,
  name        TEXT     NOT NULL,
  step_idx    INTEGER  NOT NULL,
  branch      INTEGER,
  event       TEXT     NOT NULL,
  payload     TEXT,
  error       TEXT,
  ts          INTEGER  NOT NULL
);

CREATE INDEX IF NOT EXISTS drej_events_sandbox_id ON drej_events(sandbox_id);
CREATE INDEX IF NOT EXISTS drej_events_name ON drej_events(name);
`;
