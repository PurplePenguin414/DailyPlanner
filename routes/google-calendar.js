const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const db = require('../db');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const REDIRECT_URI = `${APP_URL}/api/google/callback`;

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

// GET /api/google/status — is a calendar connected?
router.get('/status', (req, res) => {
  const row = db.prepare('SELECT connected_at, last_synced_at, calendar_id FROM google_calendar_auth WHERE id = 1').get();
  res.json({ connected: !!row, ...row });
});

// GET /api/google/connect — kicks off the OAuth flow
router.get('/connect', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({ error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured in .env' });
  }
  const oauth2Client = getOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',       // needed to get a refresh_token
    prompt: 'consent',            // forces refresh_token on every connect, not just the first time
    scope: ['https://www.googleapis.com/auth/calendar.readonly']
  });
  res.json({ url });
});

// GET /api/google/callback — Google redirects here after consent
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    db.prepare(`
      INSERT INTO google_calendar_auth (id, access_token, refresh_token, token_expiry, connected_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = COALESCE(excluded.refresh_token, google_calendar_auth.refresh_token),
        token_expiry = excluded.token_expiry,
        connected_at = datetime('now')
    `).run(tokens.access_token, tokens.refresh_token || null, tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null);

    res.redirect('/?calendar=connected');
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    res.redirect('/?calendar=error');
  }
});

// POST /api/google/disconnect
router.post('/disconnect', (req, res) => {
  db.prepare('DELETE FROM google_calendar_auth WHERE id = 1').run();
  db.prepare("DELETE FROM day_entries WHERE source = 'google'").run();
  res.json({ success: true });
});

async function getAuthedClient() {
  const row = db.prepare('SELECT * FROM google_calendar_auth WHERE id = 1').get();
  if (!row || !row.refresh_token) return null;

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: row.refresh_token });

  // Refresh the access token if needed — the client library handles this
  // automatically on each API call using the refresh_token.
  return oauth2Client;
}

// POST /api/google/sync — pulls events for a date range into day_entries
router.post('/sync', async (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: 'start and end dates are required' });

  const auth = await getAuthedClient();
  if (!auth) return res.status(400).json({ error: 'Google Calendar is not connected' });

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const calRow = db.prepare('SELECT calendar_id FROM google_calendar_auth WHERE id = 1').get();

    const response = await calendar.events.list({
      calendarId: calRow?.calendar_id || 'primary',
      timeMin: new Date(start + 'T00:00:00').toISOString(),
      timeMax: new Date(end + 'T23:59:59').toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    const upsert = db.prepare(`
      INSERT INTO day_entries (entry_date, start_time, end_time, title, notes, color, source, external_id)
      VALUES (?, ?, ?, ?, ?, '#8e44ad', 'google', ?)
      ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO UPDATE SET
        entry_date = excluded.entry_date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        title = excluded.title,
        notes = excluded.notes,
        updated_at = datetime('now')
    `);

    let synced = 0;
    events.forEach(ev => {
      const isAllDay = !!ev.start.date;
      const entryDate = isAllDay ? ev.start.date : ev.start.dateTime.slice(0, 10);
      const startTime = isAllDay ? null : ev.start.dateTime.slice(11, 16);
      const endTime = isAllDay ? null : ev.end.dateTime.slice(11, 16);
      upsert.run(entryDate, startTime, endTime, ev.summary || '(No title)', ev.description || null, ev.id);
      synced++;
    });

    db.prepare("UPDATE google_calendar_auth SET last_synced_at = datetime('now') WHERE id = 1").run();
    res.json({ success: true, synced });
  } catch (err) {
    console.error('Google Calendar sync error:', err.message);
    res.status(500).json({ error: 'Sync failed — the connection may need to be re-authorized', detail: err.message });
  }
});

module.exports = router;
