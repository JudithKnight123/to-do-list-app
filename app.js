/* ═══════════════════════════════════════════════════════════════════════════
   Focus — To-Do  |  app.js
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Supabase Init ─────────────────────────────────────────────────────── */
const SUPABASE_URL = 'https://vqepijisxzglztvwvilo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tgxrRQIV0mWJEcX-emUk9A_bpggAgc6';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ─── Category Palette ──────────────────────────────────────────────────── */
const SWATCH_COLORS = [
  { name: 'Sky',    hex: '#5b9cf6', bg: 'rgba(91,156,246,0.12)',  border: 'rgba(91,156,246,0.35)'  },
  { name: 'Violet', hex: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
  { name: 'Rose',   hex: '#f472b6', bg: 'rgba(244,114,182,0.12)', border: 'rgba(244,114,182,0.35)' },
  { name: 'Coral',  hex: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' },
  { name: 'Amber',  hex: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.35)'  },
  { name: 'Sage',   hex: '#4caf7d', bg: 'rgba(76,175,125,0.12)',  border: 'rgba(76,175,125,0.35)'  },
  { name: 'Teal',   hex: '#2dd4bf', bg: 'rgba(45,212,191,0.12)',  border: 'rgba(45,212,191,0.35)'  },
  { name: 'Slate',  hex: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.35)' },
];

const DEFAULT_CATS = [
  { name: 'Work',     color_idx: 0 },
  { name: 'Personal', color_idx: 1 },
  { name: 'Health',   color_idx: 5 },
  { name: 'Errands',  color_idx: 4 },
];

/* ─── In-Memory State ───────────────────────────────────────────────────── */
let currentUser   = null;
let tasks         = [];   // rows from DB: { id, text, done, cat_id, created_at, sort_order }
let categories    = [];   // rows from DB: { id, name, color_idx, created_at }
let filterCatId   = null;
let focusTaskId   = localStorage.getItem('focus_task_id') || null;
let selectedCatId = null;
let newCatColorIdx = 0;
let sheetTaskId   = null;

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function pending(catId = null) {
  return tasks.filter(t => !t.done && (catId === null || t.cat_id === catId));
}
function doneTasks() {
  return tasks.filter(t => t.done);
}
function getFocusTask() {
  return tasks.find(t => t.id === focusTaskId) || null;
}
function getCat(id) {
  return categories.find(c => c.id === id) || null;
}
function getCatColor(id) {
  const cat = getCat(id);
  return cat ? (SWATCH_COLORS[cat.color_idx] || SWATCH_COLORS[0]) : null;
}
function pickRandom(excludeId = null) {
  const pool = pending(filterCatId).filter(t => t.id !== excludeId);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
function saveFocus(id) {
  focusTaskId = id;
  if (id) localStorage.setItem('focus_task_id', id);
  else localStorage.removeItem('focus_task_id');
}
function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* Detects URLs in text and wraps them in <a> tags, leaving everything else as plain escaped text */
function linkifyText(rawText) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return escHtml(rawText).replace(urlRegex,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="task-link">${url}</a>`
  );
}

function catPillHTML(catId) {
  const cat = getCat(catId);
  if (!cat) return '';
  const col = getCatColor(catId);
  return `<span class="cat-pill" style="--cat-color:${col.hex};--cat-bg:${col.bg};--cat-border:${col.border}">
    <span class="cat-dot"></span>${escHtml(cat.name)}
  </span>`;
}
function setLoading(on) {
  document.getElementById('loadingRow').style.display = on ? 'flex' : 'none';
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATABASE SETUP
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Verify tables exist. Supabase's JS client cannot run DDL directly, so we
 * probe each table with a lightweight query. If the table is missing Supabase
 * returns a specific error code (42P01). We then create the table via a
 * stored procedure (db function) that we call through rpc.
 *
 * IMPORTANT: You need to run the one-time SQL below in your Supabase SQL
 * editor (Dashboard → SQL Editor) to create the setup function and enable RLS.
 * The app will check for the tables on every login and remind you if they are
 * missing.
 *
 * ─── One-time SQL (run once in Supabase SQL Editor) ──────────────────────
 *
 *  -- Enable UUID extension
 *  create extension if not exists "uuid-ossp";
 *
 *  -- Categories table
 *  create table if not exists public.categories (
 *    id         uuid primary key default uuid_generate_v4(),
 *    user_id    uuid not null references auth.users(id) on delete cascade,
 *    name       text not null,
 *    color_idx  int  not null default 0,
 *    created_at timestamptz not null default now()
 *  );
 *  alter table public.categories enable row level security;
 *  create policy "Users manage own categories"
 *    on public.categories for all
 *    using (auth.uid() = user_id)
 *    with check (auth.uid() = user_id);
 *
 *  -- Tasks table
 *  create table if not exists public.tasks (
 *    id         uuid primary key default uuid_generate_v4(),
 *    user_id    uuid not null references auth.users(id) on delete cascade,
 *    text       text not null,
 *    done       boolean not null default false,
 *    cat_id     uuid references public.categories(id) on delete set null,
 *    sort_order bigint not null default extract(epoch from now()) * 1000,
 *    created_at timestamptz not null default now()
 *  );
 *  alter table public.tasks enable row level security;
 *  create policy "Users manage own tasks"
 *    on public.tasks for all
 *    using (auth.uid() = user_id)
 *    with check (auth.uid() = user_id);
 */
async function ensureTablesExist() {
  // Probe tasks table
  const { error } = await sb.from('tasks').select('id').limit(1);
  if (error && error.code === '42P01') {
    // Table missing — show a clear message
    showToast('⚠ Tables not found — see setup instructions in app.js');
    console.error(
      '%cFocus App — First-Time Setup Required\n\n' +
      'Your Supabase tables do not exist yet.\n' +
      'Copy the SQL block from app.js (search for "One-time SQL") and run it\n' +
      'in your Supabase Dashboard → SQL Editor, then reload the page.',
      'color:#f5a623;font-size:13px'
    );
    return false;
  }
  return true;
}

/* ─── Seed default categories for a brand-new user ─────────────────────── */
async function seedDefaultCategories() {
  const { data } = await sb
    .from('categories')
    .select('id')
    .eq('user_id', currentUser.id)
    .limit(1);
  if (data && data.length === 0) {
    const rows = DEFAULT_CATS.map(c => ({
      user_id:   currentUser.id,
      name:      c.name,
      color_idx: c.color_idx,
    }));
    await sb.from('categories').insert(rows);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA FETCHING
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadData() {
  setLoading(true);
  const [catRes, taskRes] = await Promise.all([
    sb.from('categories')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true }),
    sb.from('tasks')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('sort_order', { ascending: false }),
  ]);
  if (catRes.error)  console.error('Categories load error:', catRes.error);
  if (taskRes.error) console.error('Tasks load error:', taskRes.error);
  categories = catRes.data  || [];
  tasks      = taskRes.data || [];

  // Validate focusTaskId still exists and isn't done
  const ft = getFocusTask();
  if (!ft || ft.done) saveFocus(null);

  setLoading(false);
  render();
  automagicNudge();
}

/* ═══════════════════════════════════════════════════════════════════════════
   CRUD — TASKS
   ═══════════════════════════════════════════════════════════════════════════ */
async function addTask(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const row = {
    user_id:    currentUser.id,
    text:       trimmed,
    done:       false,
    cat_id:     selectedCatId || null,
    sort_order: Date.now(),
  };

  const { data, error } = await sb.from('tasks').insert(row).select().single();
  if (error) { showToast('Could not add task'); console.error(error); return; }

  tasks.unshift(data);
  render();
  showToast('Task added');
}

async function markDone(id) {
  const { error } = await sb.from('tasks').update({ done: true }).eq('id', id);
  if (error) { showToast('Could not update task'); console.error(error); return; }

  const task = tasks.find(t => t.id === id);
  if (task) task.done = true;

  if (focusTaskId === id) {
    saveFocus(null);
    showToast('Focus task done! 🎉');
  } else {
    showToast('Task done!');
  }
  render();
}

async function unmarkDone(id) {
  const { error } = await sb.from('tasks').update({ done: false }).eq('id', id);
  if (error) { showToast('Could not update task'); console.error(error); return; }
  const task = tasks.find(t => t.id === id);
  if (task) task.done = false;
  render();
}

async function editTask(id, newText) {
  const trimmed = newText.trim();
  if (!trimmed) return;
  const { error } = await sb.from('tasks').update({ text: trimmed }).eq('id', id);
  if (error) { showToast('Could not save edit'); console.error(error); return; }
  const task = tasks.find(t => t.id === id);
  if (task) task.text = trimmed;
  if (focusTaskId === id) {
    document.getElementById('focusTaskText').innerHTML = linkifyText(trimmed);
  }
  render();
  showToast('Task updated');
}

async function deleteTask(id) {
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) { showToast('Could not delete task'); console.error(error); return; }
  tasks = tasks.filter(t => t.id !== id);
  if (focusTaskId === id) saveFocus(null);
  render();
  showToast('Task removed');
}

/* ═══════════════════════════════════════════════════════════════════════════
   CRUD — CATEGORIES
   ═══════════════════════════════════════════════════════════════════════════ */
async function addCategory(name, colorIdx) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
    showToast('That category already exists');
    return false;
  }

  const row = { user_id: currentUser.id, name: trimmed, color_idx: colorIdx };
  const { data, error } = await sb.from('categories').insert(row).select().single();
  if (error) { showToast('Could not add category'); console.error(error); return false; }

  categories.push(data);
  selectedCatId = data.id;
  render();
  showToast(`Category "${trimmed}" added`);
  return true;
}

async function deleteCategory(id) {
  const cat = getCat(id);
  if (!cat) return;

  // Nullify cat_id on affected tasks (DB cascades to null, but update local state too)
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) { showToast('Could not delete category'); console.error(error); return; }

  tasks.forEach(t => { if (t.cat_id === id) t.cat_id = null; });
  categories = categories.filter(c => c.id !== id);
  if (filterCatId === id)   filterCatId   = null;
  if (selectedCatId === id) selectedCatId = null;

  render();
  showToast(`"${cat.name}" removed`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   FOCUS LOGIC
   ═══════════════════════════════════════════════════════════════════════════ */
function setFocus(id) { saveFocus(id); render(); }
function clearFocus()  { saveFocus(null); render(); }

function surpriseMe() {
  const task = pickRandom();
  if (!task) { showToast('Add some tasks first!'); return; }
  setFocus(task.id);
  showToast(`Let's do: "${truncate(task.text, 38)}"`);
}

function reroll() {
  const task = pickRandom(focusTaskId);
  if (!task) { showToast('No other tasks to pick from!'); return; }
  setFocus(task.id);
  showToast('Picked a different one ↺');
}

function automagicNudge() {
  if (focusTaskId) return;
  if (pending().length === 0) return;
  setTimeout(() => {
    const task = pickRandom();
    if (!task) return;
    setFocus(task.id);
    showToast("Here's a suggestion to start with ✦");
  }, 700);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTION SHEET
   ═══════════════════════════════════════════════════════════════════════════ */
function openSheet(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  sheetTaskId = id;
  document.getElementById('sheetTaskName').textContent = truncate(task.text, 60);
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('actionSheet').classList.add('open');
  document.getElementById('sheetCancelBtn').focus();
}
function closeSheet() {
  sheetTaskId = null;
  document.getElementById('sheetBackdrop').classList.remove('open');
  document.getElementById('actionSheet').classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════════════════════
   INLINE EDIT
   ═══════════════════════════════════════════════════════════════════════════ */
function startEdit(id) {
  closeSheet();
  const li = document.querySelector(`#taskList [data-id="${id}"]`);
  if (!li) return;
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  li.classList.add('is-editing');
  const labelSpan = li.querySelector('.task-label');

  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'task-edit-input';
  input.value     = task.text;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Edit task text');
  li.replaceChild(input, labelSpan);
  input.focus();
  input.select();

  let committed = false;
  function commit() {
    if (committed) return;
    committed = true;
    const newText = input.value.trim();
    if (newText && newText !== task.text) {
      editTask(id, newText);
    } else {
      render(); // just re-render to restore span
    }
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); committed = true; render(); }
  });
  input.addEventListener('blur', commit);
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════════════ */
function render() {
  renderFocus();
  renderCatSelectPills();
  renderFilterBar();
  renderList();
  renderDone();
  renderManageCats();
}

function renderFocus() {
  const card      = document.getElementById('focusCard');
  const focusText = document.getElementById('focusTaskText');
  const focusPill = document.getElementById('focusCatPill');
  const surpriseBtn = document.getElementById('surpriseMeBtn');
  const task = getFocusTask();

  if (task && !task.done) {
    card.classList.add('has-task');
    focusText.innerHTML = linkifyText(task.text);
    focusPill.innerHTML = task.cat_id ? catPillHTML(task.cat_id) : '';
  } else {
    if (focusTaskId) saveFocus(null);
    card.classList.remove('has-task');
  }
  surpriseBtn.disabled = pending(filterCatId).length === 0;
}

function renderCatSelectPills() {
  const container = document.getElementById('catSelectPills');
  container.innerHTML = '';

  const noneBtn = document.createElement('button');
  noneBtn.className = 'cat-select-btn' + (selectedCatId === null ? ' selected' : '');
  noneBtn.textContent = 'None';
  noneBtn.style.setProperty('--cat-color', 'var(--text-muted)');
  noneBtn.style.setProperty('--cat-bg',    'var(--surface-2)');
  noneBtn.addEventListener('click', () => { selectedCatId = null; renderCatSelectPills(); });
  container.appendChild(noneBtn);

  categories.forEach(cat => {
    const col = SWATCH_COLORS[cat.color_idx];
    const btn = document.createElement('button');
    btn.className = 'cat-select-btn' + (selectedCatId === cat.id ? ' selected' : '');
    btn.textContent = cat.name;
    btn.style.setProperty('--cat-color', col.hex);
    btn.style.setProperty('--cat-bg',    col.bg);
    btn.addEventListener('click', () => {
      selectedCatId = cat.id;
      document.getElementById('newCatRow').classList.remove('visible');
      renderCatSelectPills();
    });
    container.appendChild(btn);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'cat-select-btn';
  addBtn.textContent = '+ New';
  addBtn.addEventListener('click', () => {
    document.getElementById('newCatRow').classList.add('visible');
    document.getElementById('newCatInput').focus();
    renderColorSwatches();
  });
  container.appendChild(addBtn);
}

function renderColorSwatches() {
  const container = document.getElementById('colorSwatches');
  container.innerHTML = '';
  SWATCH_COLORS.forEach((col, idx) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (newCatColorIdx === idx ? ' selected' : '');
    btn.style.background = col.hex;
    btn.title = col.name;
    btn.setAttribute('aria-label', col.name);
    btn.addEventListener('click', () => { newCatColorIdx = idx; renderColorSwatches(); });
    container.appendChild(btn);
  });
}

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  bar.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'filter-btn' + (filterCatId === null ? ' active-all' : '');
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => { filterCatId = null; render(); });
  bar.appendChild(allBtn);

  categories.forEach(cat => {
    const col   = SWATCH_COLORS[cat.color_idx];
    const count = pending(cat.id).length;
    if (count === 0 && filterCatId !== cat.id) return;

    const btn = document.createElement('button');
    btn.className = 'filter-btn' + (filterCatId === cat.id ? ' active-cat' : '');
    btn.style.setProperty('--cat-color', col.hex);
    btn.style.setProperty('--cat-bg',    col.bg);
    btn.innerHTML = `${escHtml(cat.name)} <span style="opacity:0.65;font-weight:400">${count}</span>`;
    btn.addEventListener('click', () => {
      filterCatId = (filterCatId === cat.id) ? null : cat.id;
      render();
    });
    bar.appendChild(btn);
  });
}

function renderList() {
  const list    = document.getElementById('taskList');
  const countEl = document.getElementById('pendingCount');
  const titleEl = document.getElementById('listTitle');
  const hasFocus = !!getFocusTask();
  const taskSet  = pending(filterCatId);

  list.innerHTML = '';
  list.classList.toggle('is-dimmed', hasFocus);

  titleEl.textContent = filterCatId
    ? (getCat(filterCatId)?.name || 'Up next')
    : 'Up next';
  countEl.textContent = taskSet.length === 1 ? '1 task' : `${taskSet.length} tasks`;

  if (taskSet.length === 0) {
    const msg = filterCatId
      ? 'No tasks in this category yet.'
      : 'Nothing here yet.<br>Add something to get started.';
    list.innerHTML = `<li class="list-empty"><span class="empty-icon" aria-hidden="true">✦</span>${msg}</li>`;
    return;
  }

  taskSet.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.id === focusTaskId ? ' is-focused' : '');
    li.dataset.id = task.id;
    if (task.cat_id) {
      const col = getCatColor(task.cat_id);
      if (col) li.style.setProperty('--task-cat-color', col.hex);
    }

    li.innerHTML = `
      <input type="checkbox" class="task-check" aria-label="Mark as done" />
      <span class="task-label">${linkifyText(task.text)}</span>
      <div class="task-right">
        ${task.cat_id ? catPillHTML(task.cat_id) : ''}
        <button class="task-menu-btn" aria-label="Task options">···</button>
      </div>
    `;
    li.querySelector('.task-check').addEventListener('change', () => markDone(task.id));
    li.querySelector('.task-menu-btn').addEventListener('click', () => openSheet(task.id));
    list.appendChild(li);
  });
}

function renderDone() {
  const section = document.getElementById('doneSection');
  const list    = document.getElementById('doneList');
  const countEl = document.getElementById('doneCount');
  const doneSet = doneTasks();

  countEl.textContent = doneSet.length;
  if (doneSet.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';

  doneSet.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item is-done';
    li.dataset.id = task.id;
    if (task.cat_id) {
      const col = getCatColor(task.cat_id);
      if (col) li.style.setProperty('--task-cat-color', col.hex);
    }
    li.innerHTML = `
      <input type="checkbox" class="task-check" checked aria-label="Mark as not done" />
      <span class="task-label">${linkifyText(task.text)}</span>
      <div class="task-right">
        ${task.cat_id ? catPillHTML(task.cat_id) : ''}
        <button class="task-menu-btn" aria-label="Task options">···</button>
      </div>
    `;
    li.querySelector('.task-check').addEventListener('change', () => unmarkDone(task.id));
    li.querySelector('.task-menu-btn').addEventListener('click', () => openSheet(task.id));
    list.appendChild(li);
  });
}

function renderManageCats() {
  const body = document.getElementById('manageCatsBody');
  body.innerHTML = '';

  if (categories.length === 0) {
    body.innerHTML = '<p style="font-size:0.82rem;color:var(--text-muted)">No categories yet.</p>';
    return;
  }
  categories.forEach(cat => {
    const col       = SWATCH_COLORS[cat.color_idx];
    const taskCount = tasks.filter(t => t.cat_id === cat.id).length;
    const div = document.createElement('div');
    div.className = 'cat-manage-item';
    div.innerHTML = `
      <span class="cat-manage-swatch" style="background:${col.hex}"></span>
      <span class="cat-manage-name">${escHtml(cat.name)}</span>
      <span class="cat-manage-count">${taskCount} task${taskCount !== 1 ? 's' : ''}</span>
      <button class="cat-manage-delete" aria-label="Delete ${escHtml(cat.name)}">✕</button>
    `;
    div.querySelector('.cat-manage-delete').addEventListener('click', () => deleteCategory(cat.id));
    body.appendChild(div);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════════════════════════ */
function showApp(user) {
  currentUser = user;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appRoot').style.display      = 'block';
  document.getElementById('dateDisplay').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  renderColorSwatches();
  ensureTablesExist().then(ok => {
    if (!ok) return;
    seedDefaultCategories().then(() => loadData());
  });
}

function showLogin() {
  currentUser = null;
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appRoot').style.display      = 'none';
  showLoginStep(1);
}

function showLoginStep(step) {
  document.getElementById('loginStep1').style.display = step === 1 ? 'flex' : 'none';
  document.getElementById('loginStep2').style.display = step === 2 ? 'flex' : 'none';
  document.getElementById('loginError').style.display = 'none';
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT BINDINGS
   ═══════════════════════════════════════════════════════════════════════════ */
function bindEvents() {

  /* ── Login ── */
  const sendOtpBtn = document.getElementById('sendOtpBtn');
  const emailInput = document.getElementById('loginEmail');

  sendOtpBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) { showLoginError('Please enter your email address.'); return; }

    sendOtpBtn.disabled    = true;
    sendOtpBtn.textContent = 'Sending…';

    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });

    sendOtpBtn.disabled    = false;
    sendOtpBtn.textContent = 'Send magic link';

    if (error) {
      showLoginError(error.message || 'Something went wrong. Please try again.');
    } else {
      document.getElementById('loginEmailDisplay').textContent = email;
      showLoginStep(2);
    }
  });

  emailInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendOtpBtn.click();
  });

  document.getElementById('loginBackBtn').addEventListener('click', () => showLoginStep(1));

  /* ── Sign Out ── */
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    showLogin();
  });

  /* ── Add Task ── */
  const taskInput = document.getElementById('taskInput');
  document.getElementById('addTaskBtn').addEventListener('click', () => {
    addTask(taskInput.value);
    taskInput.value = '';
    taskInput.focus();
  });
  taskInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      addTask(taskInput.value);
      taskInput.value = '';
    }
  });

  /* ── Focus Card ── */
  document.getElementById('surpriseMeBtn').addEventListener('click', surpriseMe);
  document.getElementById('rerollBtn').addEventListener('click', reroll);
  document.getElementById('focusDoneBtn').addEventListener('click', () => {
    if (focusTaskId) markDone(focusTaskId);
  });
  document.getElementById('clearFocusBtn').addEventListener('click', clearFocus);

  /* ── Action Sheet ── */
  document.getElementById('sheetEditBtn').addEventListener('click', () => {
    if (sheetTaskId) startEdit(sheetTaskId);
  });
  document.getElementById('sheetDeleteBtn').addEventListener('click', () => {
    if (sheetTaskId) { deleteTask(sheetTaskId); closeSheet(); }
  });
  document.getElementById('sheetCancelBtn').addEventListener('click', closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  /* ── New Category ── */
  document.getElementById('saveCatBtn').addEventListener('click', async () => {
    const val = document.getElementById('newCatInput').value;
    const ok  = await addCategory(val, newCatColorIdx);
    if (ok) {
      document.getElementById('newCatInput').value = '';
      document.getElementById('newCatRow').classList.remove('visible');
    }
  });
  document.getElementById('newCatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  document.getElementById('saveCatBtn').click();
    if (e.key === 'Escape') document.getElementById('cancelCatBtn').click();
  });
  document.getElementById('cancelCatBtn').addEventListener('click', () => {
    document.getElementById('newCatInput').value = '';
    document.getElementById('newCatRow').classList.remove('visible');
  });

  /* ── Done Toggle ── */
  const doneToggle = document.getElementById('doneToggle');
  const doneList   = document.getElementById('doneList');
  doneToggle.addEventListener('click', () => {
    const open = doneList.classList.toggle('visible');
    doneToggle.classList.toggle('open', open);
    doneToggle.setAttribute('aria-expanded', open);
  });

  /* ── Manage Categories Toggle ── */
  const manageToggle = document.getElementById('manageCatsToggle');
  const manageBody   = document.getElementById('manageCatsBody');
  manageToggle.addEventListener('click', () => {
    const open = manageBody.classList.toggle('visible');
    manageToggle.classList.toggle('open', open);
    manageToggle.setAttribute('aria-expanded', open);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════════════════════════════ */
bindEvents();

// Listen for auth state changes (covers magic link callback too)
sb.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    showApp(session.user);
  } else {
    showLogin();
  }
});