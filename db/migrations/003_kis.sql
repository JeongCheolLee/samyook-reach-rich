CREATE TABLE kis_tokens (
  id smallint PRIMARY KEY CHECK (id = 1),
  token text,
  expires_at timestamptz,
  last_attempt_at timestamptz,
  CHECK ((token IS NULL) = (expires_at IS NULL))
);

CREATE TABLE redis_import_runs (
  id smallint PRIMARY KEY CHECK (id = 1),
  fingerprint text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL
);
