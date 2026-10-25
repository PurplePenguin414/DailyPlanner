// Opt-in Discord pings for job follow-ups.
// Rules: only jobs with follow_up_ping on; one ping, on the due date only;
// marked as sent only after Discord accepts it; overdue jobs are not re-pinged.
const cron = require('node-cron');
const { db, TZ, FOLLOW_UP_STATUSES, todayStr } = require('./jobs-core');

async function sendDiscord(content) {
  const url = process.env.DISCORD_JOBS_WEBHOOK_URL;
  if (!url) return false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  return res.ok;
}

async function runPings(now = new Date(), send = sendDiscord) {
  const today = todayStr(now);
  const marks = FOLLOW_UP_STATUSES.map(() => '?').join(',');
  const due = db.prepare(
    `SELECT * FROM jobs WHERE follow_up_ping = 1 AND next_follow_up = ?
       AND status IN (${marks}) AND (ping_sent_for IS NULL OR ping_sent_for != ?)`
  ).all(today, ...FOLLOW_UP_STATUSES, today);
  let sent = 0;
  for (const j of due) {
    const label = j.role ? `${j.company} (${j.role})` : j.company;
    try {
      if (await send(`Job follow-up today: **${label}** — status: ${j.status}`)) {
        db.prepare('UPDATE jobs SET ping_sent_for = ? WHERE id = ?').run(today, j.id);
        sent++;
      }
    } catch (e) { console.error('Job ping failed:', e.message); }
  }
  const calls = db.prepare(
    `SELECT * FROM job_calls WHERE next_step_ping = 1 AND next_step_done = 0 AND next_step_date = ?
       AND (ping_sent_for IS NULL OR ping_sent_for != ?)`
  ).all(today, today);
  for (const c of calls) {
    try {
      if (await send(`Call next step today: **${c.contact_name}**${c.company ? ' (' + c.company + ')' : ''}${c.next_step ? ' — ' + c.next_step : ''}`)) {
        db.prepare('UPDATE job_calls SET ping_sent_for = ? WHERE id = ?').run(today, c.id);
        sent++;
      }
    } catch (e) { console.error('Call ping failed:', e.message); }
  }
  return sent;
}

function startJobPings() {
  if (!process.env.DISCORD_JOBS_WEBHOOK_URL) {
    console.log('Job pings: DISCORD_JOBS_WEBHOOK_URL not set — pings disabled.');
    return;
  }
  runPings().catch(e => console.error('Job ping startup run failed:', e.message));
  cron.schedule('0 8 * * *', () => {
    runPings().catch(e => console.error('Job ping run failed:', e.message));
  }, { timezone: TZ });
}

module.exports = { runPings, startJobPings };
