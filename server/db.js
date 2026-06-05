'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'auron.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);

  // Performance & integrity pragmas
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id  TEXT UNIQUE NOT NULL,
      email      TEXT DEFAULT '',
      name       TEXT DEFAULT '',
      phone      TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orgs (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      balance    INTEGER DEFAULT 0,
      status     TEXT DEFAULT 'active',
      icon       TEXT DEFAULT '💵',
      color      TEXT DEFAULT '#10B981',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      uuid        TEXT UNIQUE,
      org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      type        TEXT NOT NULL,
      category    TEXT DEFAULT '',
      amount      INTEGER NOT NULL DEFAULT 0,
      account_id  TEXT DEFAULT '',
      employee    TEXT DEFAULT '',
      comment     TEXT DEFAULT '',
      receipt_url TEXT DEFAULT '',
      shift_id    TEXT DEFAULT '',
      locked      INTEGER DEFAULT 0,
      shift_num   INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id          TEXT PRIMARY KEY,
      org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      shift_num   INTEGER DEFAULT 1,
      cashier     TEXT DEFAULT '',
      z_cash      INTEGER DEFAULT 0,
      z_card      INTEGER DEFAULT 0,
      z_sbp       INTEGER DEFAULT 0,
      z_total     INTEGER DEFAULT 0,
      fact_cash   INTEGER DEFAULT 0,
      fact_card   INTEGER DEFAULT 0,
      fact_sbp    INTEGER DEFAULT 0,
      withdrawals TEXT DEFAULT '[]',
      discrepancy INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS debts (
      id         TEXT PRIMARY KEY,
      org_id     TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      rep_name   TEXT NOT NULL,
      type       TEXT NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 0,
      date       TEXT NOT NULL,
      status     TEXT DEFAULT 'active',
      account_id TEXT DEFAULT '',
      comment    TEXT DEFAULT '',
      invoice    TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trash (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      original_data TEXT NOT NULL,
      deleted_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id     TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      type   TEXT DEFAULT 'expense',
      UNIQUE(org_id, name, type)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id     TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name   TEXT NOT NULL,
      rate   INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      UNIQUE(org_id, name)
    );

    CREATE TABLE IF NOT EXISTS recurring (
      id           TEXT PRIMARY KEY,
      org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      category     TEXT DEFAULT '',
      amount       INTEGER DEFAULT 0,
      account_id   TEXT DEFAULT '',
      day_of_month INTEGER DEFAULT 1,
      active       INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { getDb };
