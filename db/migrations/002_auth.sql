CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

CREATE TABLE auth_rate_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  window_start timestamptz NOT NULL
);
