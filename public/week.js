// Week tab: a rolling 7-day look-ahead (starts today). Read-only; tap a day to open it.
(function () {
  var start = null;

  function $(id) { return document.getElementById(id); }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return dateToStr(d); }
  function dayLabel(s) { return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

  async function jget(url, fallback) {
    try { var r = await fetch(url); if (!r.ok) return fallback; return await r.json(); } catch (e) { return fallback; }
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
    $('weekGrid').innerHTML = html;
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
      var d = e.target.closest('.week-day'); if (!d) return;
      currentDate = d.dataset.date;
      document.querySelector('.view-tab-btn[data-view="day"]').click();
    });
  });
})();
