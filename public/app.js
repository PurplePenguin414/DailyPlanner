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
    const endMin = item.end_time ? timeToMinutesFromStart(item.end_time) : startMin + 30;
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
}

function openEntryModal(entry) {
  const form = document.getElementById('entryForm');
  form.reset();
  const isGoogle = entry && entry.source === 'google';

  document.getElementById('entryId').value = entry ? entry.id : '';
  document.getElementById('entryDate').value = entry ? entry.entry_date : currentDate;
  document.getElementById('entryTitle').value = entry ? entry.title : '';
  document.getElementById('entryStart').value = entry ? (entry.start_time || '') : '';
  document.getElementById('entryEnd').value = entry ? (entry.end_time || '') : '';
  document.getElementById('entryNotes').value = entry ? (entry.notes || '') : '';
  document.getElementById('entryColor').value = entry ? (entry.color || '#2e7d32') : '#2e7d32';

  document.getElementById('entryModalTitle').textContent = entry ? (isGoogle ? 'Google Calendar Event' : 'Edit Entry') : 'New Entry';
  document.getElementById('deleteEntryBtn').classList.toggle('hidden', !entry || isGoogle);

  const saveBtn = form.querySelector('.primary-btn');
  const inputs = form.querySelectorAll('input, textarea');
  inputs.forEach(i => i.disabled = isGoogle);
  saveBtn.classList.toggle('hidden', isGoogle);

  document.getElementById('entryModal').classList.remove('hidden');
}

function closeEntryModal() {
  document.getElementById('entryModal').classList.add('hidden');
}

async function saveEntry(e) {
  e.preventDefault();
  const id = document.getElementById('entryId').value;
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
  loadDayView();
}

async function deleteEntry() {
  const id = document.getElementById('entryId').value;
  if (!id) return;
  if (!confirm('Delete this entry?')) return;
  await fetch(`/api/day-entries/${id}`, { method: 'DELETE' });
  closeEntryModal();
  loadDayView();
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
  const res = await fetch(`/api/day-entries?start=${startStr}&end=${endStr}`);
  const entries = await res.json();
  const entriesByDate = {};
  entries.forEach(e => {
    if (!entriesByDate[e.entry_date]) entriesByDate[e.entry_date] = [];
    entriesByDate[e.entry_date].push(e);
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
    const dots = dayEntries.slice(0, 4).map(e => `<span class="month-day-dot" style="background:${e.color || '#2e7d32'}"></span>`).join('');

    html += `
      <div class="month-day ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dStr}">
        <div class="month-day-num">${cursor.getDate()}</div>
        <div class="month-day-dots">${dots}</div>
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
// SETTINGS (Google Calendar + password)
// ================================================================
function bindSettingsModal() {
  document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
  document.getElementById('closeSettingsModalBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
  document.getElementById('settingsModal').addEventListener('click', (e) => { if (e.target.id === 'settingsModal') document.getElementById('settingsModal').classList.add('hidden'); });

  document.getElementById('gcalConnectBtn').addEventListener('click', connectGoogleCalendar);
  document.getElementById('gcalSyncBtn').addEventListener('click', syncGoogleCalendar);
  document.getElementById('gcalDisconnectBtn').addEventListener('click', disconnectGoogleCalendar);

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
