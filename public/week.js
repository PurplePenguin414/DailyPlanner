// Week tab: a rolling 7-day look-ahead (starts today). Read-only; tap a day to open it.
(function () {
  var start = null;

  function $(id) { return document.getElementById(id); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return dateToStr(d); }
  function dayLabel(s) { return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

  async function jget(url, fallback) {
    try { var r = await fetch(url); if (!r.ok) return fallback; return await r.json(); } catch (e) { return fallback; }
  }

  // ---- Wide-screen layout: mini day timelines side by side ----
  function toMin(t) { var p = t.split(':'); return (+p[0] - TIMELINE_START_HOUR) * 60 + +p[1]; }

  // Lay overlapping items out side by side inside one day column.
  function lanes(items) {
    var list = items.map(function (it) {
      var st = Math.max(0, toMin(it.start_time));
      var en = it.end_time ? toMin(it.end_time) : st + 60;
      if (en <= st) en = st + 60;
      return { it: it, st: st, en: en, lane: 0, lanes: 1 };
    }).sort(function (a, b) { return a.st - b.st || a.en - b.en; });
    var cluster = [], clusterEnd = -1;
    function flush() {
      var n = 0; cluster.forEach(function (c) { if (c.lane + 1 > n) n = c.lane + 1; });
      cluster.forEach(function (c) { c.lanes = n; });
      cluster = [];
    }
    list.forEach(function (c) {
      if (cluster.length && c.st >= clusterEnd) { flush(); clusterEnd = -1; }
      var used = {};
      cluster.forEach(function (o) { if (o.en > c.st) used[o.lane] = true; });
      var l = 0; while (used[l]) l++;
      c.lane = l; cluster.push(c); clusterEnd = Math.max(clusterEnd, c.en);
    });
    flush();
    return list;
  }

  function buildTimeline(dates, byDate, today) {
    var hours = TIMELINE_END_HOUR - TIMELINE_START_HOUR + 1;
    var h = hours * PX_PER_HOUR;
    var gutter = '';
    for (var i = 0; i < hours; i++) gutter += '<div class="wk-hour-label" style="top:' + (i * PX_PER_HOUR) + 'px">' + formatHourLabel(TIMELINE_START_HOUR + i) + '</div>';
    var heads = '', allday = '', cols = '';
    dates.forEach(function (ds) {
      var isToday = ds === today;
      var items = byDate[ds];
      heads += '<div class="wk-dayhead' + (isToday ? ' today' : '') + '" data-date="' + ds + '">' + escapeHtml(dayLabel(ds)) + '</div>';
      allday += '<div class="wk-allday-cell" data-date="' + ds + '">' + items.filter(function (x) { return !x.start_time; }).map(function (x) {
        return '<div class="wk-allday-item" title="' + escapeHtml(x.title || '') + '" style="background:' + escapeHtml(x.color || '#2e7d32') + '">' + escapeHtml(x.title || '') + '</div>';
      }).join('') + '</div>';
      var timed = lanes(items.filter(function (x) { return x.start_time; }));
      cols += '<div class="wk-col' + (isToday ? ' today' : '') + '" data-date="' + ds + '" style="height:' + h + 'px">' + timed.map(function (c) {
        var top = (c.st / 60) * PX_PER_HOUR, ht = Math.max(20, ((c.en - c.st) / 60) * PX_PER_HOUR);
        var w = 100 / c.lanes;
        return '<div class="wk-entry" title="' + escapeHtml((c.it.title || '') + ' — ' + formatTime(c.it.start_time)) + '" style="top:' + top + 'px;height:' + ht + 'px;left:' + (c.lane * w) + '%;width:calc(' + w + '% - 2px);background:' + escapeHtml(c.it.color || '#2e7d32') + '">' +
          '<div class="wk-entry-title">' + escapeHtml(c.it.title || '') + '</div><div class="wk-entry-time">' + escapeHtml(formatTime(c.it.start_time)) + '</div></div>';
      }).join('') + '</div>';
    });
    return '<div class="week-cols">' +
      '<div class="wk-row"><div class="wk-gutter"></div>' + heads + '</div>' +
      '<div class="wk-row wk-allday-row"><div class="wk-gutter wk-allday-label">All day</div>' + allday + '</div>' +
      '<div class="wk-row wk-body"><div class="wk-gutter" style="height:' + h + 'px;position:relative">' + gutter + '</div>' + cols + '</div></div>';
  }

  async function load() {
    if (!start) start = todayStr();
    var end = addDays(start, 6);
    $('weekLabel').textContent = dayLabel(start) + ' – ' + dayLabel(end);
    var ws = getWeekStart(start);
    var res = await Promise.all([
      jget('/api/day-entries?start=' + start + '&end=' + end, []),
      jget('/api/weekly-blocks?start=' + ws + '&end=' + end, []),
      jget('/api/jobs/calendar?start=' + start + '&end=' + end, [])
    ]);
    var byDate = {};
    for (var i = 0; i < 7; i++) byDate[addDays(start, i)] = [];
    res[0].forEach(function (e) { if (byDate[e.entry_date]) byDate[e.entry_date].push({ title: e.title, start_time: e.start_time, end_time: e.end_time, color: e.color }); });
    res[2].forEach(function (e) { if (byDate[e.entry_date]) byDate[e.entry_date].push({ title: e.title, start_time: e.start_time, end_time: null, color: e.color }); });
    res[1].forEach(function (b) {
      var offset = b.day_of_week === 0 ? 6 : b.day_of_week - 1;
      var ds = addDays(b.week_start, offset);
      if (byDate[ds]) byDate[ds].push({ title: b.label, start_time: b.start_time, end_time: b.end_time, color: b.color });
    });
    var today = todayStr();
    var html = '';
    var dates = Object.keys(byDate);
    Object.keys(byDate).forEach(function (ds) {
      var items = byDate[ds].sort(function (a, b) {
        if (!a.start_time && !b.start_time) return 0;
        if (!a.start_time) return -1;   // all-day items first
        if (!b.start_time) return 1;
        return a.start_time.localeCompare(b.start_time);
      });
      html += '<div class="week-day' + (ds === today ? ' today' : '') + '" data-date="' + ds + '">' +
        '<div class="week-day-head">' + escapeHtml(dayLabel(ds)) + (ds === today ? ' <span class="week-today-tag">Today</span>' : '') + '</div>' +
        (items.length ? items.map(function (it) {
          return '<div class="week-item"><span class="week-dot" style="background:' + escapeHtml(it.color || '#2e7d32') + '"></span>' +
            '<span class="week-time">' + (it.start_time ? escapeHtml(formatTime(it.start_time)) : 'All day') + '</span>' +
            '<span class="week-title">' + escapeHtml(it.title || '') + '</span></div>';
        }).join('') : '<div class="week-empty muted-text">Nothing scheduled</div>') + '</div>';
    });
    $('weekGrid').innerHTML = '<div class="week-list">' + html + '</div>' + buildTimeline(dates, byDate, today);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.view-tab-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var isWeek = b.dataset.view === 'week';
        $('weekView').classList.toggle('hidden', !isWeek);
        if (isWeek) { start = todayStr(); load(); }
      });
    });
    $('weekPrevBtn').addEventListener('click', function () { start = addDays(start, -7); load(); });
    $('weekNextBtn').addEventListener('click', function () { start = addDays(start, 7); load(); });
    $('weekTodayBtn').addEventListener('click', function () { start = todayStr(); load(); });
    $('weekGrid').addEventListener('click', function (e) {
      var d = e.target.closest('.week-day, .wk-dayhead, .wk-col, .wk-allday-cell'); if (!d || !d.dataset.date) return;
      currentDate = d.dataset.date;
      document.querySelector('.view-tab-btn[data-view="day"]').click();
    });
  });
})();
