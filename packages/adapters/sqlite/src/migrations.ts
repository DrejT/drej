export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS drej_events (
  id       INTEGER  PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT     NOT NULL,
  wf_name  TEXT     NOT NULL,
  step_idx INTEGER  NOT NULL,
  branch   INTEGER,
  event    TEXT     NOT NULL,
  payload  TEXT,
  error    TEXT,
  ts       INTEGER  NOT NULL
);

CREATE INDEX IF NOT EXISTS drej_events_run_id ON drej_events(run_id);
CREATE INDEX IF NOT EXISTS drej_events_wf_name ON drej_events(wf_name);
`;
