const express = require('express');
const router = express.Router();
const db = require('../db');

const TYPE_LABELS = {
  therapy: 'Therapy / EMDR',
  dietitian: 'Dietitian',
  doctor: 'Doctor',
  other: 'Other'
};
const TYPE_COLORS = {
  therapy: '#2e7d32',
  dietitian: '#e0a324',
  doctor: '#4a6fa5',
  other: '#8e44ad'
};

// GET /api/medtracker/status
router.get('/status', (req, res) => {
  const configured = !!(process.env.MEDTRACKER_API_URL && process.env.MEDTRACKER_API_KEY);
  const row = db.prepare("SELECT MAX(updated_at) AS last_synced_at FROM day_entries WHERE source = 'medtracker'").get();
  res.json({ configured, last_synced_at: row?.last_synced_at || null });
});

// POST /api/medtracker/sync { start, end }
router.post('/sync', async (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates are required' });

  const baseUrl = process.env.MEDTRACKER_API_URL;
  const apiKey = process.env.MEDTRACKER_API_KEY;
  if (!baseUrl || !apiKey) {
    return res.status(400).json({ error: 'MEDTRACKER_API_URL / MEDTRACKER_API_KEY not configured in .env' });
  }

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/external/appointments?start=${start}&end=${end}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Med & Appointment Tracker returned ${response.status}: ${body}`);
    }
    const appointments = await response.json();

    const upsert = db.prepare(`
      INSERT INTO day_entries (entry_date, start_time, end_time, title, notes, color, source, external_id)
      VALUES (?, ?, ?, ?, ?, ?, 'medtracker', ?)
      ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO UPDATE SET
        entry_date = excluded.entry_date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        title = excluded.title,
        notes = excluded.notes,
        updated_at = datetime('now')
    `);

    let synced = 0;
    appointments.forEach(appt => {
      const label = TYPE_LABELS[appt.type] || appt.type;
      const title = `${label}${appt.provider_name ? ' — ' + appt.provider_name : ''}`;
      const notes = appt.location || null;
      const externalId = `medtracker-${appt.id}`;
      upsert.run(
        appt.appointment_date,
        appt.appointment_time || null,
        null, // Med & Appointment Tracker doesn't track an end time for appointments
        title,
        notes,
        TYPE_COLORS[appt.type] || '#8e44ad',
        externalId
      );
      synced++;
    });

    res.json({ success: true, synced });
  } catch (err) {
    console.error('Med & Appointment Tracker sync error:', err.message);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

module.exports = router;
