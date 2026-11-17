CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pw_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS generations_user_month ON generations (user_id, created_at);

CREATE TABLE IF NOT EXISTS leg_generation_pairs (
  user_id INTEGER NOT NULL,
  leg_id TEXT NOT NULL,
  lock_id TEXT NOT NULL,
  frame_lat REAL NOT NULL,
  frame_lng REAL NOT NULL,
  paper_size TEXT NOT NULL,
  layer TEXT NOT NULL,
  source TEXT NOT NULL,
  imagery TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, leg_id, lock_id, frame_lat, frame_lng, paper_size, layer, source, imagery),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS leg_generation_pairs_user_month ON leg_generation_pairs (user_id, created_at);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wayfinder (
  user_id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL,
  markings TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
