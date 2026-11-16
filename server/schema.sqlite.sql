-- Catalog schema (SQLite flavour). Documents are JSON text; the parts the harvester and the
-- admin actions change (columns, sample rows, positions, soft delete) are real columns and rows.

CREATE TABLE IF NOT EXISTS repository (
  id      INTEGER PRIMARY KEY,
  pos     INTEGER NOT NULL,
  doc     TEXT    NOT NULL,           -- full repository detail (list item + card, requirements, ...)
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS layer (
  id       INTEGER PRIMARY KEY,
  repo_id  INTEGER NOT NULL REFERENCES repository(id),
  pos      INTEGER NOT NULL,
  sql_name TEXT    NOT NULL UNIQUE,
  doc      TEXT    NOT NULL,          -- list item, as served in layers.json
  detail   TEXT    NOT NULL,          -- detail file without columns and sample rows
  deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS layer_column (
  layer_id INTEGER NOT NULL REFERENCES layer(id),
  ordinal  INTEGER NOT NULL,
  doc      TEXT    NOT NULL,          -- {pk, pii, name, type, descHe, descEn, nullable, masked}
  PRIMARY KEY (layer_id, ordinal)
);

CREATE TABLE IF NOT EXISTS sample_row (
  layer_id INTEGER NOT NULL REFERENCES layer(id),
  row_no   INTEGER NOT NULL,
  doc      TEXT    NOT NULL,
  PRIMARY KEY (layer_id, row_no)
);

-- Files served as they are: lineage, quality profiles, samples, unlocked variants, me, personas, meta.
CREATE TABLE IF NOT EXISTS payload (
  name TEXT PRIMARY KEY,              -- path under data/, e.g. consumer/repositories__1__lineage__d1.json
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  entity  TEXT NOT NULL,
  payload TEXT
);

-- Shared admin state: registered datasets, access overrides, edits and deletions (one JSON document each).
CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Descriptive metadata for source tables that the structure cannot tell us (titles, owners, quality).
CREATE TABLE IF NOT EXISTS source_meta (
  sql_name TEXT PRIMARY KEY,
  doc      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS harvest_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL,
  summary     TEXT
);

-- Mock accounts for the pilot. Passwords are stored as scrypt hashes, never in clear text.
CREATE TABLE IF NOT EXISTS app_user (
  user_id       TEXT PRIMARY KEY,
  role          TEXT NOT NULL,       -- admin or consumer
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
