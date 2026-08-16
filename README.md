# Daily Planner

Day timeline + month calendar planner. Weekly recurring blocks (work hours,
commute) set manually each week, plus one-off entries (calls, errands,
appointments). Optional Google Calendar sync (read-only — events show up
in the timeline but are edited in Google Calendar, not here).

## Stack
Node.js/Express, better-sqlite3, bcrypt/session auth, vanilla HTML/CSS/JS, Docker.

## Setting up Google Calendar sync (do this before first deploy, or anytime later)

1. Go to **console.cloud.google.com** and create a new project (any name, e.g. "Daily Planner").
2. In the left sidebar, go to **APIs & Services → Library**, search for **Google Calendar API**, and click **Enable**.
3. Go to **APIs & Services → OAuth consent screen**.
   - User type: **External**
   - Fill in the required app name, your email, etc.
   - Scopes: you can skip adding scopes here — the app requests them directly.
   - Test users: add your own Google account email here. Since this is "in testing" mode (not published/verified by Google), only accounts listed here can authorize it — that's fine for personal use, no need to publish or get Google's verification.
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Authorized redirect URIs: add exactly `https://daily.megangibbs.net/api/google/callback`
   - Click Create — you'll get a **Client ID** and **Client Secret**.
5. Put those two values into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Once deployed, go to Settings (⚙️) in the app and click **Connect Google Calendar** — it'll walk you through Google's consent screen and bring you back automatically.

## First-time setup

1. Copy the env template and fill in real values:
   ```
   cp .env.example .env
   ```
2. Build and start:
   ```
   docker compose up -d --build
   ```
3. Open the app, log in with `DEFAULT_USERNAME`/`DEFAULT_PASSWORD`, then go to Settings and change your password.

## iPhone home screen widget

An iOS Scriptable widget is included (`ios-widget/DailyPlannerWidget.js`) — one script that works as either a **small** or **medium** home screen widget, showing today's schedule (weekly blocks + one-off entries, merged and sorted by time). Requires the free Scriptable app; setup instructions are in the comments at the top of the file. You'll need a `WIDGET_API_KEY` set in `.env` — generate one the same way as the other keys.

## Mobile

The web app is responsive — on narrow screens, the month view drops event title text and shows colored dots only (to fit the smaller grid cells), and modals/forms stack to full width.

## Notes

- **Weekly blocks** are per-week, not a permanent template — click "Edit This Week's Blocks" from the Day view, or use "Copy Last Week's Blocks" to carry forward a typical week instead of re-entering it.
- **Google Calendar sync is one-directional and read-only in this app** — synced events can't be edited or deleted here, only in Google Calendar itself. Re-syncing updates them if they changed.
- Sync pulls a rolling 60-day window from today each time you click "Sync Now" — there's no automatic background sync yet; it's manual by design for v1.
- If Google sync ever stops working (e.g. "invalid_grant" errors), disconnect and reconnect via Settings to get a fresh token.
