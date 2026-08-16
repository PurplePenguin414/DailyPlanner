// Daily Planner — iOS Home Screen Widget
// Requires the free "Scriptable" app from the App Store.
//
// SETUP:
// 1. Open Scriptable, tap + to create a new script, paste this whole file in.
// 2. Replace WIDGET_URL and WIDGET_KEY below with your real values.
// 3. Tap the wrench icon (bottom right) > run once to test.
//    NOTE: manual test runs always preview the medium layout — Scriptable
//    only knows the real widget size (small vs medium) once it's actually
//    placed on your home screen, not when run manually inside the app.
// 4. Long-press your iPhone home screen > tap + (top left) > search "Scriptable"
//    > choose the SMALL, MEDIUM, or LARGE widget size > add it. This one
//    script handles all three sizes automatically — no need for separate scripts.
// 5. Long-press the new widget > Edit Widget > set "Script" to this script's name.
//
// The widget refreshes periodically on iOS's own schedule (usually every
// 15-60 min); tap the widget to jump straight into the app.

const WIDGET_URL = "https://daily.megangibbs.net/api/widget/today";
const WIDGET_KEY = "PASTE_YOUR_WIDGET_API_KEY_HERE";
const APP_URL = "https://daily.megangibbs.net";

async function getData() {
  const req = new Request(`${WIDGET_URL}?key=${WIDGET_KEY}`);
  req.timeoutInterval = 10;
  try {
    return await req.loadJSON();
  } catch (e) {
    return { error: true };
  }
}

function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function formatDateHeader() {
  const now = new Date();
  return now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

async function createWidget(data, size) {
  const isSmall = size === "small";
  const isLarge = size === "large";
  const w = new ListWidget();
  w.backgroundColor = new Color("#000000");
  w.url = APP_URL;
  w.setPadding(14, 14, 14, 14);

  if (data.error) {
    const t = w.addText("Couldn't load Daily Planner");
    t.font = Font.mediumSystemFont(13);
    t.textColor = new Color("#b8483c");
    return w;
  }

  const title = w.addText(isSmall ? "📅 Today" : "📅 Today's Schedule");
  title.font = Font.boldSystemFont(isSmall ? 13 : 15);
  title.textColor = new Color("#ffffff");

  const dateLabel = w.addText(formatDateHeader());
  dateLabel.font = Font.systemFont(10);
  dateLabel.textColor = new Color("#c7c7c7");
  w.addSpacer(isSmall ? 5 : 8);

  const items = data.items || [];

  if (items.length === 0) {
    w.addSpacer();
    const empty = w.addText("Nothing scheduled");
    empty.font = Font.systemFont(12);
    empty.textColor = new Color("#c7c7c7");
    w.addSpacer();
    return w;
  }

  const maxItems = isSmall ? 3 : isLarge ? 12 : 6;
  const shown = items.slice(0, maxItems);

  for (const item of shown) {
    const row = w.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();

    const dot = row.addText("●");
    dot.font = Font.systemFont(isSmall ? 9 : 10);
    dot.textColor = new Color(item.color || "#4a6fa5");
    row.addSpacer(5);

    const timeLabel = formatTime(item.start_time);
    if (timeLabel && !isSmall) {
      const time = row.addText(timeLabel);
      time.font = Font.systemFont(10);
      time.textColor = new Color("#c7c7c7");
      time.lineLimit = 1;
      row.addSpacer(5);
    }

    const name = row.addText(item.title);
    name.font = Font.mediumSystemFont(isSmall ? 11 : 12);
    name.textColor = new Color("#ffffff");
    name.lineLimit = 1;

    if (isSmall && timeLabel) {
      row.addSpacer();
      const time = row.addText(timeLabel);
      time.font = Font.systemFont(8);
      time.textColor = new Color("#c7c7c7");
      time.rightAlignText();
    }

    w.addSpacer(isSmall ? 3 : 4);
  }

  if (items.length > shown.length) {
    w.addSpacer(2);
    const more = w.addText(`+${items.length - shown.length} more`);
    more.font = Font.systemFont(9);
    more.textColor = new Color("#c7c7c7");
  }

  return w;
}

const data = await getData();
const size = config.widgetFamily || "medium"; // manual test runs default to medium — see note above
const widget = await createWidget(data, size);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // Preview whichever size Scriptable reports; manual runs default to medium
  // per the limitation noted above.
  if (size === "small") {
    await widget.presentSmall();
  } else if (size === "large") {
    await widget.presentLarge();
  } else {
    await widget.presentMedium();
  }
}
Script.complete();
