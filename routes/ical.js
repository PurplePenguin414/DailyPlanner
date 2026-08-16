const express = require('express');
const router = express.Router();
const db = require('../db');

// A correct, standard VTIMEZONE block for US Eastern (covers America/Detroit).
// Including this makes the feed properly DST-aware for any calendar client
// that consumes it, rather than relying on the client already knowing the zone.
const VTIMEZONE_BLOCK = `BEGIN:VTIMEZONE
TZID:America/New_York
X-LIC-LOCATION:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`;

function icsEscape(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line) {
  // iCalendar spec requires long lines folded at 75 octets; keeps feeds valid
  // for stricter parsers even though most modern clients tolerate long lines.
  if (line.length <= 75) return line;
  let result = '';
  let remaining = line;
  while (remaining.length > 75) {
    result += remaining.slice(0, 75) + '\r\n ';
    remaining = remaining.slice(75);
  }
  return result + remaining;
}

function buildTimedEvent({ uid, dtstamp, startDate, startTime, endTime, summary, description }) {
  const datePart = startDate.replace(/-/g, '');
  const dtstart = `${datePart}T${(startTime || '00:00').replace(':', '')}00`;
  const endTimeVal = endTime || addMinutes(startTime || '00:00', 60);
  const dtend = `${datePart}T${endTimeVal.replace(':', '')}00`;

  return [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=America/New_York:${dtstart}`,
    `DTEND;TZID=America/New_York:${dtend}`,
    foldLine(`SUMMARY:${icsEscape(summary)}`),
    description ? foldLine(`DESCRIPTION:${icsEscape(description)}`) : null,
    'END:VEVENT'
  ].filter(Boolean).join('\r\n');
}

function buildAllDayEvent({ uid, dtstamp, startDate, summary, description }) {
  const datePart = startDate.replace(/-/g, '');
  const nextDay = new Date(startDate + 'T00:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDatePart = `${nextDay.getFullYear()}${String(nextDay.getMonth() + 1).padStart(2, '0')}${String(nextDay.getDate()).padStart(2, '0')}`;

  return [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${datePart}`,
    `DTEND;VALUE=DATE:${nextDatePart}`,
    foldLine(`SUMMARY:${icsEscape(summary)}`),
    description ? foldLine(`DESCRIPTION:${icsEscape(description)}`) : null,
    'END:VEVENT'
  ].filter(Boolean).join('\r\n');
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// GET /api/ical/feed.ics?key=XXX
// No session auth — calendar apps poll this URL directly on a schedule with
// no login flow, so it's protected by its own dedicated key instead.
router.get('/feed.ics', (req, res) => {
  const feedKey = process.env.ICAL_FEED_KEY;
  if (!feedKey) return res.status(503).send('ICAL_FEED_KEY not configured on this server');
  if (req.query.key !== feedKey) return res.status(401).send('Invalid or missing key');

  const today = new Date();
  const windowStart = new Date(today); windowStart.setDate(windowStart.getDate() - 30);
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + 180);
  const startStr = dateToStr(windowStart);
  const endStr = dateToStr(windowEnd);

  const entries = db.prepare('SELECT * FROM day_entries WHERE entry_date >= ? AND entry_date <= ? ORDER BY entry_date').all(startStr, endStr);
  const blocks = db.prepare('SELECT * FROM weekly_blocks WHERE week_start >= ? AND week_start <= ? ORDER BY week_start, day_of_week').all(startStr, endStr);

  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events = [];

  entries.forEach(e => {
    const uid = `entry-${e.id}@daily.megangibbs.net`;
    if (e.start_time) {
      events.push(buildTimedEvent({ uid, dtstamp, startDate: e.entry_date, startTime: e.start_time, endTime: e.end_time, summary: e.title, description: e.notes }));
    } else {
      events.push(buildAllDayEvent({ uid, dtstamp, startDate: e.entry_date, summary: e.title, description: e.notes }));
    }
  });

  blocks.forEach(b => {
    const weekStartDate = new Date(b.week_start + 'T00:00:00');
    // day_of_week: 0=Sun..6=Sat. week_start is a Monday, so compute the actual
    // calendar date for this block's day within that week.
    const offset = b.day_of_week === 0 ? 6 : b.day_of_week - 1;
    const blockDate = new Date(weekStartDate);
    blockDate.setDate(blockDate.getDate() + offset);
    const blockDateStr = dateToStr(blockDate);
    const uid = `block-${b.id}@daily.megangibbs.net`;
    events.push(buildTimedEvent({ uid, dtstamp, startDate: blockDateStr, startTime: b.start_time, endTime: b.end_time, summary: b.label }));
  });

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Planner//megangibbs.net//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Daily Planner',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    VTIMEZONE_BLOCK.replace(/\n/g, '\r\n'),
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="daily-planner.ics"');
  res.send(calendar);
});

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = router;
