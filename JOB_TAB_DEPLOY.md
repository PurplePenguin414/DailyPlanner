# Job Search tab — deploy notes

What's new: a **Jobs** tab in Daily Planner, with a **Calls** log inside it (the "Calls" filter chip, no extra tab). Follow-ups and call next-steps show up in your iCal feed, in the Today widget, and in a new Recent Jobs widget. Nothing existing is changed or removed; the `jobs` and `job_calls` tables are added automatically on first start.

## 1. Upload these files (GitHub web UI → same paths)
New: `lib/jobs-core.js`, `lib/job-pings.js`, `routes/jobs.js`, `public/jobs.js`, `ios-widget/JobSearchWidget.js`
Changed: `server.js`, `routes/ical.js`, `public/index.html`, `public/app.css`, `.env.example`

## 2. (Optional) turn on Discord pings
Add to the server's `.env` (not committed). Pings go to the channel that webhook belongs to, so make a dedicated channel for them. Pings are off for every job and call until you tick "Ping me" on it.
```
DISCORD_JOBS_WEBHOOK_URL=your-webhook-url
JOBS_TIMEZONE=America/Detroit
```

## 3. Deploy on MLG-VPS02
Pulls the latest code from GitHub and discards any local edits to tracked files (your `./data` folder and `.env` are untouched), then rebuilds the container.
```
cd /path/to/DailyPlanner
git fetch origin && git reset --hard origin/main
docker compose up -d --build
```

## 4. Check it
Open Daily Planner → Jobs tab → Add job. Calendar feed: refresh your subscribed calendar; follow-ups appear as all-day "Follow up: Company".
Widget: paste `ios-widget/JobSearchWidget.js` into a new Scriptable script, set the key.
