const express = require('express');
const router = express.Router();
const db = require('../db');

// Key-protected, no session — for Dashboard (or any other trusted app on the
// same server) to read and manage tasks directly, same pattern as Med &
// Appointment Tracker's /api/external/appointments. Checked on every route,
// not mounted behind requireAuth.
function checkKey(req, res, next) {
  const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || '';
  if (!DASHBOARD_API_KEY) return res.status(503).json({ error: 'DASHBOARD_API_KEY not configured on this server' });
  const providedKey = req.query.key || req.headers['x-api-key'];
  if (providedKey !== DASHBOARD_API_KEY) return res.status(401).json({ error: 'Invalid or missing API key' });
  next();
}

router.use(checkKey);

router.get('/', (req, res) => {
  const open = db.prepare("SELECT * FROM tasks WHERE done = 0 ORDER BY created_at ASC").all();
  const done = db.prepare("SELECT * FROM tasks WHERE done = 1 ORDER BY updated_at DESC").all();
  res.json({ open, done });
});

router.post('/', (req, res) => {
  const { title, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const result = db.prepare('INSERT INTO tasks (title, notes) VALUES (?, ?)')
    .run(title.trim(), notes || null);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, notes } = req.body;
  db.prepare(`UPDATE tasks SET title=?, notes=?, updated_at=datetime('now') WHERE id=?`)
    .run(title ?? existing.title, notes ?? existing.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

router.put('/:id/done', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const done = req.body.done ? 1 : 0;
  db.prepare(`UPDATE tasks SET done=?, updated_at=datetime('now') WHERE id=?`).run(done, req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

module.exports = router;
