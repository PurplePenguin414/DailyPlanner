// Daily Planner — Recent Jobs widget (iOS, Scriptable app).
// Paste into a new Scriptable script, set WIDGET_KEY (same value as WIDGET_API_KEY
// on the server), then add a Scriptable widget to your Home Screen and pick this script.
const BASE = "https://daily.megangibbs.net";
const WIDGET_KEY = "PASTE_YOUR_WIDGET_API_KEY_HERE";

async function getData() {
  const req = new Request(`${BASE}/api/jobs/widget/recent?key=${WIDGET_KEY}`);
  req.timeoutInterval = 10;
  try { return await req.loadJSON(); } catch (e) { return null; }
}
function nice(s) {
  if (!s) return "";
  const p = s.split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+p[1]-1] + " " + (+p[2]);
}

const data = await getData();
const w = new ListWidget();
w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1c"));
w.url = BASE;
const maxRows = config.widgetFamily === "small" ? 3 : config.widgetFamily === "large" ? 8 : 5;

if (!data) {
  const t = w.addText("Couldn't load jobs");
  t.font = Font.systemFont(13);
} else {
  const head = w.addText(`Jobs — ${data.open} open` + (data.followups_due ? ` · ${data.followups_due} to follow up` : ""));
  head.font = Font.boldSystemFont(13);
  w.addSpacer(6);
  if (!data.jobs.length) {
    const t = w.addText("No jobs yet"); t.font = Font.systemFont(12); t.textOpacity = 0.6;
  }
  data.jobs.slice(0, maxRows).forEach(j => {
    const line = w.addText(`${j.company}${j.role ? " — " + j.role : ""}`);
    line.font = Font.semiboldSystemFont(12); line.lineLimit = 1;
    const sub = w.addText(`${j.status}${j.next_follow_up ? " · follow up " + nice(j.next_follow_up) : ""}`);
    sub.font = Font.systemFont(10); sub.textOpacity = 0.6; sub.lineLimit = 1;
    w.addSpacer(3);
  });
}
if (config.runsInWidget) Script.setWidget(w); else await w.presentMedium();
Script.complete();
