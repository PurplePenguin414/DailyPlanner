const express = require('express');
const router = express.Router();
const { db, STATUSES, OPEN_STATUSES, FOLLOW_UP_STATUSES, todayStr, isDate, validate, validateCall } = require('../lib/jobs-core');

// ---- Recent jobs widget (key-protected, no session; same key as the
// Today widget). Defined BEFORE the session guard below. ----
router.get('/widget/recent', (req, res) => {
  const key = process.env.WIDGET_API_KEY || '';
  if (!key) return res.status(503).json({ error: 'WIDGET_API_KEY not configured on this server' });
  if ((req.query.key || req.headers['x-api-key']) !== key) return res.status(401).json({ error: 'Invalid or missing API key' });
  const marks = OPEN_STATUSES.map(() => '?').join(',');
  const jobs = db.prepare(
    `SELECT company, role, status, applied_date, next_follow_up FROM jobs
       WHERE status IN (${marks}) ORDER BY updated_at DESC, id DESC LIMIT 6`
  ).all(...OPEN_STATUSES);
  const counts = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN (${marks})`).get(...OPEN_STATUSES).c;
  const today = todayStr();
  const due = db.prepare(
    `SELECT COUNT(*) AS c FROM jobs WHERE next_follow_up IS NOT NULL AND next_follow_up <= ?
       AND status IN (${FOLLOW_UP_STATUSES.map(() => '?').join(',')})`
  ).get(today, ...FOLLOW_UP_STATUSES).c;
  res.json({ date: today, open: counts, followups_due: due, jobs });
});

// Own 401 guard (a mount-level requireAuth would 302-redirect API calls
// because req.path is relative inside a mounted router).
router.use((req, res, next) => {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not logged in' });
});

router.use(express.json());

router.get('/', (req, res) => {
  res.json({ today: todayStr(), jobs: db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC, id DESC').all() });
});

function stampApplied(v, existing) {
  const status = v.status !== undefined ? v.status : existing && existing.status;
  const applied = v.applied_date !== undefined ? v.applied_date : existing && existing.applied_date;
  if (status && status !== 'saved' && !applied) v.applied_date = todayStr();
}

router.post('/', (req, res) => {
  const r = validate(req.body, { partial: false });
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.value;
  if (v.status === undefined) v.status = 'applied';
  stampApplied(v, null);
  const cols = Object.keys(v);
  const info = db.prepare(`INSERT INTO jobs (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => v[c]));
  res.status(201).json(db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const r = validate(req.body, { partial: true });
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.value;
  stampApplied(v, existing);
  // Changing the follow-up date makes it eligible for a fresh ping.
  if (v.next_follow_up !== undefined && v.next_follow_up !== existing.next_follow_up) v.ping_sent_for = null;
  const cols = Object.keys(v);
  if (cols.length) {
    db.prepare(`UPDATE jobs SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...cols.map(c => v[c]), req.params.id);
  }
  res.json(db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Job items for Daily Planner's own Day / Month screens (read-only).
router.get('/calendar', (req, res) => {
  const { start, end } = req.query;
  if (!isDate(start) || !isDate(end)) return res.status(400).json({ error: 'start and end must be dates (YYYY-MM-DD)' });
  const COLOR = '#8e5bb5';
  const lab = j => (j.role ? `${j.company} (${j.role})` : j.company);
  const items = [];
  const marks = FOLLOW_UP_STATUSES.map(() => '?').join(',');
  db.prepare(`SELECT * FROM jobs WHERE next_follow_up >= ? AND next_follow_up <= ? AND status IN (${marks})`)
    .all(start, end, ...FOLLOW_UP_STATUSES).forEach(j => items.push({
      id: 'job-f-' + j.id, entry_date: j.next_follow_up, title: 'Follow up: ' + lab(j), start_time: j.next_follow_up_time || null, end_time: null, color: COLOR, job_item: true }));
  db.prepare("SELECT * FROM jobs WHERE apply_by >= ? AND apply_by <= ? AND status = 'saved'")
    .all(start, end).forEach(j => items.push({
      id: 'job-a-' + j.id, entry_date: j.apply_by, title: 'Apply by: ' + lab(j), start_time: null, end_time: null, color: COLOR, job_item: true }));
  db.prepare('SELECT * FROM job_calls WHERE next_step_date >= ? AND next_step_date <= ? AND next_step_done = 0')
    .all(start, end).forEach(c => items.push({
      id: 'job-n-' + c.id, entry_date: c.next_step_date, title: `Next step: ${c.contact_name}${c.next_step ? ' — ' + c.next_step : ''}`,
      start_time: c.next_step_time || null, end_time: null, color: COLOR, job_item: true }));
  db.prepare('SELECT * FROM job_calls WHERE call_date >= ? AND call_date <= ?')
    .all(start, end).forEach(c => items.push({
      id: 'job-c-' + c.id, entry_date: c.call_date, title: `Call: ${c.contact_name}${c.company ? ' (' + c.company + ')' : ''}`,
      start_time: c.call_time || null, end_time: null, color: COLOR, job_item: true }));
  res.json(items);
});

// ---- Calls log (lives inside the Jobs tab; optionally tied to a job) ----
router.get('/calls/list', (req, res) => {
  res.json({ today: todayStr(), calls: db.prepare('SELECT * FROM job_calls ORDER BY call_date DESC, id DESC').all() });
});
router.post('/calls/list', (req, res) => {
  const r = validateCall(req.body, { partial: false });
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.value;
  if (!v.call_date) v.call_date = todayStr();
  if (v.job_id && !db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(v.job_id)) return res.status(400).json({ error: 'Unknown job' });
  const cols = Object.keys(v);
  const info = db.prepare(`INSERT INTO job_calls (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => v[c]));
  res.status(201).json(db.prepare('SELECT * FROM job_calls WHERE id = ?').get(info.lastInsertRowid));
});
router.put('/calls/list/:id', (req, res) => {
  const ex = db.prepare('SELECT * FROM job_calls WHERE id = ?').get(req.params.id);
  if (!ex) return res.status(404).json({ error: 'Not found' });
  const r = validateCall(req.body, { partial: true });
  if (r.error) return res.status(400).json({ error: r.error });
  const v = r.value;
  if (v.job_id && !db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(v.job_id)) return res.status(400).json({ error: 'Unknown job' });
  if (v.next_step_date !== undefined && v.next_step_date !== ex.next_step_date) v.ping_sent_for = null;
  const cols = Object.keys(v);
  if (cols.length) db.prepare(`UPDATE job_calls SET ${cols.map(c => c + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...cols.map(c => v[c]), req.params.id);
  res.json(db.prepare('SELECT * FROM job_calls WHERE id = ?').get(req.params.id));
});
router.delete('/calls/list/:id', (req, res) => {
  const info = db.prepare('DELETE FROM job_calls WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Items for /api/widget/today: follow-ups due today or overdue, apply-by today.
router.todayItems = function (today) {
  const marks = FOLLOW_UP_STATUSES.map(() => '?').join(',');
  const follow = db.prepare(
    `SELECT company, role, next_follow_up, next_follow_up_time FROM jobs WHERE next_follow_up IS NOT NULL AND next_follow_up <= ? AND status IN (${marks})`
  ).all(today, ...FOLLOW_UP_STATUSES).map(j => ({
    title: `Follow up: ${j.role ? j.company + ' (' + j.role + ')' : j.company}`, start_time: j.next_follow_up === today ? (j.next_follow_up_time || null) : null, end_time: null, color: null
  }));
  const apply = db.prepare(
    `SELECT company, role FROM jobs WHERE apply_by = ? AND status = 'saved'`
  ).all(today).map(j => ({
    title: `Apply by today: ${j.role ? j.company + ' (' + j.role + ')' : j.company}`, start_time: null, end_time: null, color: null
  }));
  const steps = db.prepare(
    `SELECT contact_name, next_step, next_step_date, next_step_time FROM job_calls WHERE next_step_date IS NOT NULL AND next_step_date <= ? AND next_step_done = 0`
  ).all(today).map(c => ({
    title: `Call next step: ${c.contact_name}${c.next_step ? ' — ' + c.next_step : ''}`, start_time: c.next_step_date === today ? (c.next_step_time || null) : null, end_time: null, color: null
  }));
  const todays = db.prepare('SELECT contact_name, company, call_time FROM job_calls WHERE call_date = ?').all(today).map(c => ({
    title: `Call: ${c.contact_name}${c.company ? ' (' + c.company + ')' : ''}`, start_time: c.call_time || null, end_time: null, color: null
  }));
  return [...follow, ...apply, ...steps, ...todays];
};

module.exports = router;
