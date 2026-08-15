const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'data', 'planner.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Weekly recurring template: set manually each week. day_of_week is 0=Sunday..6=Saturday.
-- week_start is the Monday (or whichever convention) date this template applies to,
-- so each week's blocks are independently editable rather than one permanent template.
CREATE TABLE IF NOT EXISTS weekly_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,       -- ISO date of the Monday for that week
  day_of_week INTEGER NOT NULL,   -- 0-6
  start_time TEXT NOT NULL,       -- HH:MM
  end_time TEXT NOT NULL,         -- HH:MM
  label TEXT NOT NULL,
  color TEXT DEFAULT '#4a6fa5',
  created_at TEXT DEFAULT (datetime('now'))
);

-- One-off items for a specific date: calls, errands, appointments, extra drive time, etc.
CREATE TABLE IF NOT EXISTS day_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,       -- ISO date
  start_time TEXT,                -- HH:MM, nullable for untimed items
  end_time TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  color TEXT DEFAULT '#2e7d32',
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','google')),
  google_event_id TEXT,           -- set when source='google', used to dedupe on re-sync
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_blocks_week ON weekly_blocks(week_start);
CREATE INDEX IF NOT EXISTS idx_day_entries_date ON day_entries(entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_day_entries_google_event ON day_entries(google_event_id) WHERE google_event_id IS NOT NULL;

-- Google Calendar OAuth tokens (single-user app, so just one row ever exists)
CREATE TABLE IF NOT EXISTS google_calendar_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TEXT,
  calendar_id TEXT DEFAULT 'primary',
  connected_at TEXT,
  last_synced_at TEXT
);
`);

function ensureDefaultUser() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c === 0) {
    const username = process.env.DEFAULT_USERNAME || 'megan';
    const password = process.env.DEFAULT_PASSWORD || 'changeme';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`Created default user "${username}" — CHANGE THIS PASSWORD after first login.`);
  }
}
ensureDefaultUser();

module.exports = db;
