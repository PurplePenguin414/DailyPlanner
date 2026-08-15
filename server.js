require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  return res.redirect('/login.html');
}

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.userId) return res.json({ authenticated: true, username: req.session.username });
  res.json({ authenticated: false });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ success: true });
});

app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---- Weekly blocks ----
app.get('/api/weekly-blocks', requireAuth, (req, res) => {
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start is required' });
  res.json(db.prepare('SELECT * FROM weekly_blocks WHERE week_start = ? ORDER BY day_of_week, start_time').all(week_start));
});

app.post('/api/weekly-blocks', requireAuth, (req, res) => {
  const { week_start, day_of_week, start_time, end_time, label, color } = req.body;
  if (!week_start || day_of_week === undefined || !start_time || !end_time || !label) {
    return res.status(400).json({ error: 'week_start, day_of_week, start_time, end_time, and label are required' });
  }
  const result = db.prepare(`
    INSERT INTO weekly_blocks (week_start, day_of_week, start_time, end_time, label, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(week_start, day_of_week, start_time, end_time, label, color || '#4a6fa5');
  res.status(201).json(db.prepare('SELECT * FROM weekly_blocks WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/weekly-blocks/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM weekly_blocks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { start_time, end_time, label, color } = req.body;
  db.prepare('UPDATE weekly_blocks SET start_time=?, end_time=?, label=?, color=? WHERE id=?')
    .run(start_time ?? existing.start_time, end_time ?? existing.end_time, label ?? existing.label, color ?? existing.color, req.params.id);
  res.json(db.prepare('SELECT * FROM weekly_blocks WHERE id = ?').get(req.params.id));
});

app.delete('/api/weekly-blocks/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM weekly_blocks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Copy last week's blocks forward to a new week (common convenience)
app.post('/api/weekly-blocks/copy-from', requireAuth, (req, res) => {
  const { from_week, to_week } = req.body;
  if (!from_week || !to_week) return res.status(400).json({ error: 'from_week and to_week are required' });
  const source = db.prepare('SELECT * FROM weekly_blocks WHERE week_start = ?').all(from_week);
  const insert = db.prepare('INSERT INTO weekly_blocks (week_start, day_of_week, start_time, end_time, label, color) VALUES (?, ?, ?, ?, ?, ?)');
  source.forEach(b => insert.run(to_week, b.day_of_week, b.start_time, b.end_time, b.label, b.color));
  res.json({ success: true, copied: source.length });
});

// ---- Day entries ----
app.get('/api/day-entries', requireAuth, (req, res) => {
  const { date, start, end } = req.query;
  if (date) {
    return res.json(db.prepare('SELECT * FROM day_entries WHERE entry_date = ? ORDER BY start_time IS NULL, start_time').all(date));
  }
  if (start && end) {
    return res.json(db.prepare('SELECT * FROM day_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY entry_date, start_time IS NULL, start_time').all(start, end));
  }
  res.status(400).json({ error: 'Provide either date, or start and end' });
});

app.post('/api/day-entries', requireAuth, (req, res) => {
  const { entry_date, start_time, end_time, title, notes, color } = req.body;
  if (!entry_date || !title) return res.status(400).json({ error: 'entry_date and title are required' });
  const result = db.prepare(`
    INSERT INTO day_entries (entry_date, start_time, end_time, title, notes, color, source)
    VALUES (?, ?, ?, ?, ?, ?, 'manual')
  `).run(entry_date, start_time || null, end_time || null, title, notes || null, color || '#2e7d32');
  res.status(201).json(db.prepare('SELECT * FROM day_entries WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/day-entries/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM day_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.source !== 'manual') return res.status(400).json({ error: `Entries synced from ${existing.source} are read-only here — edit them at the source instead` });
  const { start_time, end_time, title, notes, color } = req.body;
  db.prepare(`
    UPDATE day_entries SET start_time=?, end_time=?, title=?, notes=?, color=?, updated_at=datetime('now') WHERE id=?
  `).run(start_time ?? existing.start_time, end_time ?? existing.end_time, title ?? existing.title, notes ?? existing.notes, color ?? existing.color, req.params.id);
  res.json(db.prepare('SELECT * FROM day_entries WHERE id = ?').get(req.params.id));
});

app.delete('/api/day-entries/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM day_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.source !== 'manual') return res.status(400).json({ error: `Entries synced from ${existing.source} are read-only here — delete them at the source instead` });
  db.prepare('DELETE FROM day_entries WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ---- Google Calendar OAuth + sync ----
app.use('/api/google', requireAuth, require('./routes/google-calendar'));

// ---- Med & Appointment Tracker sync ----
app.use('/api/medtracker', requireAuth, require('./routes/medtracker'));

// ---- iCal feed (NOT behind requireAuth — calendar apps poll this directly
// with no login flow; it's protected by its own dedicated key instead) ----
app.use('/api/ical', require('./routes/ical'));

// Authenticated endpoint so only a logged-in user can retrieve their own feed
// URL to copy into Apple Calendar — kept separate from the public feed route above.
app.get('/api/ical-url', requireAuth, (req, res) => {
  if (!process.env.ICAL_FEED_KEY) return res.json({ configured: false });
  res.json({ configured: true, url: `${APP_URL}/api/ical/feed.ics?key=${process.env.ICAL_FEED_KEY}` });
});

app.listen(PORT, () => {
  console.log(`Daily Planner running on port ${PORT}`);
});
