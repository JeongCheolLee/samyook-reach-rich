CREATE TABLE members (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  icon text NOT NULL CHECK (length(icon) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_active_name_idx ON members (name) WHERE active;

CREATE TABLE deposits (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  amount bigint NOT NULL CHECK (amount <> 0 AND amount BETWEEN -9007199254740991 AND 9007199254740991),
  kind text NOT NULL DEFAULT 'deposit' CHECK (kind IN ('deposit', 'adjustment', 'opening')),
  deposited_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  memo text
);
CREATE INDEX deposits_member_idx ON deposits(member_id);
CREATE INDEX deposits_date_idx ON deposits(deposited_at DESC, created_at DESC);

CREATE TABLE comments (
  id uuid PRIMARY KEY,
  author text NOT NULL,
  icon text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  legacy_parent_id uuid,
  ip text,
  ua text,
  device text,
  geo text,
  isp text,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX comments_created_idx ON comments(created_at DESC);
CREATE INDEX comments_parent_idx ON comments(parent_id);

CREATE TABLE view_totals (
  id smallint PRIMARY KEY CHECK (id = 1),
  total bigint NOT NULL CHECK (total BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE daily_views (
  day date PRIMARY KEY,
  count bigint NOT NULL CHECK (count BETWEEN 0 AND 9007199254740991),
  expires_at timestamptz
);
