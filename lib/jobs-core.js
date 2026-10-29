// Job Search tab — table, validation, and date helpers.
// The table is created with CREATE TABLE IF NOT EXISTS, so it is purely
// additive: existing data in the Daily Planner database is never touched.
const db = require('../db');

const TZ = process.env.JOBS_TIMEZONE || 'America/Detroit';

const STATUSES = ['saved', 'applied', 'interviewing', 'waiting', 'offer', 'rejected', 'withdrawn'];
const OPEN_STATUSES = ['saved', 'applied', 'interviewing', 'waiting', 'offer'];
const FOLLOW_UP_STATUSES = ['applied', 'interviewing', 'waiting', 'offer'];

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'applied',
    url TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    applied_date TEXT,
    apply_by TEXT,
    next_follow_up TEXT,
    last_followed_up TEXT,
    follow_up_ping INTEGER NOT NULL DEFAULT 0,
    ping_sent_for TEXT,
    pay_range TEXT NOT NULL DEFAULT '',
    company_notes TEXT NOT NULL DEFAULT '',
    outcome_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_follow_up ON jobs(next_follow_up);
  CREATE TABLE IF NOT EXISTS job_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    call_date TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    next_step_date TEXT,
    next_step_done INTEGER NOT NULL DEFAULT 0,
    next_step_ping INTEGER NOT NULL DEFAULT 0,
    ping_sent_for TEXT,
    job_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Additive migration: optional time of day for a call (so it can be a timed calendar event).
if (!db.prepare("PRAGMA table_info(job_calls)").all().some(c => c.name === 'call_time')) {
  db.exec("ALTER TABLE job_calls ADD COLUMN call_time TEXT");
}

// "Today" in the configured timezone, as YYYY-MM-DD (never UTC / toISOString).
function todayStr(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Date-only math in UTC so DST can never shift a day.
function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TEXT_LIMITS = { company: 200, role: 200, source: 100, pay_range: 100, url: 2000,
  company_notes: 5000, outcome_notes: 5000, notes: 5000 };

// Returns { error } or { value } where value only holds fields that were sent
// (so PUT can be a partial update).
function validate(body, { partial }) {
  const out = {};
  const b = body || {};
  for (const k of Object.keys(TEXT_LIMITS)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string') return { error: `${k} must be text` };
    const v = b[k].trim();
    if (v.length > TEXT_LIMITS[k]) return { error: `${k} is too long` };
    out[k] = v;
  }
  if (!partial && !out.company) return { error: 'Company is required' };
  if (out.company === '' ) return { error: 'Company is required' };
  if (out.url) {
    let u;
    try { u = new URL(out.url); } catch (e) { return { error: 'Link must be a full web address' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Link must start with http or https' };
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return { error: 'Unknown status' };
    out.status = b.status;
  }
  for (const k of ['applied_date', 'apply_by', 'next_follow_up', 'last_followed_up']) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === '') { out[k] = null; continue; }
    if (!isDate(b[k])) return { error: `${k} must be a date (YYYY-MM-DD)` };
    out[k] = b[k];
  }
  if (b.follow_up_ping !== undefined) out.follow_up_ping = b.follow_up_ping ? 1 : 0;
  return { value: out };
}

const CALL_LIMITS = { contact_name: 200, company: 200, phone: 50, email: 200, summary: 5000, next_step: 500 };
function validateCall(body, { partial }) {
  const b = body || {}, out = {};
  for (const k of Object.keys(CALL_LIMITS)) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== 'string') return { error: `${k} must be text` };
    const v = b[k].trim();
    if (v.length > CALL_LIMITS[k]) return { error: `${k} is too long` };
    out[k] = v;
  }
  if ((!partial && !out.contact_name) || out.contact_name === '') return { error: 'Contact name is required' };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { error: 'That email address does not look right' };
  if (b.call_time !== undefined) {
    if (b.call_time === null || b.call_time === '') out.call_time = null;
    else if (typeof b.call_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.call_time)) out.call_time = b.call_time;
    else return { error: 'call_time must be a time (HH:MM)' };
  }
  for (const k of ['call_date', 'next_step_date']) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === '') { if (k === 'call_date') continue; out[k] = null; continue; }
    if (!isDate(b[k])) return { error: `${k} must be a date (YYYY-MM-DD)` };
    out[k] = b[k];
  }
  if (b.job_id !== undefined) {
    if (b.job_id === null || b.job_id === '') out.job_id = null;
    else { const n = Number(b.job_id); if (!Number.isInteger(n) || n < 1) return { error: 'Unknown job' }; out.job_id = n; }
  }
  for (const k of ['next_step_ping', 'next_step_done']) if (b[k] !== undefined) out[k] = b[k] ? 1 : 0;
  return { value: out };
}

module.exports = { validateCall, db, TZ, STATUSES, OPEN_STATUSES, FOLLOW_UP_STATUSES,
  todayStr, isDate, addDays, validate };
