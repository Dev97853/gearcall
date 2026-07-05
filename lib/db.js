// lib/db.js
// Uses Node's built-in SQLite (node:sqlite) — no external dependency needed.
// Requires Node.js 22.5+ run with: node --experimental-sqlite (handled in package.json start script for older 22.x)
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'gearcall.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('customer','mechanic','admin')),
    vehicle_spec TEXT,                 -- 'car' | 'bike' | 'both' (mechanics only)
    mech_status TEXT DEFAULT 'pending',-- 'pending' | 'approved' | 'rejected' (mechanics only)
    online INTEGER DEFAULT 1,          -- mechanics only
    created_at TEXT DEFAULT (datetime('now'))
  );

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
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | done
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(customer_id) REFERENCES users(id),
    FOREIGN KEY(mechanic_id) REFERENCES users(id)
  );
`);

// ---- Seed data (only runs once, on an empty database) ----
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, vehicle_spec, mech_status, online)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('Platform Admin', 'admin@gearcall.com', hashPassword('admin123'), 'admin', null, null, null);

  insertUser.run('Sanjay Verma', 'sanjay@gearcall.com', hashPassword('mech123'), 'mechanic', 'car', 'approved', 1);
  insertUser.run('Amit Kumar', 'amit@gearcall.com', hashPassword('mech123'), 'mechanic', 'bike', 'approved', 1);
  insertUser.run('Priya Nair', 'priya@gearcall.com', hashPassword('mech123'), 'mechanic', 'both', 'approved', 0);
  insertUser.run('Irfan Qureshi', 'irfan@gearcall.com', hashPassword('mech123'), 'mechanic', 'car', 'pending', 1);

  insertUser.run('Rohan Sharma', 'rohan@example.com', hashPassword('cust123'), 'customer', null, null, null);

  console.log('Seeded database with demo admin, mechanics, and a customer.');
  console.log('  Admin login:    admin@gearcall.com / admin123');
  console.log('  Mechanic login: sanjay@gearcall.com / mech123 (car)');
  console.log('  Mechanic login: amit@gearcall.com / mech123 (bike)');
  console.log('  Customer login: rohan@example.com / cust123');
}

module.exports = db;
