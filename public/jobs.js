// Job Search tab. Self-contained; hooks the existing .view-tab-btn clicks.
(function () {
  var jobs = [];
  var today = '';
  var filter = 'open';
  var editingId = null;
  var deleteArmed = false;
  var OPEN = ['saved', 'applied', 'interviewing', 'waiting', 'offer'];
  var FOLLOW = ['applied', 'interviewing', 'waiting', 'offer'];
  var loaded = false;
  var calls = [];
  var editingCallId = null;
  var callDeleteArmed = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function dayNum(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function addDays(s, n) { return new Date((dayNum(s) + n) * 86400000).toISOString().slice(0, 10); }
  function niceDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1] + ' ' + (+p[2]);
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { window.location.href = '/login.html'; throw new Error('Not logged in'); }
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d; });
    });
  }

  function showError(msg) { var e = $('jobsError'); e.textContent = msg || ''; e.classList.toggle('hidden', !msg); }

  function load() {
    return Promise.all([api('GET', '/api/jobs'), api('GET', '/api/jobs/calls/list')]).then(function (r) {
      jobs = r[0].jobs; today = r[0].today; calls = r[1].calls; loaded = true; showError(''); render();
    }).catch(function (e) { showError(e.message); });
  }

  function isDue(j) { return j.next_follow_up && j.next_follow_up <= today && FOLLOW.indexOf(j.status) !== -1; }

  function followChip(j) {
    if (!j.next_follow_up || FOLLOW.indexOf(j.status) === -1) return '';
    var diff = dayNum(j.next_follow_up) - dayNum(today);
    var cls = 'jobs-follow', txt;
    if (diff < 0) { cls += ' overdue'; txt = 'Follow-up overdue (' + niceDate(j.next_follow_up) + ')'; }
    else if (diff === 0) { cls += ' today'; txt = 'Follow up today'; }
    else { txt = 'Follow up ' + niceDate(j.next_follow_up); }
    return '<span class="' + cls + '">' + txt + (j.follow_up_ping ? ' 🔔' : '') + '</span>';
  }

  function renderCalls(q) {
    var list = calls.filter(function (c) {
      if (!q) return true;
      return [c.contact_name, c.company, c.summary, c.next_step].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    var box = $('jobsList');
    if (!list.length) { box.innerHTML = '<p class="muted-text jobs-empty">' + (calls.length ? 'Nothing matches.' : 'No calls logged yet. Tap “Log call” after you talk to someone.') + '</p>'; return; }
    box.innerHTML = list.map(function (c) {
      var step = '';
      if (c.next_step || c.next_step_date) {
        var cls = 'jobs-follow';
        if (c.next_step_done) cls = 'muted-text';
        else if (c.next_step_date && c.next_step_date < today) cls += ' overdue';
        else if (c.next_step_date === today) cls += ' today';
        step = '<span class="' + cls + '">' + (c.next_step_done ? 'Done: ' : 'Next: ') + esc(c.next_step || 'follow up') +
          (c.next_step_date ? ' (' + niceDate(c.next_step_date) + ')' : '') + (c.next_step_ping && !c.next_step_done ? ' 🔔' : '') + '</span>';
      }
      return '<div class="job-card call-card" data-call="' + c.id + '"><div class="job-card-top"><div class="job-card-main">' +
        '<div class="job-company">' + esc(c.contact_name) + '</div>' +
        (c.company ? '<div class="job-role muted-text">' + esc(c.company) + '</div>' : '') + '</div>' +
        '<span class="job-status">' + niceDate(c.call_date) + '</span></div>' +
        (c.summary ? '<div class="call-summary muted-text">' + esc(c.summary.length > 140 ? c.summary.slice(0, 140) + '…' : c.summary) + '</div>' : '') +
        '<div class="job-card-meta">' + step + '</div></div>';
    }).join('');
  }

  function render() {
    var q0 = $('jobsSearch').value.trim().toLowerCase();
    $('callsAddBtn').classList.toggle('hidden', filter !== 'calls');
    $('jobsAddBtn').classList.toggle('hidden', filter === 'calls');
    if (filter === 'calls') return renderCalls(q0);
    var q = $('jobsSearch').value.trim().toLowerCase();
    var list = jobs.filter(function (j) {
      if (filter === 'open' && OPEN.indexOf(j.status) === -1) return false;
      if (filter === 'closed' && OPEN.indexOf(j.status) !== -1) return false;
      if (filter === 'due' && !isDue(j)) return false;
      if (q) {
        var hay = [j.company, j.role, j.notes, j.company_notes, j.source].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    var box = $('jobsList');
    if (!list.length) {
      box.innerHTML = '<p class="muted-text jobs-empty">' + (jobs.length ? 'Nothing matches.' : 'No jobs yet. Tap “Add job” when you apply to one.') + '</p>';
      return;
    }
    box.innerHTML = list.map(function (j) {
      return '<div class="job-card" data-id="' + j.id + '">' +
        '<div class="job-card-top"><div class="job-card-main"><div class="job-company">' + esc(j.company) + '</div>' +
        (j.role ? '<div class="job-role muted-text">' + esc(j.role) + '</div>' : '') + '</div>' +
        '<span class="job-status job-status-' + esc(j.status) + '">' + esc(j.status) + '</span></div>' +
        '<div class="job-card-meta">' + followChip(j) +
        (j.status === 'saved' && j.apply_by ? '<span class="jobs-follow">Apply by ' + niceDate(j.apply_by) + '</span>' : '') +
        (j.applied_date ? '<span class="muted-text">Applied ' + niceDate(j.applied_date) + '</span>' : '') +
        (j.pay_range ? '<span class="muted-text">' + esc(j.pay_range) + '</span>' : '') + '</div></div>';
    }).join('');
  }

  function openModal(job) {
    editingId = job ? job.id : null;
    deleteArmed = false;
    var del = $('jobDeleteBtn'); del.textContent = 'Delete'; del.classList.toggle('hidden', !job);
    $('jobModalTitle').textContent = job ? 'Edit job' : 'Add job';
    var j = job || { status: 'applied' };
    $('jobCompany').value = j.company || '';
    $('jobRole').value = j.role || '';
    $('jobStatus').value = j.status;
    $('jobAppliedDate').value = j.applied_date || '';
    $('jobUrl').value = j.url || '';
    $('jobPay').value = j.pay_range || '';
    $('jobSource').value = j.source || '';
    $('jobApplyBy').value = j.apply_by || '';
    $('jobFollowUp').value = j.next_follow_up || '';
    $('jobPing').checked = !!j.follow_up_ping;
    $('jobCompanyNotes').value = j.company_notes || '';
    $('jobNotes').value = j.notes || '';
    $('jobOutcome').value = j.outcome_notes || '';
    $('jobFormError').classList.add('hidden');
    var rel = job ? calls.filter(function (c) { return c.job_id === job.id; }) : [];
    var relEl = $('jobCalls');
    relEl.innerHTML = rel.length ? '<div class="jobs-related-title">Calls for this job</div>' + rel.map(function (c) {
      return '<div class="jobs-related">' + niceDate(c.call_date) + ' — ' + esc(c.contact_name) + (c.next_step ? ': ' + esc(c.next_step) : '') + '</div>';
    }).join('') : '';
    $('jobModal').classList.remove('hidden');
    $('jobCompany').focus();
  }
  function closeModal() { $('jobModal').classList.add('hidden'); editingId = null; }

  function save(ev) {
    ev.preventDefault();
    var body = {
      company: $('jobCompany').value, role: $('jobRole').value, status: $('jobStatus').value,
      applied_date: $('jobAppliedDate').value || null, url: $('jobUrl').value, pay_range: $('jobPay').value,
      source: $('jobSource').value, apply_by: $('jobApplyBy').value || null,
      next_follow_up: $('jobFollowUp').value || null, follow_up_ping: $('jobPing').checked,
      company_notes: $('jobCompanyNotes').value, notes: $('jobNotes').value, outcome_notes: $('jobOutcome').value
    };
    var req = editingId ? api('PUT', '/api/jobs/' + editingId, body) : api('POST', '/api/jobs', body);
    req.then(function () { closeModal(); return load(); }).catch(function (e) {
      var el = $('jobFormError'); el.textContent = e.message; el.classList.remove('hidden');
    });
  }

  // Delete takes two taps (no browser pop-up): first arms, second deletes.
  function del() {
    var btn = $('jobDeleteBtn');
    if (!deleteArmed) { deleteArmed = true; btn.textContent = 'Tap again to delete'; return; }
    api('DELETE', '/api/jobs/' + editingId).then(function () { closeModal(); return load(); }).catch(function (e) {
      var el = $('jobFormError'); el.textContent = e.message; el.classList.remove('hidden');
    });
  }

  // ---- Calls ----
  function openCall(c) {
    editingCallId = c ? c.id : null; callDeleteArmed = false;
    var d = $('callDeleteBtn'); d.textContent = 'Delete'; d.classList.toggle('hidden', !c);
    $('callModalTitle').textContent = c ? 'Edit call' : 'Log call';
    var sel = $('callJob');
    sel.innerHTML = '<option value="">None</option>' + jobs.map(function (j) {
      return '<option value="' + j.id + '">' + esc(j.company + (j.role ? ' — ' + j.role : '')) + '</option>'; }).join('');
    var x = c || { call_date: today };
    $('callContact').value = x.contact_name || ''; $('callCompany').value = x.company || '';
    $('callDate').value = x.call_date || today; $('callPhone').value = x.phone || ''; $('callEmail').value = x.email || '';
    sel.value = x.job_id ? String(x.job_id) : '';
    $('callSummary').value = x.summary || ''; $('callNext').value = x.next_step || '';
    $('callNextDate').value = x.next_step_date || ''; $('callPing').checked = !!x.next_step_ping; $('callDone').checked = !!x.next_step_done;
    $('callFormError').classList.add('hidden');
    $('callModal').classList.remove('hidden'); $('callContact').focus();
  }
  function closeCall() { $('callModal').classList.add('hidden'); editingCallId = null; }
  function callErr(e) { var el = $('callFormError'); el.textContent = e.message; el.classList.remove('hidden'); }
  function saveCall(ev) {
    ev.preventDefault();
    var body = {
      contact_name: $('callContact').value, company: $('callCompany').value, call_date: $('callDate').value || null,
      phone: $('callPhone').value, email: $('callEmail').value, job_id: $('callJob').value || null,
      summary: $('callSummary').value, next_step: $('callNext').value, next_step_date: $('callNextDate').value || null,
      next_step_ping: $('callPing').checked, next_step_done: $('callDone').checked
    };
    var req = editingCallId ? api('PUT', '/api/jobs/calls/list/' + editingCallId, body) : api('POST', '/api/jobs/calls/list', body);
    req.then(function () { closeCall(); return load(); }).catch(callErr);
  }
  function delCall() {
    var b = $('callDeleteBtn');
    if (!callDeleteArmed) { callDeleteArmed = true; b.textContent = 'Tap again to delete'; return; }
    api('DELETE', '/api/jobs/calls/list/' + editingCallId).then(function () { closeCall(); return load(); }).catch(callErr);
  }

  function showTab(btn) {
    var isJobs = btn.dataset.view === 'jobs';
    $('jobsView').classList.toggle('hidden', !isJobs);
    if (isJobs) load();
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.view-tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b); });
    });
    // The existing app.js shows/hides Day and Month only; make sure they hide for Jobs.
    document.querySelector('.view-tab-btn[data-view="jobs"]').addEventListener('click', function () {
      $('dayView').classList.add('hidden'); $('monthView').classList.add('hidden');
    });
    $('jobsAddBtn').addEventListener('click', function () { openModal(null); });
    $('jobsSearch').addEventListener('input', render);
    $('jobsFilters').addEventListener('click', function (e) {
      var b = e.target.closest('.jobs-filter'); if (!b) return;
      filter = b.dataset.filter;
      document.querySelectorAll('.jobs-filter').forEach(function (x) { x.classList.toggle('active', x === b); });
      render();
    });
    $('callsAddBtn').addEventListener('click', function () { openCall(null); });
    $('callModalClose').addEventListener('click', closeCall);
    $('callModal').addEventListener('click', function (e) { if (e.target === $('callModal')) closeCall(); });
    $('callForm').addEventListener('submit', saveCall);
    $('callDeleteBtn').addEventListener('click', delCall);
    $('jobsList').addEventListener('click', function (e) {
      var cc = e.target.closest('.call-card');
      if (cc) { var call = calls.find(function (x) { return String(x.id) === cc.dataset.call; }); if (call) openCall(call); return; }
      var c = e.target.closest('.job-card'); if (!c) return;
      var j = jobs.find(function (x) { return String(x.id) === c.dataset.id; });
      if (j) openModal(j);
    });
    $('jobModalClose').addEventListener('click', closeModal);
    $('jobModal').addEventListener('click', function (e) { if (e.target === $('jobModal')) closeModal(); });
    $('jobForm').addEventListener('submit', save);
    $('jobDeleteBtn').addEventListener('click', del);
    document.querySelectorAll('.jobs-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        var d = c.dataset.days;
        if (d === 'clear') { $('jobFollowUp').value = ''; $('jobPing').checked = false; return; }
        $('jobFollowUp').value = addDays(today || new Date().toISOString().slice(0, 10), +d);
      });
    });
    $('jobStatus').addEventListener('change', function () {
      if (this.value !== 'saved' && !$('jobAppliedDate').value) $('jobAppliedDate').value = today || '';
    });
  });
})();
