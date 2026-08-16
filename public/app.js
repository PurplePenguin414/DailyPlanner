// ---- State ----
let currentView = 'day';
let currentDate = todayStr();
let currentMonthDate = new Date();
const TIMELINE_START_HOUR = 5;  // 5:00 AM
const TIMELINE_END_HOUR = 23;   // 11:00 PM
const PX_PER_HOUR = 60;

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
  initTheme();
  bindTopbar();
  bindViewTabs();
  bindDayView();
  bindMonthView();
  bindEntryModal();
  bindBlockEditModal();
  bindWeekModal();
  bindSettingsModal();
  renderTimelineSkeleton();
  loadDayView();
  checkGoogleCalendarReturn();
});

async function checkSession() {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (!data.authenticated) window.location.href = '/login.html';
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

// ---- Theme ----
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('darkModeToggle').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function bindTopbar() {
  document.getElementById('darkModeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    document.getElementById('darkModeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

// ---- View tabs ----
function bindViewTabs() {
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      document.getElementById('dayView').classList.toggle('hidden', currentView !== 'day');
      document.getElementById('monthView').classList.toggle('hidden', currentView !== 'month');
      if (currentView === 'day') loadDayView();
      if (currentView === 'month') loadMonthView();
    });
  });
}

// ================================================================
// DAY VIEW
// ================================================================
function bindDayView() {
  document.getElementById('prevDayBtn').addEventListener('click', () => shiftDay(-1));
  document.getElementById('nextDayBtn').addEventListener('click', () => shiftDay(1));
  document.getElementById('todayBtn').addEventListener('click', () => { currentDate = todayStr(); loadDayView(); });
  document.getElementById('addEntryBtn').addEventListener('click', () => openEntryModal(null));
  document.getElementById('editWeekBtn').addEventListener('click', () => openWeekModal(currentDate));
}

function shiftDay(delta) {
  const d = new Date(currentDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  currentDate = dateToStr(d);
  loadDayView();
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderTimelineSkeleton() {
  const timeline = document.getElementById('timeline');
  let html = '';
  for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h++) {
    const label = formatHourLabel(h);
    html += `<div class="timeline-hour" data-label="${label}"></div>`;
  }
  timeline.innerHTML = html;
}

function formatHourLabel(h) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12} ${ampm}`;
}

async function loadDayView() {
  document.getElementById('dayLabel').textContent = formatDayLabel(currentDate);

  const weekStart = getWeekStart(currentDate);
  const dayOfWeek = new Date(currentDate + 'T00:00:00').getDay();

  const [blocksRes, entriesRes] = await Promise.all([
    fetch(`/api/weekly-blocks?week_start=${weekStart}`),
    fetch(`/api/day-entries?date=${currentDate}`)
  ]);
  const allBlocks = await blocksRes.json();
  const entries = await entriesRes.json();
  const blocks = allBlocks.filter(b => b.day_of_week === dayOfWeek);

  renderTimelineEntries(blocks, entries);
}

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// Monday-based week start, to match the weekly_blocks day_of_week convention
// (0=Sun..6=Sat) while still anchoring "the week" on Monday for editing purposes.
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift back to Monday
  d.setDate(d.getDate() + diff);
  return dateToStr(d);
}

function timeToMinutesFromStart(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h - TIMELINE_START_HOUR) * 60 + m;
}

function renderTimelineEntries(blocks, entries) {
  // Remove any previously-rendered entry elements, keep the hour-row skeleton
  document.querySelectorAll('.timeline-entry').forEach(el => el.remove());
  const existingUntimed = document.querySelector('.timeline-untimed-list');
  if (existingUntimed) existingUntimed.remove();

  const timeline = document.getElementById('timeline');
  const untimed = [];

  const renderBlockEl = (item, isBlock) => {
    if (!item.start_time) { untimed.push(item); return; }
    const startMin = Math.max(0, timeToMinutesFromStart(item.start_time));
    const endMin = item.end_time ? timeToMinutesFromStart(item.end_time) : startMin + 60;
    const top = (startMin / 60) * PX_PER_HOUR;
    const height = Math.max(20, ((endMin - startMin) / 60) * PX_PER_HOUR);

    const el = document.createElement('div');
    el.className = 'timeline-entry' + (item.source === 'google' ? ' readonly' : '');
    el.style.top = `${top}px`;
    el.style.height = `${height}px`;
    el.style.background = item.color || (isBlock ? '#4a6fa5' : '#2e7d32');
    el.innerHTML = `
      <div class="entry-title">${escapeHtml(item.label || item.title)}</div>
      <div class="entry-time">${formatTime(item.start_time)}${item.end_time ? ' – ' + formatTime(item.end_time) : ''}</div>
    `;
    if (!isBlock) {
      el.addEventListener('click', () => openEntryModal(item));
    } else {
      el.addEventListener('click', () => openBlockEditModal(item));
    }
    timeline.appendChild(el);
  };

  blocks.forEach(b => renderBlockEl(b, true));
  entries.forEach(e => renderBlockEl(e, false));

  if (untimed.length) {
    const wrap = document.createElement('div');
    wrap.className = 'timeline-untimed-list';
    wrap.innerHTML = '<div class="muted-text" style="margin-bottom:0.4rem;">No specific time</div>' +
      untimed.map(item => `
        <div class="timeline-untimed-item" style="background:${item.color || '#2e7d32'}" data-id="${item.id}">
          <span>${escapeHtml(item.title || item.label)}</span>
        </div>
      `).join('');
    document.getElementById('timeline').closest('.timeline-wrap').appendChild(wrap);
    wrap.querySelectorAll('.timeline-untimed-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = untimed.find(u => String(u.id) === el.dataset.id);
        if (item && item.title !== undefined) openEntryModal(item); // only day_entries are clickable (blocks have .label not .title)
      });
    });
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

// ================================================================
// ENTRY MODAL (day_entries CRUD)
// ================================================================
function bindEntryModal() {
  document.getElementById('closeEntryModalBtn').addEventListener('click', closeEntryModal);
  document.getElementById('entryModal').addEventListener('click', (e) => { if (e.target.id === 'entryModal') closeEntryModal(); });
  document.getElementById('entryForm').addEventListener('submit', saveEntry);
  document.getElementById('deleteEntryBtn').addEventListener('click', deleteEntry);

  const repeatsSelect = document.getElementById('entryRepeats');
  const intervalRow = document.getElementById('repeatsIntervalRow');
  const intervalUnit = document.getElementById('repeatsIntervalUnit');
  const unitLabels = { weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };
  repeatsSelect.addEventListener('change', () => {
    const val = repeatsSelect.value;
    intervalRow.classList.toggle('hidden', !val);
    document.getElementById('repeatsUntilRow').classList.toggle('hidden', !val);
    document.getElementById('monthlyPatternRow').classList.toggle('hidden', val !== 'monthly');
    document.getElementById('nthWeekdayRow').classList.add('hidden'); // only shown once "nth_weekday" pattern is picked below
    if (val) intervalUnit.textContent = unitLabels[val];
  });

  document.getElementById('monthlyPatternMode').addEventListener('change', (e) => {
    document.getElementById('nthWeekdayRow').classList.toggle('hidden', e.target.value !== 'nth_weekday');
  });
}

function openEntryModal(entry) {
  const form = document.getElementById('entryForm');
  form.reset();
  const isFullyReadOnly = entry && (entry.source === 'google' || entry.source === 'medtracker');
  const isRecurring = entry && entry.source === 'recurring';
  const isReadOnly = isFullyReadOnly || isRecurring;

  document.getElementById('entryId').value = entry ? entry.id : '';
  document.getElementById('entryDate').value = entry ? entry.entry_date : currentDate;
  document.getElementById('entryTitle').value = entry ? entry.title : '';
  document.getElementById('entryStart').value = entry ? (entry.start_time || '') : '';
  document.getElementById('entryEnd').value = entry ? (entry.end_time || '') : '';
  document.getElementById('entryNotes').value = entry ? (entry.notes || '') : '';
  document.getElementById('entryColor').value = entry ? (entry.color || '#2e7d32') : '#2e7d32';

  document.getElementById('entryModalTitle').textContent = entry ? (isReadOnly ? sourceLabel(entry.source) : 'Edit Entry') : 'New Entry';
  document.getElementById('deleteEntryBtn').classList.toggle('hidden', !entry || isFullyReadOnly);

  const saveBtn = form.querySelector('.primary-btn');
  const inputs = form.querySelectorAll('input, textarea, select');
  inputs.forEach(i => i.disabled = isReadOnly);
  saveBtn.classList.toggle('hidden', isReadOnly);

  // "Repeats" only makes sense when creating a brand-new entry — converting
  // an existing single entry into a series isn't supported, keeps this simple.
  const repeatsGroup = document.getElementById('repeatsGroup');
  const repeatsIntervalRow = document.getElementById('repeatsIntervalRow');
  repeatsGroup.classList.toggle('hidden', !!entry);
  if (entry) repeatsIntervalRow.classList.add('hidden');
  document.getElementById('entryRepeats').value = '';

  document.getElementById('recurringNotice').classList.toggle('hidden', !isRecurring);
  document.getElementById('detachEntryBtn').onclick = () => detachEntry(entry?.id);
  document.getElementById('deleteSeriesBtn').onclick = () => deleteEntireSeries(entry?.recurring_series_id);

  document.getElementById('entryModal').classList.remove('hidden');
}

async function detachEntry(id) {
  if (!id) return;
  const res = await fetch(`/api/day-entries/${id}/detach`, { method: 'POST' });
  const detached = await res.json();
  if (!res.ok) { alert(detached.error || 'Failed to detach'); return; }
  openEntryModal(detached); // reopen, now editable as a normal manual entry
}

async function deleteEntireSeries(seriesId) {
  if (!seriesId) return;
  if (!confirm('Delete this entire recurring series? This removes every past and future occurrence — not just this one.')) return;
  await fetch(`/api/recurring-series/${seriesId}`, { method: 'DELETE' });
  closeEntryModal();
  apptRefreshAfterEntryChange();
}

function sourceLabel(source) {
  if (source === 'google') return 'Google Calendar Event';
  if (source === 'medtracker') return 'Appointment (from Med & Appointment Tracker)';
  return 'Entry';
}

function closeEntryModal() {
  document.getElementById('entryModal').classList.add('hidden');
}

async function saveEntry(e) {
  e.preventDefault();
  const id = document.getElementById('entryId').value;
  const repeats = id ? '' : document.getElementById('entryRepeats').value;

  if (repeats) {
    const payload = {
      title: document.getElementById('entryTitle').value,
      notes: document.getElementById('entryNotes').value,
      color: document.getElementById('entryColor').value,
      recurrence_type: repeats,
      interval_count: parseInt(document.getElementById('entryRepeatsInterval').value) || 1,
      anchor_date: document.getElementById('entryDate').value,
      start_time: document.getElementById('entryStart').value || null,
      end_time: document.getElementById('entryEnd').value || null,
      until_date: document.getElementById('entryRepeatsUntil').value || null
    };
    if (repeats === 'monthly') {
      const mode = document.getElementById('monthlyPatternMode').value;
      payload.monthly_mode = mode;
      if (mode === 'nth_weekday') {
        payload.nth_week = parseInt(document.getElementById('nthWeekOrdinal').value);
        payload.nth_weekday_dow = parseInt(document.getElementById('nthWeekdayDow').value);
      }
    }
    const res = await fetch('/api/recurring-series', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to create recurring event'); return; }
    closeEntryModal();
    apptRefreshAfterEntryChange();
    return;
  }

  const payload = {
    entry_date: document.getElementById('entryDate').value,
    title: document.getElementById('entryTitle').value,
    start_time: document.getElementById('entryStart').value || null,
    end_time: document.getElementById('entryEnd').value || null,
    notes: document.getElementById('entryNotes').value,
    color: document.getElementById('entryColor').value
  };

  if (id) {
    await fetch(`/api/day-entries/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } else {
    await fetch('/api/day-entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  closeEntryModal();
  apptRefreshAfterEntryChange();
}

function apptRefreshAfterEntryChange() {
  loadDayView();
  if (currentView === 'month') loadMonthView();
}

async function deleteEntry() {
  const id = document.getElementById('entryId').value;
  if (!id) return;
  if (!confirm('Delete this entry?')) return;
  await fetch(`/api/day-entries/${id}`, { method: 'DELETE' });
  closeEntryModal();
  apptRefreshAfterEntryChange();
}

// ================================================================
// MONTH VIEW
// ================================================================
function bindMonthView() {
  document.getElementById('prevMonthBtn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => shiftMonth(1));
}

function shiftMonth(delta) {
  currentMonthDate.setMonth(currentMonthDate.getMonth() + delta);
  loadMonthView();
}

async function loadMonthView() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  document.getElementById('monthLabel').textContent = currentMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  const startStr = dateToStr(gridStart);
  const endStr = dateToStr(gridEnd);
  const [entriesRes, blocksRes] = await Promise.all([
    fetch(`/api/day-entries?start=${startStr}&end=${endStr}`),
    fetch(`/api/weekly-blocks?start=${getWeekStart(startStr)}&end=${endStr}`)
  ]);
  const entries = await entriesRes.json();
  const allBlocks = await blocksRes.json();
  const entriesByDate = {};
  entries.forEach(e => {
    if (!entriesByDate[e.entry_date]) entriesByDate[e.entry_date] = [];
    entriesByDate[e.entry_date].push(e);
  });

  // Expand each weekly block to its actual calendar date (same math used
  // elsewhere: week_start is a Monday, day_of_week is 0=Sun..6=Sat) and merge
  // it into the same per-day list the dots/titles render from.
  allBlocks.forEach(b => {
    const weekStartDate = new Date(b.week_start + 'T00:00:00');
    const offset = b.day_of_week === 0 ? 6 : b.day_of_week - 1;
    const blockDate = new Date(weekStartDate);
    blockDate.setDate(blockDate.getDate() + offset);
    const blockDateStr = dateToStr(blockDate);
    if (!entriesByDate[blockDateStr]) entriesByDate[blockDateStr] = [];
    entriesByDate[blockDateStr].push({ title: b.label, color: b.color });
  });

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = dayNames.map(d => `<div class="month-day-header">${d}</div>`).join('');

  const cursor = new Date(gridStart);
  const today = todayStr();
  while (cursor <= gridEnd) {
    const dStr = dateToStr(cursor);
    const isOtherMonth = cursor.getMonth() !== month;
    const isToday = dStr === today;
    const dayEntries = entriesByDate[dStr] || [];
    const visible = dayEntries.slice(0, 3);
    const remaining = dayEntries.length - visible.length;
    const eventsHtml = visible.map(e => `
      <div class="month-day-event" title="${escapeHtml(e.title)}">
        <span class="month-day-dot" style="background:${e.color || '#2e7d32'}"></span>
        <span>${escapeHtml(e.title)}</span>
      </div>
    `).join('') + (remaining > 0 ? `<div class="month-day-more">+${remaining} more</div>` : '');

    html += `
      <div class="month-day ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dStr}">
        <div class="month-day-num">${cursor.getDate()}</div>
        <div class="month-day-dots">${eventsHtml}</div>
      </div>
    `;
    cursor.setDate(cursor.getDate() + 1);
  }

  document.getElementById('monthGrid').innerHTML = html;
  document.querySelectorAll('.month-day').forEach(el => {
    el.addEventListener('click', () => {
      currentDate = el.dataset.date;
      document.querySelector('.view-tab-btn[data-view="day"]').click();
    });
  });
}

// ================================================================
// WEEKLY BLOCKS EDITOR
// ================================================================
let weekModalWeekStart = null;

function bindWeekModal() {
  document.getElementById('closeWeekModalBtn').addEventListener('click', closeWeekModal);
  document.getElementById('closeWeekModalBtn2').addEventListener('click', closeWeekModal);
  document.getElementById('weekModal').addEventListener('click', (e) => { if (e.target.id === 'weekModal') closeWeekModal(); });
  document.getElementById('addBlockForm').addEventListener('submit', addWeekBlock);
  document.getElementById('copyLastWeekBtn').addEventListener('click', copyLastWeek);
}

function openWeekModal(anchorDate) {
  weekModalWeekStart = getWeekStart(anchorDate);
  const weekEnd = new Date(weekModalWeekStart + 'T00:00:00');
  weekEnd.setDate(weekEnd.getDate() + 6);
  document.getElementById('weekModalRange').textContent =
    `${formatShortDate(weekModalWeekStart)} – ${formatShortDate(dateToStr(weekEnd))}`;
  document.getElementById('weekModal').classList.remove('hidden');
  renderWeekBlocks();
}

function closeWeekModal() {
  document.getElementById('weekModal').classList.add('hidden');
  loadDayView(); // reflect any block changes
}

function formatShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function renderWeekBlocks() {
  const res = await fetch(`/api/weekly-blocks?week_start=${weekModalWeekStart}`);
  const blocks = await res.json();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const order = [1, 2, 3, 4, 5, 6, 0]; // Monday-first display

  const container = document.getElementById('weekBlocksByDay');
  container.innerHTML = order.map(dow => {
    const dayBlocks = blocks.filter(b => b.day_of_week === dow);
    return `
      <div class="week-day-group">
        <div class="week-day-title">${dayNames[dow]}</div>
        ${dayBlocks.length ? dayBlocks.map(b => `
          <div class="week-block-item" style="background:${b.color}">
            <span>${escapeHtml(b.label)} — ${formatTime(b.start_time)} to ${formatTime(b.end_time)}</span>
            <button class="week-block-remove" data-id="${b.id}">&times;</button>
          </div>
        `).join('') : '<div class="muted-text" style="font-size:0.8rem;">No blocks</div>'}
      </div>
    `;
  }).join('');

  container.querySelectorAll('.week-block-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/weekly-blocks/${btn.dataset.id}`, { method: 'DELETE' });
      renderWeekBlocks();
    });
  });
}

async function addWeekBlock(e) {
  e.preventDefault();
  const payload = {
    week_start: weekModalWeekStart,
    day_of_week: parseInt(document.getElementById('blockDay').value),
    label: document.getElementById('blockLabel').value,
    start_time: document.getElementById('blockStart').value,
    end_time: document.getElementById('blockEnd').value,
    color: document.getElementById('blockColor').value
  };
  if (!payload.label || !payload.start_time || !payload.end_time) {
    alert('Label, start time, and end time are required.');
    return;
  }
  await fetch('/api/weekly-blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  document.getElementById('addBlockForm').reset();
  renderWeekBlocks();
}

async function copyLastWeek() {
  const lastWeek = new Date(weekModalWeekStart + 'T00:00:00');
  lastWeek.setDate(lastWeek.getDate() - 7);
  const fromWeek = dateToStr(lastWeek);
  const res = await fetch('/api/weekly-blocks/copy-from', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_week: fromWeek, to_week: weekModalWeekStart })
  });
  const data = await res.json();
  alert(data.copied ? `Copied ${data.copied} block(s) from last week.` : 'No blocks found in last week to copy.');
  renderWeekBlocks();
}

// ================================================================
// SINGLE BLOCK EDIT (click a weekly block directly in the timeline)
// ================================================================
function bindBlockEditModal() {
  document.getElementById('closeBlockEditModalBtn').addEventListener('click', closeBlockEditModal);
  document.getElementById('blockEditModal').addEventListener('click', (e) => { if (e.target.id === 'blockEditModal') closeBlockEditModal(); });
  document.getElementById('blockEditForm').addEventListener('submit', saveBlockEdit);
  document.getElementById('deleteBlockEditBtn').addEventListener('click', deleteBlockEdit);
}

function openBlockEditModal(block) {
  document.getElementById('blockEditId').value = block.id;
  document.getElementById('blockEditLabel').value = block.label;
  document.getElementById('blockEditStart').value = block.start_time;
  document.getElementById('blockEditEnd').value = block.end_time;
  document.getElementById('blockEditColor').value = block.color || '#4a6fa5';
  document.getElementById('blockEditModal').classList.remove('hidden');
}

function closeBlockEditModal() {
  document.getElementById('blockEditModal').classList.add('hidden');
}

async function saveBlockEdit(e) {
  e.preventDefault();
  const id = document.getElementById('blockEditId').value;
  const payload = {
    label: document.getElementById('blockEditLabel').value,
    start_time: document.getElementById('blockEditStart').value,
    end_time: document.getElementById('blockEditEnd').value,
    color: document.getElementById('blockEditColor').value
  };
  await fetch(`/api/weekly-blocks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  closeBlockEditModal();
  loadDayView();
}

async function deleteBlockEdit() {
  const id = document.getElementById('blockEditId').value;
  if (!confirm('Remove this block for this specific day? (This only affects this one day — not the whole week template.)')) return;
  await fetch(`/api/weekly-blocks/${id}`, { method: 'DELETE' });
  closeBlockEditModal();
  loadDayView();
}

// ================================================================
// SETTINGS (Google Calendar + password)
// ================================================================
function bindSettingsModal() {
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('closeSettingsModalBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
  document.getElementById('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') document.getElementById('settingsModal').classList.add('hidden'); });

  document.getElementById('gcalConnectBtn').addEventListener('click', connectGoogleCalendar);
  document.getElementById('gcalSyncBtn').addEventListener('click', syncGoogleCalendar);
  document.getElementById('gcalDisconnectBtn').addEventListener('click', disconnectGoogleCalendar);
  document.getElementById('medtrackerSyncBtn').addEventListener('click', syncMedTracker);
  document.getElementById('icalCopyBtn').addEventListener('click', copyIcalUrl);
  document.getElementById('saveColorsBtn').addEventListener('click', saveTypeColors);

  document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('settingsError');
    const successEl = document.getElementById('settingsSuccess');
    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    if (newPassword !== confirmPassword) {
      errorEl.textContent = 'New password and confirmation do not match.';
      errorEl.classList.remove('hidden');
      return;
    }
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');
      successEl.textContent = 'Password updated successfully.';
      successEl.classList.remove('hidden');
      document.getElementById('changePasswordForm').reset();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  });
}

async function openSettingsModal() {
  document.getElementById('settingsModal').classList.remove('hidden');
  await refreshGoogleStatus();
  await refreshMedTrackerStatus();
  await refreshIcalUrl();
  await loadTypeColors();
  await loadRecurringSeriesList();
}

const DEFAULT_TYPE_COLORS = { therapy: '#2e7d32', dietitian: '#e0a324', doctor: '#4a6fa5', other: '#8e44ad' };

async function loadTypeColors() {
  const res = await fetch('/api/settings/colors');
  const colors = await res.json();
  document.getElementById('colorTherapy').value = colors.therapy || DEFAULT_TYPE_COLORS.therapy;
  document.getElementById('colorDietitian').value = colors.dietitian || DEFAULT_TYPE_COLORS.dietitian;
  document.getElementById('colorDoctor').value = colors.doctor || DEFAULT_TYPE_COLORS.doctor;
  document.getElementById('colorOther').value = colors.other || DEFAULT_TYPE_COLORS.other;
}

async function saveTypeColors() {
  const payload = {
    therapy: document.getElementById('colorTherapy').value,
    dietitian: document.getElementById('colorDietitian').value,
    doctor: document.getElementById('colorDoctor').value,
    other: document.getElementById('colorOther').value
  };
  const btn = document.getElementById('saveColorsBtn');
  const original = btn.textContent;
  await fetch('/api/settings/colors', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  btn.textContent = 'Saved! Click Sync Now to repaint existing appointments.';
  setTimeout(() => { btn.textContent = original; }, 3000);
}

async function loadRecurringSeriesList() {
  const res = await fetch('/api/recurring-series');
  const series = await res.json();
  const container = document.getElementById('recurringSeriesList');

  if (!series.length) {
    container.textContent = 'No recurring events set up yet.';
    return;
  }

  const recurrenceLabels = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
  container.innerHTML = series.map(s => `
    <div class="week-block-item" style="background:${s.color}" data-id="${s.id}">
      <span>${escapeHtml(s.title)} — ${recurrenceLabels[s.recurrence_type]}${s.interval_count > 1 ? ' (every ' + s.interval_count + ')' : ''}</span>
      <button class="week-block-remove" data-id="${s.id}">&times;</button>
    </div>
  `).join('');

  container.querySelectorAll('.week-block-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entire recurring series? This removes all past and future occurrences.')) return;
      await fetch(`/api/recurring-series/${btn.dataset.id}`, { method: 'DELETE' });
      loadRecurringSeriesList();
      apptRefreshAfterEntryChange();
    });
  });
}

async function refreshIcalUrl() {
  const res = await fetch('/api/ical-url');
  const data = await res.json();
  const statusEl = document.getElementById('icalStatus');
  const rowEl = document.getElementById('icalUrlRow');

  if (data.configured) {
    statusEl.textContent = 'Ready to subscribe:';
    document.getElementById('icalUrlField').value = data.url;
    rowEl.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Not configured — set ICAL_FEED_KEY in .env.';
    rowEl.classList.add('hidden');
  }
}

function copyIcalUrl() {
  const field = document.getElementById('icalUrlField');
  field.select();
  navigator.clipboard.writeText(field.value).then(() => {
    const btn = document.getElementById('icalCopyBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

async function refreshMedTrackerStatus() {
  const res = await fetch('/api/medtracker/status');
  const data = await res.json();
  const statusEl = document.getElementById('medtrackerStatus');
  const syncBtn = document.getElementById('medtrackerSyncBtn');

  if (data.configured) {
    statusEl.textContent = `Configured. Last synced: ${data.last_synced_at ? new Date(data.last_synced_at).toLocaleString() : 'never'}.`;
    syncBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Not configured — set MEDTRACKER_API_URL and MEDTRACKER_API_KEY in .env.';
    syncBtn.classList.add('hidden');
  }
}

async function syncMedTracker() {
  const start = todayStr();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 60);
  const end = dateToStr(endDate);

  const btn = document.getElementById('medtrackerSyncBtn');
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/medtracker/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    alert(`Synced ${data.synced} appointment(s).`);
    await refreshMedTrackerStatus();
    loadDayView();
    if (currentView === 'month') loadMonthView();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = 'Sync Now';
    btn.disabled = false;
  }
}

async function refreshGoogleStatus() {
  const res = await fetch('/api/google/status');
  const data = await res.json();
  const statusEl = document.getElementById('gcalStatus');
  const connectBtn = document.getElementById('gcalConnectBtn');
  const syncBtn = document.getElementById('gcalSyncBtn');
  const disconnectBtn = document.getElementById('gcalDisconnectBtn');

  if (data.connected) {
    statusEl.textContent = `Connected. Last synced: ${data.last_synced_at ? new Date(data.last_synced_at).toLocaleString() : 'never'}.`;
    connectBtn.classList.add('hidden');
    syncBtn.classList.remove('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Not connected.';
    connectBtn.classList.remove('hidden');
    syncBtn.classList.add('hidden');
    disconnectBtn.classList.add('hidden');
  }
}

async function connectGoogleCalendar() {
  const res = await fetch('/api/google/connect');
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  window.location.href = data.url;
}

async function syncGoogleCalendar() {
  const start = todayStr();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 60); // sync a rolling 60-day window
  const end = dateToStr(endDate);

  const btn = document.getElementById('gcalSyncBtn');
  btn.textContent = 'Syncing…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/google/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    alert(`Synced ${data.synced} event(s).`);
    await refreshGoogleStatus();
    loadDayView();
    if (currentView === 'month') loadMonthView();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.textContent = 'Sync Now';
    btn.disabled = false;
  }
}

async function disconnectGoogleCalendar() {
  if (!confirm('Disconnect Google Calendar? This removes synced events from your planner (your actual Google Calendar is untouched).')) return;
  await fetch('/api/google/disconnect', { method: 'POST' });
  await refreshGoogleStatus();
  loadDayView();
}

function checkGoogleCalendarReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('calendar') === 'connected') {
    history.replaceState({}, '', '/');
    openSettingsModal();
  } else if (params.get('calendar') === 'error') {
    history.replaceState({}, '', '/');
    alert('Google Calendar connection failed. Please try again.');
  }
}
