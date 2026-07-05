// server.js
// Zero-dependency Node.js backend for GearCall (uses only built-in modules).
// Run with: npm start   (see package.json)
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./lib/db');
const { hashPassword, verifyPassword, createToken, verifyToken } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------- Service catalog (static reference data) ----------------
const SERVICES = {
  car: [
    { tag: 'Repair', name: 'Engine diagnostics', price: 499 },
    { tag: 'Maintenance', name: 'Oil & filter change', price: 899 },
    { tag: 'Repair', name: 'Brake pad replacement', price: 1299 },
    { tag: 'Emergency', name: 'Battery jump-start', price: 349 },
    { tag: 'Emergency', name: 'Flat tyre / puncture', price: 299 },
    { tag: 'Maintenance', name: 'AC gas refill', price: 1599 },
  ],
  bike: [
    { tag: 'Maintenance', name: 'General service', price: 399 },
    { tag: 'Repair', name: 'Chain & sprocket', price: 599 },
    { tag: 'Repair', name: 'Brake adjustment', price: 249 },
    { tag: 'Emergency', name: 'Battery jump-start', price: 199 },
    { tag: 'Emergency', name: 'Flat tyre / puncture', price: 199 },
    { tag: 'Maintenance', name: 'Clutch tuning', price: 449 },
  ],
};

// ---------------- Helpers ----------------
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => {
      chunks += c;
      if (chunks.length > 1e6) req.destroy(); // 1MB guard
    });
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = db.prepare('SELECT id, name, email, role, vehicle_spec, mech_status, online FROM users WHERE id = ?').get(payload.id);
  return user || null;
}

function requireRole(user, res, ...roles) {
  if (!user) {
    sendJSON(res, 401, { error: 'Not authenticated. Please log in.' });
    return false;
  }
  if (!roles.includes(user.role)) {
    sendJSON(res, 403, { error: 'You do not have permission to do that.' });
    return false;
  }
  return true;
}

function publicUser(u) {
  if (!u) return null;
  const { id, name, email, role, vehicle_spec, mech_status, online } = u;
  return { id, name, email, role, vehicleSpec: vehicle_spec, mechStatus: mech_status, online: !!online };
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback to index.html for unknown non-api routes
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, indexData) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------- Route handlers ----------------
async function handleApi(req, res, pathname, query) {
  const method = req.method;

  // ---- AUTH ----
  if (pathname === '/api/auth/signup' && method === 'POST') {
    const body = await readBody(req);
    const { name, email, password, role, vehicleSpec } = body;
    if (!name || !email || !password || !role) return sendJSON(res, 400, { error: 'Name, email, password, and role are required.' });
    if (!['customer', 'mechanic'].includes(role)) return sendJSON(res, 400, { error: 'Role must be customer or mechanic.' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return sendJSON(res, 409, { error: 'An account with this email already exists.' });

    const info = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, vehicle_spec, mech_status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, email.toLowerCase(), hashPassword(password), role,
      role === 'mechanic' ? (vehicleSpec || 'car') : null,
      role === 'mechanic' ? 'pending' : null,
      role === 'mechanic' ? 1 : null
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const token = createToken({ id: user.id, role: user.role });
    return sendJSON(res, 201, { token, user: publicUser(user) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const { email, password } = body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return sendJSON(res, 401, { error: 'Incorrect email or password.' });
    }
    const token = createToken({ id: user.id, role: user.role });
    return sendJSON(res, 200, { token, user: publicUser(user) });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = getAuthUser(req);
    if (!user) return sendJSON(res, 401, { error: 'Not authenticated.' });
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  // ---- SERVICES ----
  if (pathname === '/api/services' && method === 'GET') {
    const vehicle = query.vehicle === 'bike' ? 'bike' : 'car';
    return sendJSON(res, 200, { vehicle, services: SERVICES[vehicle] });
  }

  // ---- BOOKINGS: customer creates ----
  if (pathname === '/api/bookings' && method === 'POST') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'customer')) return;
    const body = await readBody(req);
    const { vehicle, serviceName, location, slot, notes } = body;
    if (!vehicle || !serviceName || !location) return sendJSON(res, 400, { error: 'Vehicle, service, and location are required.' });
    const catalog = SERVICES[vehicle] || [];
    const svc = catalog.find(s => s.name === serviceName);
    if (!svc) return sendJSON(res, 400, { error: 'Unknown service for that vehicle type.' });

    const info = db.prepare(`
      INSERT INTO bookings (customer_id, vehicle, service_name, price, location, slot, notes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(user.id, vehicle, svc.name, svc.price, location, slot || 'As soon as possible', notes || '');

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
    return sendJSON(res, 201, { booking });
  }

  // ---- BOOKINGS: customer's own list ----
  if (pathname === '/api/bookings/mine' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'customer')) return;
    const rows = db.prepare(`
      SELECT b.*, m.name AS mechanic_name FROM bookings b
      LEFT JOIN users m ON m.id = b.mechanic_id
      WHERE b.customer_id = ? ORDER BY b.id DESC
    `).all(user.id);
    return sendJSON(res, 200, { bookings: rows });
  }

  // ---- BOOKINGS: mechanic sees open requests matching their specialisation ----
  if (pathname === '/api/bookings/requests' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'mechanic')) return;
    if (user.mech_status !== 'approved') return sendJSON(res, 200, { bookings: [], note: 'Your mechanic account is awaiting admin approval.' });
    const spec = user.vehicle_spec === 'both' ? null : user.vehicle_spec;
    const rows = spec
      ? db.prepare(`SELECT b.*, c.name AS customer_name FROM bookings b JOIN users c ON c.id=b.customer_id WHERE b.status='pending' AND b.vehicle=? ORDER BY b.id ASC`).all(spec)
      : db.prepare(`SELECT b.*, c.name AS customer_name FROM bookings b JOIN users c ON c.id=b.customer_id WHERE b.status='pending' ORDER BY b.id ASC`).all();
    return sendJSON(res, 200, { bookings: rows });
  }

  // ---- BOOKINGS: mechanic's accepted/completed jobs ----
  if (pathname === '/api/bookings/mechanic-jobs' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'mechanic')) return;
    const rows = db.prepare(`
      SELECT b.*, c.name AS customer_name FROM bookings b
      JOIN users c ON c.id = b.customer_id
      WHERE b.mechanic_id = ? ORDER BY b.id DESC
    `).all(user.id);
    return sendJSON(res, 200, { bookings: rows });
  }

  // ---- BOOKINGS: accept / reject / complete ----
  const bookingActionMatch = pathname.match(/^\/api\/bookings\/(\d+)\/(accept|reject|complete)$/);
  if (bookingActionMatch && method === 'POST') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'mechanic')) return;
    const bookingId = Number(bookingActionMatch[1]);
    const action = bookingActionMatch[2];
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    if (!booking) return sendJSON(res, 404, { error: 'Booking not found.' });

    if (action === 'accept') {
      if (booking.status !== 'pending') return sendJSON(res, 409, { error: 'This job is no longer available.' });
      db.prepare(`UPDATE bookings SET status='accepted', mechanic_id=? WHERE id=?`).run(user.id, bookingId);
    } else if (action === 'reject') {
      if (booking.status !== 'pending') return sendJSON(res, 409, { error: 'This job is no longer available.' });
      db.prepare(`UPDATE bookings SET status='rejected', mechanic_id=? WHERE id=?`).run(user.id, bookingId);
    } else if (action === 'complete') {
      if (booking.mechanic_id !== user.id) return sendJSON(res, 403, { error: 'This is not your job to complete.' });
      db.prepare(`UPDATE bookings SET status='done' WHERE id=?`).run(bookingId);
    }
    const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    return sendJSON(res, 200, { booking: updated });
  }

  // ---- MECHANIC: toggle online/offline ----
  if (pathname === '/api/mechanic/online' && method === 'POST') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'mechanic')) return;
    const body = await readBody(req);
    db.prepare('UPDATE users SET online=? WHERE id=?').run(body.online ? 1 : 0, user.id);
    return sendJSON(res, 200, { online: !!body.online });
  }

  // ---- ADMIN: overview stats ----
  if (pathname === '/api/admin/stats' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'admin')) return;
    const total = db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    const pending = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status='pending'`).get().n;
    const active = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status='accepted'`).get().n;
    const revenue = db.prepare(`SELECT COALESCE(SUM(price),0) r FROM bookings WHERE status='done'`).get().r;
    return sendJSON(res, 200, { total, pending, active, revenue });
  }

  // ---- ADMIN: all bookings ----
  if (pathname === '/api/admin/bookings' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'admin')) return;
    const rows = db.prepare(`
      SELECT b.*, c.name AS customer_name, m.name AS mechanic_name
      FROM bookings b
      JOIN users c ON c.id = b.customer_id
      LEFT JOIN users m ON m.id = b.mechanic_id
      ORDER BY b.id DESC
    `).all();
    return sendJSON(res, 200, { bookings: rows });
  }

  // ---- ADMIN: mechanics list ----
  if (pathname === '/api/admin/mechanics' && method === 'GET') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'admin')) return;
    const rows = db.prepare(`
      SELECT u.id, u.name, u.email, u.vehicle_spec, u.mech_status, u.online,
        (SELECT COUNT(*) FROM bookings b WHERE b.mechanic_id = u.id AND b.status='done') AS jobs_done
      FROM users u WHERE u.role = 'mechanic' ORDER BY u.id DESC
    `).all();
    return sendJSON(res, 200, { mechanics: rows });
  }

  // ---- ADMIN: approve / reject mechanic ----
  const mechActionMatch = pathname.match(/^\/api\/admin\/mechanics\/(\d+)\/(approve|reject)$/);
  if (mechActionMatch && method === 'POST') {
    const user = getAuthUser(req);
    if (!requireRole(user, res, 'admin')) return;
    const mechId = Number(mechActionMatch[1]);
    const action = mechActionMatch[2];
    const mech = db.prepare(`SELECT * FROM users WHERE id=? AND role='mechanic'`).get(mechId);
    if (!mech) return sendJSON(res, 404, { error: 'Mechanic not found.' });
    db.prepare('UPDATE users SET mech_status=? WHERE id=?').run(action === 'approve' ? 'approved' : 'rejected', mechId);
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { error: 'No such API route.' });
}

// ---------------- Server ----------------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, pathname, parsed.query);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: err.message || 'Server error' });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\n  GearCall backend running → http://localhost:${PORT}\n`);
});
