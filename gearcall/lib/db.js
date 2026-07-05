// lib/db.js
// Uses Turso (libSQL) — a SQLite-compatible database that's free to host
// permanently. Also works as a plain local SQLite file for local dev
// (no Turso account needed) by simply not setting TURSO_DATABASE_URL.
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// If TURSO_DATABASE_URL is set (production), connect to your hosted Turso DB.
// Otherwise (local dev), fall back to a plain local SQLite file — no cloud
// account required to develop on your machine.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, 'gearcall.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient(authToken ? { url, authToken } : { url });

// ---------------- Small query helpers (keep call-sites tidy) ----------------
async function get(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows[0];
}
async function all(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return rs.rows;
}
async function run(sql, args = []) {
  const rs = await client.execute({ sql, args });
  return { lastInsertRowid: Number(rs.lastInsertRowid), changes: rs.rowsAffected };
}

// ---------------- Schema + migrations + seed ----------------
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init();
  return readyPromise;
}

async function init() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer','mechanic','admin')),
      vehicle_spec TEXT,
      mech_status TEXT DEFAULT 'pending',
      online INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      reset_token_hash TEXT,
      reset_token_expires INTEGER
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      mechanic_id INTEGER,
      vehicle TEXT NOT NULL CHECK(vehicle IN ('car','bike')),
      service_name TEXT NOT NULL,
      price INTEGER NOT NULL,
      location TEXT NOT NULL,
      slot TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(customer_id) REFERENCES users(id),
      FOREIGN KEY(mechanic_id) REFERENCES users(id)
    );
  `);

  // Safe migration for databases created before reset-password existed.
  const cols = await all(`PRAGMA table_info(users)`);
  const names = cols.map(c => c.name);
  if (!names.includes('reset_token_hash')) {
    await client.execute(`ALTER TABLE users ADD COLUMN reset_token_hash TEXT`);
  }
  if (!names.includes('reset_token_expires')) {
    await client.execute(`ALTER TABLE users ADD COLUMN reset_token_expires INTEGER`);
  }

  // Seed demo data only on an empty database.
  const countRow = await get('SELECT COUNT(*) AS n FROM users');
  if (Number(countRow.n) === 0) {
    const insert = `
      INSERT INTO users (name, email, password_hash, role, vehicle_spec, mech_status, online)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await run(insert, ['Platform Admin', 'admin@gearcall.com', hashPassword('admin123'), 'admin', null, null, null]);
    await run(insert, ['Sanjay Verma', 'sanjay@gearcall.com', hashPassword('mech123'), 'mechanic', 'car', 'approved', 1]);
    await run(insert, ['Amit Kumar', 'amit@gearcall.com', hashPassword('mech123'), 'mechanic', 'bike', 'approved', 1]);
    await run(insert, ['Priya Nair', 'priya@gearcall.com', hashPassword('mech123'), 'mechanic', 'both', 'approved', 0]);
    await run(insert, ['Irfan Qureshi', 'irfan@gearcall.com', hashPassword('mech123'), 'mechanic', 'car', 'pending', 1]);
    await run(insert, ['Rohan Sharma', 'rohan@example.com', hashPassword('cust123'), 'customer', null, null, null]);
    console.log('Seeded database with demo admin, mechanics, and a customer.');
    console.log('  Admin login:    admin@gearcall.com / admin123');
    console.log('  Mechanic login: sanjay@gearcall.com / mech123 (car)');
    console.log('  Mechanic login: amit@gearcall.com / mech123 (bike)');
    console.log('  Customer login: rohan@example.com / cust123');
  }
}

module.exports = { client, get, all, run, ready };
