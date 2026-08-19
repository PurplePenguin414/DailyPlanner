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
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','google','medtracker')),
  external_id TEXT,               -- set when source != 'manual', used to dedupe on re-sync
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_blocks_week ON weekly_blocks(week_start);
CREATE INDEX IF NOT EXISTS idx_day_entries_date ON day_entries(entry_date);
-- NOTE: the unique index on external_id is intentionally NOT created here.
-- If day_entries already existed from before this column was added (old
-- schema used "google_event_id" instead), creating that index right now
-- would fail since the live table doesn't have the column yet. It's created
-- further down, after migrateDayEntriesIfNeeded() has guaranteed the column
-- exists one way or another.

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

-- Recurring events (birthdays, monthly meetings, etc.) — distinct from
-- weekly_blocks above, which are set manually per-week. These repeat
-- indefinitely on a pattern and get materialized forward automatically.
CREATE TABLE IF NOT EXISTS recurring_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  color TEXT DEFAULT '#8e44ad',
  recurrence_type TEXT NOT NULL CHECK(recurrence_type IN ('daily','weekly','monthly','yearly')),
  interval_count INTEGER NOT NULL DEFAULT 1,
  anchor_date TEXT NOT NULL,      -- the first occurrence; month/day or weekday derived from this
  start_time TEXT,                -- HH:MM, nullable for untimed (e.g. birthdays)
  end_time TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Simple key/value settings store — currently used for per-appointment-type
-- color preferences, applied whenever Med & Appointment Tracker syncs in.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Tracks dates a recurring series should NOT generate an instance for —
-- populated when a single occurrence is detached or deleted individually,
-- so editing the series later doesn't regenerate a duplicate right next to it.
CREATE TABLE IF NOT EXISTS recurring_exceptions (
  series_id INTEGER NOT NULL,
  exception_date TEXT NOT NULL,
  PRIMARY KEY (series_id, exception_date),
  FOREIGN KEY (series_id) REFERENCES recurring_series(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// ---- Migration: original schema used source CHECK('manual','google') and a
// column named google_event_id. If an existing database predates this, rebuild
// day_entries with the new CHECK/column while preserving all existing rows. ----
function migrateDayEntriesIfNeeded() {
  const version = db.prepare("SELECT value FROM schema_meta WHERE key = 'day_entries_version'").get();
  if (version && version.value === '3') return; // already migrated

  const cols = db.prepare("PRAGMA table_info(day_entries)").all().map(c => c.name);
  const hasOldColumn = cols.includes('google_event_id');

  // Check whether the CHECK constraint already allows 'recurring' — if this
  // is a fresh v2 install (external_id already present) but predates the
  // 'recurring' source type, it still needs rebuilding even though
  // hasOldColumn is false.
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='day_entries'").get();
  const needsRecurringSource = tableSql && !tableSql.sql.includes("'recurring'");

  if (hasOldColumn || needsRecurringSource) {
    db.exec(`
      CREATE TABLE day_entries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        title TEXT NOT NULL,
        notes TEXT,
        color TEXT DEFAULT '#2e7d32',
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','google','medtracker','recurring')),
        external_id TEXT,
        recurring_series_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    if (hasOldColumn) {
      db.exec(`
        INSERT INTO day_entries_new (id, entry_date, start_time, end_time, title, notes, color, source, external_id, created_at, updated_at)
          SELECT id, entry_date, start_time, end_time, title, notes, color, source, google_event_id, created_at, updated_at FROM day_entries;
      `);
    } else {
      db.exec(`
        INSERT INTO day_entries_new (id, entry_date, start_time, end_time, title, notes, color, source, external_id, created_at, updated_at)
          SELECT id, entry_date, start_time, end_time, title, notes, color, source, external_id, created_at, updated_at FROM day_entries;
      `);
    }

    db.exec(`
      DROP TABLE day_entries;
      ALTER TABLE day_entries_new RENAME TO day_entries;
      CREATE INDEX IF NOT EXISTS idx_day_entries_date ON day_entries(entry_date);
    `);
    console.log('Migrated day_entries table: added recurring source + recurring_series_id column.');
  }

  db.prepare(`
    INSERT INTO schema_meta (key, value) VALUES ('day_entries_version', '3')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();
}
migrateDayEntriesIfNeeded();

// Safe, additive migration: 'until_date' may not exist on recurring_series
// if it was created before this feature. ADD COLUMN is safe in SQLite for a
// plain nullable column — no full table rebuild needed here, unlike the
// day_entries CHECK-constraint cases above.
function migrateRecurringSeriesIfNeeded() {
  const cols = db.prepare("PRAGMA table_info(recurring_series)").all().map(c => c.name);
  if (!cols.includes('until_date')) {
    db.exec('ALTER TABLE recurring_series ADD COLUMN until_date TEXT');
    console.log('Migrated recurring_series table: added until_date column.');
  }
  if (!cols.includes('monthly_mode')) {
    db.exec(`
      ALTER TABLE recurring_series ADD COLUMN monthly_mode TEXT DEFAULT 'day_of_month';
      ALTER TABLE recurring_series ADD COLUMN nth_week INTEGER;
      ALTER TABLE recurring_series ADD COLUMN nth_weekday_dow INTEGER;
    `);
    console.log('Migrated recurring_series table: added monthly_mode / nth_week / nth_weekday_dow columns.');
  }
  if (!cols.includes('yearly_mode')) {
    db.exec(`
      ALTER TABLE recurring_series ADD COLUMN yearly_mode TEXT DEFAULT 'month_day';
      ALTER TABLE recurring_series ADD COLUMN yearly_month INTEGER;
    `);
    console.log('Migrated recurring_series table: added yearly_mode / yearly_month columns.');
  }

  // The CHECK constraint on recurrence_type can't be ALTERed in SQLite —
  // needs a full rebuild, same as the day_entries cases. Preserves explicit
  // ids since day_entries.recurring_series_id references them.
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='recurring_series'").get();
  if (tableSql && !tableSql.sql.includes("'daily'")) {
    db.exec(`
      CREATE TABLE recurring_series_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT,
        color TEXT DEFAULT '#8e44ad',
        recurrence_type TEXT NOT NULL CHECK(recurrence_type IN ('daily','weekly','monthly','yearly')),
        interval_count INTEGER NOT NULL DEFAULT 1,
        anchor_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        until_date TEXT,
        monthly_mode TEXT DEFAULT 'day_of_month',
        nth_week INTEGER,
        nth_weekday_dow INTEGER,
        yearly_mode TEXT DEFAULT 'month_day',
        yearly_month INTEGER
      );
      INSERT INTO recurring_series_new SELECT id, title, notes, color, recurrence_type, interval_count, anchor_date, start_time, end_time, active, created_at, until_date, monthly_mode, nth_week, nth_weekday_dow, yearly_mode, yearly_month FROM recurring_series;
      DROP TABLE recurring_series;
      ALTER TABLE recurring_series_new RENAME TO recurring_series;
    `);
    console.log('Migrated recurring_series table: added daily to recurrence_type options.');
  }
}
migrateRecurringSeriesIfNeeded();

// Safe now regardless of which path migration took above — the external_id
// column is guaranteed to exist at this point.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_day_entries_external ON day_entries(external_id) WHERE external_id IS NOT NULL;');

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
