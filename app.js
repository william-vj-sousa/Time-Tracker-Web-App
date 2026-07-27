// ─── Config ───────────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://bjiyzsripvxfhbidwybt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqaXl6c3JpcHZ4ZmhiaWR3eWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzY3NTQsImV4cCI6MjA5NjY1Mjc1NH0.MEcG6oHzxhzhvf5KUGl6a6LpH-W4F3X2Hyg4crA4J4M';
// ──────────────────────────────────────────────────────────────────────────

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

let currentUser = null;
let entries     = [];
let authMode    = 'signin';

// ─── Auth state ───────────────────────────────────────────────────────────

// Fallback: if Supabase hangs for 5s, wipe the stale token and reload.
// Supabase-js serializes all auth.* calls (incl. signOut) behind a
// navigator.locks mutex, so if the initial session-refresh call itself
// stalls, calling db.auth.signOut() here would just queue behind the same
// stuck lock and never run. Clearing the storage key directly sidesteps
// the SDK/lock entirely so the next load has nothing stale to refresh.
const loadingTimeout = setTimeout(() => {
  clearStoredSession();
  if (!sessionStorage.getItem('tt-session-reset')) {
    sessionStorage.setItem('tt-session-reset', '1');
    location.reload();
  } else {
    show('screen-auth');
  }
}, 5000);

function clearStoredSession() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    .forEach(k => localStorage.removeItem(k));
}

db.auth.onAuthStateChange(async (event, session) => {
  clearTimeout(loadingTimeout);
  sessionStorage.removeItem('tt-session-reset');
  if (event === 'TOKEN_REFRESH_FAILED') {
    clearStoredSession();
    show('screen-auth');
    return;
  }
  if (session?.user) {
    currentUser = session.user;
    try { entries = await loadEntries(); } catch { entries = []; }
    showLog();
  } else {
    currentUser = null;
    entries = [];
    show('screen-auth');
  }
});

async function signInWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showAuthError(error.message);
}

async function handleAuth() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { showAuthError('Please enter your email and password.'); return; }

  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;

  let error;
  if (authMode === 'signin') {
    ({ error } = await db.auth.signInWithPassword({ email, password }));
  } else {
    ({ error } = await db.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin }
    }));
    if (!error) {
      showNotice('Check your email and click the confirmation link to activate your account.');
      btn.disabled = false;
      return;
    }
  }

  btn.disabled = false;
  if (error) showAuthError(error.message);
}

async function signOut() {
  await db.auth.signOut();
}

function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const isSignin = authMode === 'signin';
  document.getElementById('auth-submit-btn').textContent  = isSignin ? 'Sign in' : 'Sign up';
  document.getElementById('auth-subtitle').textContent    = isSignin ? 'Sign in to track your time.' : 'Create your account.';
  document.getElementById('auth-footer-text').textContent = isSignin ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('auth-toggle-btn').textContent  = isSignin ? 'Sign up' : 'Sign in';
  hideAuthError();
  document.getElementById('auth-notice').style.display = 'none';
}

// ─── Data ─────────────────────────────────────────────────────────────────

async function loadEntries() {
  const { data, error } = await db
    .from('time_entries')
    .select('*')
    .order('date', { ascending: false })
    .order('start_time', { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

async function saveEntry() {
  const date  = document.getElementById('entry-date').value;
  const start = document.getElementById('entry-start').value;
  const end   = document.getElementById('entry-end').value;
  const note  = document.getElementById('entry-note').value.trim();
  const errEl = document.getElementById('entry-error');

  if (!date || !start || !end) {
    errEl.textContent = 'Please fill in date, time in, and time out.';
    errEl.style.display = 'block'; return;
  }
  if (end <= start) {
    errEl.textContent = 'Time out must be after time in.';
    errEl.style.display = 'block'; return;
  }
  errEl.style.display = 'none';

  const btn = document.getElementById('save-btn');
  btn.disabled = true;

  const { data, error } = await db
    .from('time_entries')
    .insert({ user_id: currentUser.id, date, start_time: start, end_time: end, note: note || null })
    .select()
    .single();

  btn.disabled = false;

  if (error) { errEl.textContent = 'Failed to save. Please try again.'; errEl.style.display = 'block'; console.error(error); return; }

  entries.unshift(data);
  document.getElementById('entry-start').value = '';
  document.getElementById('entry-end').value   = '';
  document.getElementById('entry-note').value  = '';
  toggleAddForm();
  populateMonthFilter();
  renderStats();
  renderLog();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const { error } = await db.from('time_entries').delete().eq('id', id);
  if (error) { alert('Failed to delete. Please try again.'); console.error(error); return; }
  entries = entries.filter(e => e.id !== id);
  renderStats();
  populateMonthFilter();
  renderLog();
}

// ─── Display helpers ──────────────────────────────────────────────────────

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLog() {
  show('screen-log');
  const name  = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  const email = currentUser.email;
  document.getElementById('log-avatar').textContent = initials(name);
  document.getElementById('log-name').textContent   = name;
  document.getElementById('log-email').textContent  = email;
  document.getElementById('entry-date').value       = new Date().toISOString().slice(0, 10);
  populateMonthFilter();
  renderStats();
  renderLog();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

function showNotice(msg) {
  const el = document.getElementById('auth-notice');
  el.textContent = msg;
  el.style.display = 'block';
}

function initials(name) {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function calcHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}

function fmtHours(h) {
  if (h <= 0) return '0h';
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (mins === 0) return hrs + 'h';
  if (hrs === 0)  return mins + 'm';
  return hrs + 'h ' + mins + 'm';
}

function renderStats() {
  const now      = new Date();
  const today    = now.toISOString().slice(0, 10);
  const dow      = now.getDay();
  const diff     = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diff);
  const ws       = weekStart.toISOString().slice(0, 10);
  const monthPfx = today.slice(0, 7);
  let todayH = 0, weekH = 0, monthH = 0;
  entries.forEach(e => {
    const h = calcHours(e.start_time, e.end_time);
    if (e.date === today)                              todayH += h;
    if (e.date >= ws && e.date <= today)               weekH  += h;
    if (e.date.startsWith(monthPfx))                  monthH += h;
  });
  document.getElementById('stat-today').textContent = fmtHours(todayH);
  document.getElementById('stat-week').textContent  = fmtHours(weekH);
  document.getElementById('stat-month').textContent = fmtHours(monthH);
}

function populateMonthFilter() {
  const months = [...new Set(entries.map(e => e.date.slice(0, 7)))].sort().reverse();
  const sel    = document.getElementById('filter-month');
  const cur    = sel.value;
  sel.innerHTML = '<option value="">All months</option>' +
    months.map(m => {
      const [y, mo] = m.split('-');
      const label = new Date(+y, +mo - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      return `<option value="${m}"${m === cur ? ' selected' : ''}>${label}</option>`;
    }).join('');
}

function renderLog() {
  const filterMonth = document.getElementById('filter-month').value;
  let filtered = entries.filter(e => !filterMonth || e.date.startsWith(filterMonth));
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.start_time.localeCompare(a.start_time));
  const wrap = document.getElementById('log-table-wrap');
  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty">No entries yet — log your first session above.</div>';
    return;
  }
  const byDate = {};
  filtered.forEach(e => { if (!byDate[e.date]) byDate[e.date] = []; byDate[e.date].push(e); });
  let html = '<table><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th><th></th></tr></thead><tbody>';
  Object.keys(byDate).sort().reverse().forEach(date => {
    const rows     = byDate[date];
    const dayTotal = rows.reduce((s, e) => s + calcHours(e.start_time, e.end_time), 0);
    const d        = new Date(date + 'T12:00:00');
    const label    = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    html += `<tr class="date-group"><td colspan="3" style="padding:8px 10px">${label}</td><td colspan="3"><span class="total-pill">${fmtHours(dayTotal)} total</span></td></tr>`;
    rows.forEach(e => {
      const h = calcHours(e.start_time, e.end_time);
      html += `<tr>
        <td></td>
        <td>${e.start_time.slice(0, 5)}</td>
        <td>${e.end_time.slice(0, 5)}</td>
        <td style="font-weight:500">${fmtHours(h)}</td>
        <td style="color:#888;font-size:13px">${e.note || ''}</td>
        <td><button class="del-btn" onclick="deleteEntry('${e.id}')">✕</button></td>
      </tr>`;
    });
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function toggleAddForm() {
  const f = document.getElementById('add-form');
  f.classList.toggle('open');
  document.getElementById('add-icon').textContent = f.classList.contains('open') ? '−' : '+';
  document.getElementById('entry-error').style.display = 'none';
}
