const express = require('express');
const router = express.Router();
const db = require('../db');

// How far forward to materialize instances. Generous but cheap — even 3
// years of weekly occurrences is only ~150 rows.
const WINDOW_YEARS = 3;

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Computes the date of the nth occurrence of a weekday within a given
// month (nth: 1-5, or -1 for "last"). Returns null if that nth doesn't
// exist in this particular month (e.g. a "5th Monday" in a month that
// only has four) — the caller skips that month rather than guessing.
function nthWeekdayOfMonth(year, monthIndex, targetDow, nth) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  if (nth === -1) {
    const lastDay = new Date(year, monthIndex, daysInMonth);
    const lastDow = lastDay.getDay();
    const offset = (lastDow - targetDow + 7) % 7;
    return new Date(year, monthIndex, daysInMonth - offset);
  }

  const firstDay = new Date(year, monthIndex, 1);
  const firstDow = firstDay.getDay();
  const firstOccurrenceDay = 1 + ((targetDow - firstDow + 7) % 7);
  const targetDay = firstOccurrenceDay + (nth - 1) * 7;
  if (targetDay > daysInMonth) return null; // this nth doesn't exist this month
  return new Date(year, monthIndex, targetDay);
}

// Computes the nth occurrence date for a recurrence pattern, with correct
// month/year rollover clamping (e.g. a Jan 31 monthly anchor lands on Feb 28,
// not March 3 — JS Date's naive setMonth() would do the wrong thing here).
function nthOccurrence(series, n) {
  const { anchor_date: anchorDateStr, recurrence_type: recurrenceType, interval_count: intervalCount,
          monthly_mode: monthlyMode, nth_week: nthWeek, nth_weekday_dow: nthWeekdayDow,
          yearly_mode: yearlyMode, yearly_month: yearlyMonth } = series;
  const anchor = new Date(anchorDateStr + 'T00:00:00');

  if (recurrenceType === 'daily') {
    const d = new Date(anchor);
    d.setDate(d.getDate() + n * intervalCount);
    return d;
  }

  if (recurrenceType === 'weekly') {
    const d = new Date(anchor);
    d.setDate(d.getDate() + n * intervalCount * 7);
    return d;
  }

  if (recurrenceType === 'monthly' && monthlyMode === 'nth_weekday') {
    // Walk forward month-by-month from the anchor's month, skipping any
    // month where this nth-weekday doesn't exist (e.g. a rare "5th X"),
    // until we've found (n+1) valid occurrences.
    let monthIndex = anchor.getMonth();
    let year = anchor.getFullYear();
    let found = -1;
    let steps = 0;
    while (found < n) {
      const candidate = nthWeekdayOfMonth(year, monthIndex, nthWeekdayDow, nthWeek);
      if (candidate) found++;
      if (found === n) return candidate;
      monthIndex += intervalCount;
      year += Math.floor(monthIndex / 12);
      monthIndex = ((monthIndex % 12) + 12) % 12;
      steps++;
      if (steps > 500) throw new Error('nth-weekday search exceeded safety limit');
    }
  }

  if (recurrenceType === 'monthly') {
    const anchorDay = anchor.getDate();
    const targetMonthIndex = anchor.getMonth() + n * intervalCount;
    const targetYear = anchor.getFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(anchorDay, daysInTargetMonth);
    return new Date(targetYear, targetMonth, clampedDay);
  }

  if (recurrenceType === 'yearly' && yearlyMode === 'nth_weekday') {
    // Same "walk forward, skip years where this nth-weekday doesn't exist"
    // approach as the monthly version — a genuine "5th X" in a given month
    // is rare but should be skipped, not guessed at.
    let year = anchor.getFullYear();
    const monthIndex = yearlyMonth - 1; // yearlyMonth is 1-12
    let found = -1;
    let steps = 0;
    while (found < n) {
      const candidate = nthWeekdayOfMonth(year, monthIndex, nthWeekdayDow, nthWeek);
      if (candidate) found++;
      if (found === n) return candidate;
      year += intervalCount;
      steps++;
      if (steps > 500) throw new Error('yearly nth-weekday search exceeded safety limit');
    }
  }

  if (recurrenceType === 'yearly') {
    const targetYear = anchor.getFullYear() + n * intervalCount;
    const anchorMonth = anchor.getMonth();
    const anchorDay = anchor.getDate();
    const daysInTargetMonth = new Date(targetYear, anchorMonth + 1, 0).getDate();
    const clampedDay = Math.min(anchorDay, daysInTargetMonth); // handles Feb 29 anchor on non-leap years
    return new Date(targetYear, anchorMonth, clampedDay);
  }

  throw new Error(`Unknown recurrence_type: ${recurrenceType}`);
}

// Materializes (inserts/updates) day_entries for a series from today's n=0
// forward through WINDOW_YEARS. Idempotent — safe to call repeatedly; uses
// the same ON CONFLICT(external_id) pattern as the other sync sources so
// re-running this never duplicates rows.
function materializeSeries(series) {
  const windowEnd = new Date();
  windowEnd.setFullYear(windowEnd.getFullYear() + WINDOW_YEARS);

  // If an "until" date is set, it caps generation even if it's sooner than
  // the default window — otherwise the window (whichever is sooner) applies.
  let effectiveEnd = windowEnd;
  if (series.until_date) {
    const untilDate = new Date(series.until_date + 'T23:59:59');
    if (untilDate < effectiveEnd) effectiveEnd = untilDate;
  }

  const upsert = db.prepare(`
    INSERT INTO day_entries (entry_date, start_time, end_time, title, notes, color, source, external_id, recurring_series_id)
    VALUES (?, ?, ?, ?, ?, ?, 'recurring', ?, ?)
    ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO UPDATE SET
      entry_date = excluded.entry_date,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      title = excluded.title,
      notes = excluded.notes,
      color = excluded.color,
      updated_at = datetime('now')
  `);

  const exceptions = new Set(
    db.prepare('SELECT exception_date FROM recurring_exceptions WHERE series_id = ?').all(series.id).map(r => r.exception_date)
  );

  let n = 0;
  let generated = 0;
  while (true) {
    const occurrence = nthOccurrence(series, n);
    if (occurrence > effectiveEnd) break;
    const dateStr = dateToStr(occurrence);
    if (!exceptions.has(dateStr)) {
      const externalId = `recurring-${series.id}-${dateStr}`;
      upsert.run(dateStr, series.start_time, series.end_time, series.title, series.notes, series.color, externalId, series.id);
      generated++;
    }
    n++;
    if (n > 2000) break; // safety valve against a runaway loop
  }
  return generated;
}

// GET /api/recurring-series
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM recurring_series WHERE active = 1 ORDER BY title').all());
});

// POST /api/recurring-series
router.post('/', (req, res) => {
  const { title, notes, color, recurrence_type, interval_count, anchor_date, start_time, end_time, until_date,
          monthly_mode, nth_week, nth_weekday_dow, yearly_mode, yearly_month } = req.body;
  if (!title || !recurrence_type || !anchor_date) {
    return res.status(400).json({ error: 'title, recurrence_type, and anchor_date are required' });
  }
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(recurrence_type)) {
    return res.status(400).json({ error: 'recurrence_type must be daily, weekly, monthly, or yearly' });
  }
  if (monthly_mode === 'nth_weekday' && (nth_week === undefined || nth_weekday_dow === undefined)) {
    return res.status(400).json({ error: 'nth_week and nth_weekday_dow are required when monthly_mode is nth_weekday' });
  }
  if (yearly_mode === 'nth_weekday' && (nth_week === undefined || nth_weekday_dow === undefined || yearly_month === undefined)) {
    return res.status(400).json({ error: 'nth_week, nth_weekday_dow, and yearly_month are required when yearly_mode is nth_weekday' });
  }

  const result = db.prepare(`
    INSERT INTO recurring_series (title, notes, color, recurrence_type, interval_count, anchor_date, start_time, end_time, until_date, monthly_mode, nth_week, nth_weekday_dow, yearly_mode, yearly_month)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title, notes || null, color || '#8e44ad', recurrence_type, interval_count || 1, anchor_date,
    start_time || null, end_time || null, until_date || null,
    monthly_mode || 'day_of_month', nth_week ?? null, nth_weekday_dow ?? null,
    yearly_mode || 'month_day', yearly_month ?? null
  );

  const series = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(result.lastInsertRowid);
  const generated = materializeSeries(series);
  res.status(201).json({ series, generated });
});

// PUT /api/recurring-series/:id — edits the series and regenerates future
// instances. Past instances (before today) are left untouched, so history
// stays accurate even if you change a series' time or title going forward.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { title, notes, color, recurrence_type, interval_count, anchor_date, start_time, end_time, until_date,
          monthly_mode, nth_week, nth_weekday_dow, yearly_mode, yearly_month } = req.body;
  db.prepare(`
    UPDATE recurring_series SET title=?, notes=?, color=?, recurrence_type=?, interval_count=?, anchor_date=?, start_time=?, end_time=?, until_date=?, monthly_mode=?, nth_week=?, nth_weekday_dow=?, yearly_mode=?, yearly_month=?
    WHERE id=?
  `).run(
    title ?? existing.title, notes ?? existing.notes, color ?? existing.color,
    recurrence_type ?? existing.recurrence_type, interval_count ?? existing.interval_count,
    anchor_date ?? existing.anchor_date, start_time ?? existing.start_time, end_time ?? existing.end_time,
    until_date !== undefined ? until_date : existing.until_date,
    monthly_mode ?? existing.monthly_mode,
    nth_week !== undefined ? nth_week : existing.nth_week,
    nth_weekday_dow !== undefined ? nth_weekday_dow : existing.nth_weekday_dow,
    yearly_mode ?? existing.yearly_mode,
    yearly_month !== undefined ? yearly_month : existing.yearly_month,
    req.params.id
  );

  // Remove only future, still-attached (not detached-to-manual) instances,
  // then regenerate — detached instances and past history are untouched.
  const today = dateToStr(new Date());
  db.prepare(`DELETE FROM day_entries WHERE recurring_series_id = ? AND source = 'recurring' AND entry_date >= ?`).run(req.params.id, today);

  const series = db.prepare('SELECT * FROM recurring_series WHERE id = ?').get(req.params.id);
  const generated = materializeSeries(series);
  res.json({ series, generated });
});

// DELETE /api/recurring-series/:id — removes the series and every instance
// it generated, past and future.
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM recurring_series WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  db.prepare(`DELETE FROM day_entries WHERE recurring_series_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM recurring_exceptions WHERE series_id = ?`).run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
