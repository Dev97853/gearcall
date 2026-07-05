// public/app.js
// Talks to the GearCall backend over fetch(). Token is stored in localStorage
// (this is a real deployed app, not a sandboxed artifact, so localStorage is fine here).

const API = ''; // same-origin
let TOKEN = localStorage.getItem('gearcall_token') || null;
let ME = null; // current user object from /api/me

let selectedVehicle = 'car';
let selectedService = null; // service name string
let servicesCache = { car: [], bike: [] };
let signupRole = 'customer';
let signupSpec = 'car';

/* ---------------- fetch helper ---------------- */
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------------- Auth screen ---------------- */
function setAuthTab(tab) {
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('signup-form').classList.toggle('hidden', tab !== 'signup');
  hideAuthError();
}
function setSignupRole(role) {
  signupRole = role;
  document.getElementById('role-customer').classList.toggle('sel', role === 'customer');
  document.getElementById('role-mechanic').classList.toggle('sel', role === 'mechanic');
  document.getElementById('signup-spec-field').style.display = role === 'mechanic' ? 'block' : 'none';
}
function setSignupSpec(spec) {
  signupSpec = spec;
  ['car', 'bike', 'both'].forEach(s => document.getElementById('spec-' + s).classList.toggle('sel', s === spec));
}
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('show');
}
function hideAuthError() {
  document.getElementById('auth-error').classList.remove('show');
}

async function doLogin() {
  hideAuthError();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showAuthError('Enter both email and password.');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    onAuthSuccess(data);
  } catch (e) {
    showAuthError(e.message);
  }
}

async function doSignup() {
  hideAuthError();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  if (!name || !email || !password) return showAuthError('Fill in all fields.');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');
  try {
    const data = await api('/api/auth/signup', {
      method: 'POST',
      body: { name, email, password, role: signupRole, vehicleSpec: signupRole === 'mechanic' ? signupSpec : undefined },
    });
    onAuthSuccess(data);
  } catch (e) {
    showAuthError(e.message);
  }
}

function onAuthSuccess(data) {
  TOKEN = data.token;
  ME = data.user;
  localStorage.setItem('gearcall_token', TOKEN);
  enterApp();
}

function logout() {
  TOKEN = null; ME = null;
  localStorage.removeItem('gearcall_token');
  document.getElementById('app-main').classList.add('hidden');
  document.getElementById('whoami').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

/* ---------------- Entering the app after login ---------------- */
async function enterApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-main').classList.remove('hidden');
  document.getElementById('whoami').classList.remove('hidden');
  document.getElementById('who-role').textContent = ME.role.toUpperCase() + (ME.vehicleSpec ? ' · ' + ME.vehicleSpec : '');
  document.getElementById('who-name').textContent = ME.name;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  if (ME.role === 'customer') {
    document.getElementById('view-customer').classList.add('active');
    await loadServices();
    await refreshCustomer();
  } else if (ME.role === 'mechanic') {
    document.getElementById('view-mechanic').classList.add('active');
    document.getElementById('mech-online').checked = !!ME.online;
    document.getElementById('mech-spec-label').textContent = 'Specialisation: ' + (ME.vehicleSpec === 'both' ? 'Car & Bike' : ME.vehicleSpec);
    await refreshMechanic();
  } else if (ME.role === 'admin') {
    document.getElementById('view-admin').classList.add('active');
    await refreshAdmin();
  }
}

/* ---------------- Customer ---------------- */
function setVehicle(v) {
  selectedVehicle = v;
  selectedService = null;
  document.getElementById('veh-car').classList.toggle('sel', v === 'car');
  document.getElementById('veh-bike').classList.toggle('sel', v === 'bike');
  document.getElementById('veh-filter-label').textContent = 'Showing: ' + (v === 'car' ? 'Car' : 'Bike');
  renderServiceGrid();
}

async function loadServices() {
  const carData = await api('/api/services?vehicle=car');
  const bikeData = await api('/api/services?vehicle=bike');
  servicesCache.car = carData.services;
  servicesCache.bike = bikeData.services;
  renderServiceGrid();
}

function renderServiceGrid() {
  const grid = document.getElementById('services-grid');
  const select = document.getElementById('cust-service');
  const list = servicesCache[selectedVehicle] || [];
  grid.innerHTML = '';
  select.innerHTML = '<option value="">Select from cards below ↓</option>';
  list.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'svc' + (selectedService === s.name ? ' sel' : '');
    card.innerHTML = `<div class="tag">${s.tag}</div><h4>${s.name}</h4><div class="price">₹${s.price}</div>`;
    card.onclick = () => { selectedService = s.name; document.getElementById('cust-service').value = s.name; renderServiceGrid(); };
    grid.appendChild(card);

    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = `${s.name} — ₹${s.price}`;
    select.appendChild(opt);
  });
  select.value = selectedService || '';
}
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('cust-service');
  if (sel) sel.addEventListener('change', (e) => { selectedService = e.target.value || null; renderServiceGrid(); });
});

async function submitBooking() {
  const loc = document.getElementById('cust-loc').value.trim();
  const slot = document.getElementById('cust-slot').value;
  const notes = document.getElementById('cust-notes').value.trim();
  if (!loc) return showToast('Enter a service location');
  if (!selectedService) return showToast('Pick a service from the list');

  try {
    await api('/api/bookings', { method: 'POST', body: { vehicle: selectedVehicle, serviceName: selectedService, location: loc, slot, notes } });
    document.getElementById('cust-loc').value = '';
    document.getElementById('cust-notes').value = '';
    selectedService = null;
    renderServiceGrid();
    showToast('Job request sent to nearby ' + selectedVehicle + ' mechanics');
    await refreshCustomer();
  } catch (e) {
    showToast(e.message);
  }
}

function statusLabel(s) {
  return { pending: 'Pending', accepted: 'Accepted', done: 'Completed', rejected: 'Declined' }[s] || s;
}

async function refreshCustomer() {
  const data = await api('/api/bookings/mine');
  const bookings = data.bookings;
  document.getElementById('my-bookings-count').textContent = bookings.filter(b => b.status !== 'done').length + ' active';
  const wrap = document.getElementById('my-bookings');
  if (bookings.length === 0) {
    wrap.innerHTML = `<div class="empty"><b>No bookings yet</b>Fill out the job card above to request a mechanic.</div>`;
    return;
  }
  wrap.innerHTML = bookings.map(b => `
    <div class="job-row">
      <div class="jid">GC-${b.id}</div>
      <div><div class="cust">${b.service_name}</div><div class="meta">${b.vehicle === 'car' ? '🚗' : '🏍️'} ${b.location} · ${b.slot}</div></div>
      <div class="meta">${b.mechanic_name ? 'Mechanic: ' + b.mechanic_name : 'Waiting for a mechanic to accept'}</div>
      <div class="meta">₹${b.price}</div>
      <div><span class="badge ${b.status}">${statusLabel(b.status)}</span></div>
    </div>
  `).join('');
}

/* ---------------- Mechanic ---------------- */
async function toggleOnline() {
  const online = document.getElementById('mech-online').checked;
  await api('/api/mechanic/online', { method: 'POST', body: { online } });
  await refreshMechanic();
}

async function refreshMechanic() {
  const online = document.getElementById('mech-online').checked;
  const banner = document.getElementById('mech-pending-banner');
  const reqData = await api('/api/bookings/requests');

  if (reqData.note) {
    banner.innerHTML = `<div class="empty" style="margin-bottom:16px;"><b>Awaiting approval</b>${reqData.note}</div>`;
  } else {
    banner.innerHTML = '';
  }

  const reqWrap = document.getElementById('mech-requests');
  if (!online) {
    reqWrap.innerHTML = `<div class="empty"><b>You're offline</b>Go online to start receiving job requests.</div>`;
  } else if (reqData.bookings.length === 0) {
    reqWrap.innerHTML = `<div class="empty"><b>No requests right now</b>New jobs matching your specialisation will show up here.</div>`;
  } else {
    reqWrap.innerHTML = reqData.bookings.map(b => `
      <div class="job-row">
        <div class="jid">GC-${b.id}</div>
        <div><div class="cust">${b.customer_name}</div><div class="meta">${b.service_name} · ₹${b.price}</div></div>
        <div class="meta">📍 ${b.location}</div>
        <div class="meta">${b.slot}${b.notes ? '<br>“' + b.notes + '”' : ''}</div>
        <div class="row-actions">
          <button class="btn small steel" onclick="mechAction(${b.id},'accept')">Accept</button>
          <button class="btn small oxide" onclick="mechAction(${b.id},'reject')">Decline</button>
        </div>
      </div>
    `).join('');
  }

  const jobsData = await api('/api/bookings/mechanic-jobs');
  const accepted = jobsData.bookings.filter(b => b.status === 'accepted');
  const done = jobsData.bookings.filter(b => b.status === 'done');

  document.getElementById('mech-accepted-count').textContent = accepted.length;
  const accWrap = document.getElementById('mech-accepted');
  if (accepted.length === 0) {
    accWrap.innerHTML = `<div class="empty"><b>Nothing in progress</b>Accepted jobs appear here until marked complete.</div>`;
  } else {
    accWrap.innerHTML = accepted.map(b => `
      <div class="job-row">
        <div class="jid">GC-${b.id}</div>
        <div><div class="cust">${b.customer_name}</div><div class="meta">${b.service_name}</div></div>
        <div class="meta">📍 ${b.location}</div>
        <div class="meta">₹${b.price}</div>
        <div class="row-actions"><button class="btn small" onclick="mechAction(${b.id},'complete')">Mark complete</button></div>
      </div>
    `).join('');
  }

  document.getElementById('mech-jobs-done').textContent = done.length;
  document.getElementById('mech-earnings').textContent = '₹' + done.reduce((s, b) => s + b.price, 0);
}

async function mechAction(id, action) {
  try {
    await api(`/api/bookings/${id}/${action}`, { method: 'POST' });
    showToast(`Job GC-${id} ${action === 'accept' ? 'accepted' : action === 'reject' ? 'declined' : 'marked complete'}`);
    await refreshMechanic();
  } catch (e) {
    showToast(e.message);
    await refreshMechanic();
  }
}

/* ---------------- Admin ---------------- */
async function refreshAdmin() {
  document.getElementById('admin-date').textContent = new Date().toDateString();

  const stats = await api('/api/admin/stats');
  document.getElementById('kpi-total').textContent = stats.total;
  document.getElementById('kpi-pending').textContent = stats.pending;
  document.getElementById('kpi-active').textContent = stats.active;
  document.getElementById('kpi-revenue').textContent = '₹' + stats.revenue;

  const bookingsData = await api('/api/admin/bookings');
  const tbody = document.getElementById('admin-table');
  if (bookingsData.bookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--paper-dim);padding:24px;">No bookings yet.</td></tr>`;
  } else {
    tbody.innerHTML = bookingsData.bookings.map(b => `
      <tr>
        <td class="mono">GC-${b.id}</td>
        <td>${b.customer_name}</td>
        <td>${b.vehicle === 'car' ? '🚗 Car' : '🏍️ Bike'}</td>
        <td>${b.service_name}</td>
        <td>${b.location}</td>
        <td>${b.mechanic_name || '—'}</td>
        <td><span class="badge ${b.status}">${statusLabel(b.status)}</span></td>
      </tr>
    `).join('');
  }

  const mechData = await api('/api/admin/mechanics');
  const pending = mechData.mechanics.filter(m => m.mech_status === 'pending');
  const others = mechData.mechanics.filter(m => m.mech_status !== 'pending');

  document.getElementById('admin-pending-mech-count').textContent = pending.length + ' pending';
  const mechWrap = document.getElementById('admin-mech-approvals');
  if (pending.length === 0) {
    mechWrap.innerHTML = `<div class="empty"><b>All caught up</b>No mechanic applications waiting for review.</div>`;
  } else {
    mechWrap.innerHTML = pending.map(m => `
      <div class="mech-approve-row">
        <div class="who"><b>${m.name}</b><span>${m.vehicle_spec} specialist · ${m.email}</span></div>
        <div class="row-actions">
          <button class="btn small steel" onclick="mechAdminAction(${m.id},'approve')">Approve</button>
          <button class="btn small oxide" onclick="mechAdminAction(${m.id},'reject')">Reject</button>
        </div>
      </div>
    `).join('');
  }

  const mtbody = document.getElementById('admin-mech-table');
  mtbody.innerHTML = others.map(m => `
    <tr>
      <td>${m.name}</td>
      <td>${m.vehicle_spec}</td>
      <td><span class="badge ${m.mech_status === 'approved' ? 'accepted' : 'rejected'}">${m.mech_status}</span></td>
      <td>${m.online ? 'Online' : 'Offline'}</td>
      <td>${m.jobs_done}</td>
    </tr>
  `).join('');
}

async function mechAdminAction(id, action) {
  await api(`/api/admin/mechanics/${id}/${action}`, { method: 'POST' });
  showToast(`Mechanic ${action === 'approve' ? 'approved' : 'rejected'}`);
  await refreshAdmin();
}

/* ---------------- Toast ---------------- */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------------- Boot ---------------- */
(async function boot() {
  setSignupRole('customer');
  setSignupSpec('car');
  setVehicle('car');
  if (TOKEN) {
    try {
      const data = await api('/api/me');
      ME = data.user;
      await enterApp();
    } catch {
      localStorage.removeItem('gearcall_token');
      TOKEN = null;
    }
  }
})();
