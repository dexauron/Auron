'use strict';

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const https = require('https');
const path = require('path');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'auron_jwt_secret_CHANGE_IN_PRODUCTION';
const JWT_EXPIRY = '30d';

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function mkJWT(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ __error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.uid = payload.uid;
    next();
  } catch {
    return res.status(401).json({ __error: 'Invalid or expired token' });
  }
}

// ─── Org ownership helper ─────────────────────────────────────────────────────

function getOrgForUser(orgId, userId) {
  return getDb().prepare('SELECT * FROM orgs WHERE id=? AND user_id=?').get(orgId, userId);
}

// ─── Period → SQL date range helper ───────────────────────────────────────────

function periodToRange(period) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);

  if (!period || period === 'month') {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: iso(from), to: iso(to) };
  }
  if (period === 'today') {
    const t = iso(today);
    return { from: t, to: t };
  }
  if (period === 'week') {
    const day = today.getDay(); // 0=Sun
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Mon
    const from = new Date(today.setDate(diff));
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from: iso(from), to: iso(to) };
  }
  if (period === 'year') {
    const from = new Date(today.getFullYear(), 0, 1);
    const to = new Date(today.getFullYear(), 11, 31);
    return { from: iso(from), to: iso(to) };
  }
  if (period && period.startsWith('custom:')) {
    const parts = period.split(':');
    return { from: parts[1], to: parts[2] };
  }
  // fallback: current month
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: iso(from), to: iso(to) };
}

// ─── Account balance update helper ────────────────────────────────────────────
// Amounts are in kopecks. Rules:
//   Расход  → subtract amount from account
//   Доход   → add amount to account
//   Корректировка positive → add; negative → subtract (already signed)

function applyBalanceDelta(db, accountId, type, amount) {
  if (!accountId) return;
  let delta = 0;
  if (type === 'Доход') {
    delta = amount;
  } else if (type === 'Расход') {
    delta = -amount;
  } else if (type === 'Корректировка') {
    delta = amount; // amount is already signed by caller
  }
  if (delta === 0) return;
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, accountId);
}

function reverseBalanceDelta(db, accountId, type, amount) {
  if (!accountId) return;
  // Reverse is the opposite of apply
  let delta = 0;
  if (type === 'Доход') {
    delta = -amount;
  } else if (type === 'Расход') {
    delta = amount;
  } else if (type === 'Корректировка') {
    delta = -amount;
  }
  if (delta === 0) return;
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?').run(delta, accountId);
}

// ─── Google userinfo fetch ─────────────────────────────────────────────────────

function fetchGoogleUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error || json.error_description) {
            reject(new Error(json.error_description || json.error));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ─── Default accounts factory ─────────────────────────────────────────────────

function createDefaultAccounts(db, orgId) {
  const defaults = [
    { name: 'Наличные', icon: '💵', color: '#10B981' },
    { name: 'Карта',    icon: '💳', color: '#6366F1' },
    { name: 'СБП',      icon: '📱', color: '#8B5CF6' },
  ];
  defaults.forEach((acc, idx) => {
    const id = randomUUID();
    db.prepare(`
      INSERT INTO accounts (id, org_id, name, icon, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, orgId, acc.name, acc.icon, acc.color, idx);
  });
}

// ─── Map DB transaction row to API shape ─────────────────────────────────────

function mapTx(row) {
  if (!row) return null;
  return {
    id:         row.id,
    uuid:       row.uuid,
    date:       row.date,
    type:       row.type,
    category:   row.category,
    amount:     row.amount,
    accountId:  row.account_id,
    employee:   row.employee,
    comment:    row.comment,
    receiptUrl: row.receipt_url,
    shiftId:    row.shift_id,
    locked:     row.locked,
    shiftNum:   row.shift_num,
    createdAt:  row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/google
app.post('/api/auth/google', async (req, res) => {
  const { googleToken } = req.body || {};
  if (!googleToken) return res.status(400).json({ __error: 'googleToken required' });

  let profile;
  try {
    profile = await fetchGoogleUserInfo(googleToken);
  } catch (err) {
    return res.status(401).json({ __error: 'Invalid Google token: ' + err.message });
  }

  const googleId = profile.sub;
  if (!googleId) return res.status(401).json({ __error: 'Could not read Google ID' });

  const db = getDb();
  let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  if (!user) {
    const info = db.prepare(`
      INSERT INTO users (google_id, email, name)
      VALUES (?, ?, ?)
    `).run(googleId, profile.email || '', profile.name || '');
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }

  const token = mkJWT(user.id);
  return res.json({ jwt: token, name: user.name, email: user.email });
});

// GET /api/init
app.get('/api/init', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.uid);
  if (!user) return res.status(404).json({ __error: 'User not found' });

  const orgs = db.prepare('SELECT * FROM orgs WHERE user_id = ? ORDER BY created_at ASC').all(req.uid);
  if (!orgs.length) {
    return res.json({ isNew: true });
  }

  return res.json({
    isNew: false,
    profile: { name: user.name, phone: user.phone, email: user.email },
    orgs: orgs.map((o) => ({ id: o.id, name: o.name, ssId: o.id })),
  });
});

// POST /api/register
app.post('/api/register', requireAuth, (req, res) => {
  const { name, phone, orgName } = req.body || {};
  const db = getDb();

  // Update user profile
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(
    name || '',
    phone || '',
    req.uid
  );

  // Check if org already exists for this user
  const existing = db.prepare('SELECT * FROM orgs WHERE user_id = ? LIMIT 1').get(req.uid);
  if (existing) {
    return res.json({ ssId: existing.id, orgName: existing.name });
  }

  // Create org
  const orgId = randomUUID();
  db.prepare('INSERT INTO orgs (id, user_id, name) VALUES (?, ?, ?)').run(
    orgId,
    req.uid,
    orgName || 'Мой магазин'
  );

  // Create 3 default accounts
  createDefaultAccounts(db, orgId);

  return res.json({ ssId: orgId, orgName: orgName || 'Мой магазин' });
});

// POST /api/orgs
app.post('/api/orgs', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ __error: 'name required' });

  const db = getDb();
  const orgId = randomUUID();
  db.prepare('INSERT INTO orgs (id, user_id, name) VALUES (?, ?, ?)').run(orgId, req.uid, name);
  createDefaultAccounts(db, orgId);

  return res.json({ id: orgId, name, ssId: orgId });
});

// DELETE /api/orgs/:orgId
app.delete('/api/orgs/:orgId', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  db.prepare('DELETE FROM orgs WHERE id = ?').run(org.id);
  return res.json({ ok: true });
});

// GET /api/orgs/:orgId/accounts
app.get('/api/orgs/:orgId/accounts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const rows = db.prepare(
    'SELECT * FROM accounts WHERE org_id = ? ORDER BY sort_order ASC, created_at ASC'
  ).all(org.id);

  return res.json(
    rows.map((r) => ({
      id:      r.id,
      name:    r.name,
      balance: r.balance,
      status:  r.status,
      icon:    r.icon,
      color:   r.color,
    }))
  );
});

// POST /api/orgs/:orgId/accounts  (upsert)
app.post('/api/orgs/:orgId/accounts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { id, name, icon, color } = req.body || {};
  if (!name) return res.status(400).json({ __error: 'name required' });

  const accountId = id || randomUUID();

  // Check if exists
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ? AND org_id = ?').get(accountId, org.id);
  if (existing) {
    db.prepare('UPDATE accounts SET name=?, icon=?, color=? WHERE id=?').run(
      name,
      icon || existing.icon,
      color || existing.color,
      accountId
    );
  } else {
    const count = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE org_id = ?').get(org.id);
    db.prepare(`
      INSERT INTO accounts (id, org_id, name, icon, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(accountId, org.id, name, icon || '💵', color || '#10B981', count.c);
  }

  const saved = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  return res.json({
    id:      saved.id,
    name:    saved.name,
    balance: saved.balance,
    status:  saved.status,
    icon:    saved.icon,
    color:   saved.color,
  });
});

// DELETE /api/orgs/:orgId/accounts/:id  (soft archive)
app.delete('/api/orgs/:orgId/accounts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  db.prepare("UPDATE accounts SET status='archived' WHERE id=? AND org_id=?").run(
    req.params.id,
    org.id
  );
  return res.json({ ok: true });
});

// PATCH /api/orgs/:orgId/accounts/:id/visibility
app.patch('/api/orgs/:orgId/accounts/:id/visibility', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { visible } = req.body || {};
  const status = visible === false ? 'hidden' : 'active';
  db.prepare('UPDATE accounts SET status=? WHERE id=? AND org_id=?').run(status, req.params.id, org.id);
  return res.json({ ok: true });
});

// POST /api/orgs/:orgId/accounts/:id/adjust
app.post('/api/orgs/:orgId/accounts/:id/adjust', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { amount, comment, date } = req.body || {};
  const accountId = req.params.id;
  const txId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions (id, uuid, org_id, date, type, category, amount, account_id, comment)
      VALUES (?, ?, ?, ?, 'Корректировка', 'Корректировка', ?, ?, ?)
    `).run(txId, txId, org.id, date || today, amount, accountId, comment || '');

    // For Корректировка the amount is already signed
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND org_id = ?').run(
      amount,
      accountId,
      org.id
    );
  })();

  return res.json({ ok: true });
});

// ─── Transactions ─────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/transactions
app.get('/api/orgs/:orgId/transactions', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { period, from, to, type, search, limit } = req.query;

  let dateFrom, dateTo;
  if (from && to) {
    dateFrom = from;
    dateTo = to;
  } else {
    const range = periodToRange(period);
    dateFrom = range.from;
    dateTo = range.to;
  }

  let sql = 'SELECT * FROM transactions WHERE org_id = ? AND date >= ? AND date <= ?';
  const params = [org.id, dateFrom, dateTo];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (search) {
    sql += ' AND (category LIKE ? OR comment LIKE ? OR employee LIKE ?)';
    const like = '%' + search + '%';
    params.push(like, like, like);
  }

  sql += ' ORDER BY date DESC, created_at DESC';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(limit, 10));
  }

  const rows = db.prepare(sql).all(...params);
  return res.json(rows.map(mapTx));
});

// POST /api/orgs/:orgId/transactions
app.post('/api/orgs/:orgId/transactions', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const {
    uuid, date, type, category, amount, accountId,
    employee, comment, receiptUrl, shiftId, shiftNum,
  } = req.body || {};

  // UUID idempotency
  if (uuid) {
    const existing = db.prepare('SELECT * FROM transactions WHERE uuid = ?').get(uuid);
    if (existing) return res.json(mapTx(existing));
  }

  const txId = randomUUID();
  const uuidVal = uuid || txId;

  db.transaction(() => {
    db.prepare(`
      INSERT INTO transactions
        (id, uuid, org_id, date, type, category, amount, account_id, employee, comment, receipt_url, shift_id, shift_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId, uuidVal, org.id,
      date, type, category || '', amount,
      accountId || '', employee || '', comment || '',
      receiptUrl || '', shiftId || '', shiftNum || 0
    );

    applyBalanceDelta(db, accountId, type, amount);
  })();

  const saved = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  return res.json(mapTx(saved));
});

// PUT /api/orgs/:orgId/transactions/:id
app.put('/api/orgs/:orgId/transactions/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const old = db.prepare('SELECT * FROM transactions WHERE id = ? AND org_id = ?').get(
    req.params.id, org.id
  );
  if (!old) return res.status(404).json({ __error: 'Transaction not found' });

  const {
    date, type, category, amount, accountId,
    employee, comment, receiptUrl, shiftId, shiftNum,
  } = req.body || {};

  db.transaction(() => {
    // Reverse old balance effect
    reverseBalanceDelta(db, old.account_id, old.type, old.amount);

    // Apply new balance effect
    applyBalanceDelta(db, accountId || old.account_id, type || old.type, amount !== undefined ? amount : old.amount);

    db.prepare(`
      UPDATE transactions SET
        date = ?, type = ?, category = ?, amount = ?, account_id = ?,
        employee = ?, comment = ?, receipt_url = ?, shift_id = ?, shift_num = ?
      WHERE id = ?
    `).run(
      date        || old.date,
      type        || old.type,
      category    !== undefined ? category    : old.category,
      amount      !== undefined ? amount      : old.amount,
      accountId   !== undefined ? accountId   : old.account_id,
      employee    !== undefined ? employee    : old.employee,
      comment     !== undefined ? comment     : old.comment,
      receiptUrl  !== undefined ? receiptUrl  : old.receipt_url,
      shiftId     !== undefined ? shiftId     : old.shift_id,
      shiftNum    !== undefined ? shiftNum    : old.shift_num,
      old.id
    );
  })();

  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(old.id);
  return res.json(mapTx(updated));
});

// DELETE /api/orgs/:orgId/transactions/:id  (soft delete → trash)
app.delete('/api/orgs/:orgId/transactions/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND org_id = ?').get(
    req.params.id, org.id
  );
  if (!tx) return res.status(404).json({ __error: 'Transaction not found' });

  db.transaction(() => {
    // Move to trash
    db.prepare(`
      INSERT INTO trash (id, org_id, original_data)
      VALUES (?, ?, ?)
    `).run(randomUUID(), org.id, JSON.stringify(tx));

    // Reverse balance
    reverseBalanceDelta(db, tx.account_id, tx.type, tx.amount);

    // Delete from transactions
    db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  })();

  return res.json({ ok: true });
});

// ─── Transfers ────────────────────────────────────────────────────────────────

// POST /api/orgs/:orgId/transfers
app.post('/api/orgs/:orgId/transfers', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { uuid, date, fromAccountId, toAccountId, amount, comment } = req.body || {};
  if (!fromAccountId || !toAccountId) {
    return res.status(400).json({ __error: 'fromAccountId and toAccountId required' });
  }

  // UUID idempotency — check if either transfer tx already exists
  if (uuid) {
    const existing = db.prepare("SELECT id FROM transactions WHERE uuid = ?").get(uuid);
    if (existing) return res.json({ ok: true });
  }

  const linkId = uuid || randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    // Расход from source account
    db.prepare(`
      INSERT INTO transactions
        (id, uuid, org_id, date, type, category, amount, account_id, comment, shift_id)
      VALUES (?, ?, ?, ?, 'Расход', 'Перевод', ?, ?, ?, ?)
    `).run(randomUUID(), linkId, org.id, date || today, amount, fromAccountId, comment || '', linkId);

    // Доход to destination account
    db.prepare(`
      INSERT INTO transactions
        (id, uuid, org_id, date, type, category, amount, account_id, comment, shift_id)
      VALUES (?, ?, ?, ?, 'Доход', 'Перевод', ?, ?, ?, ?)
    `).run(randomUUID(), randomUUID(), org.id, date || today, amount, toAccountId, comment || '', linkId);

    // Update balances
    db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND org_id = ?').run(
      amount, fromAccountId, org.id
    );
    db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ? AND org_id = ?').run(
      amount, toAccountId, org.id
    );
  })();

  return res.json({ ok: true });
});

// ─── Trash ────────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/trash
app.get('/api/orgs/:orgId/trash', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const rows = db.prepare(`
    SELECT * FROM trash
    WHERE org_id = ?
      AND deleted_at >= datetime('now', '-30 days')
    ORDER BY deleted_at DESC
  `).all(org.id);

  return res.json(
    rows.map((r) => {
      let data;
      try { data = JSON.parse(r.original_data); } catch { data = {}; }
      return { trashId: r.id, deletedAt: r.deleted_at, ...mapTx(data) };
    })
  );
});

// POST /api/orgs/:orgId/trash/:id/restore
app.post('/api/orgs/:orgId/trash/:id/restore', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const trashRow = db.prepare('SELECT * FROM trash WHERE id = ? AND org_id = ?').get(
    req.params.id, org.id
  );
  if (!trashRow) return res.status(404).json({ __error: 'Trash item not found' });

  let tx;
  try { tx = JSON.parse(trashRow.original_data); } catch {
    return res.status(500).json({ __error: 'Corrupt trash data' });
  }

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO transactions
        (id, uuid, org_id, date, type, category, amount, account_id, employee, comment, receipt_url, shift_id, locked, shift_num, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tx.id, tx.uuid, org.id,
      tx.date, tx.type, tx.category, tx.amount,
      tx.account_id, tx.employee, tx.comment,
      tx.receipt_url, tx.shift_id, tx.locked || 0, tx.shift_num || 0,
      tx.created_at
    );

    applyBalanceDelta(db, tx.account_id, tx.type, tx.amount);
    db.prepare('DELETE FROM trash WHERE id = ?').run(trashRow.id);
  })();

  return res.json({ ok: true });
});

// DELETE /api/orgs/:orgId/trash  (purge items older than 30 days)
app.delete('/api/orgs/:orgId/trash', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const info = db.prepare(`
    DELETE FROM trash
    WHERE org_id = ? AND deleted_at < datetime('now', '-30 days')
  `).run(org.id);

  return res.json({ deleted: info.changes });
});

// ─── Home ─────────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/home
app.get('/api/orgs/:orgId/home', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { period } = req.query;
  const { from, to } = periodToRange(period);

  const accounts = db.prepare(
    "SELECT id, name, balance, status, icon, color FROM accounts WHERE org_id = ? AND status != 'archived' ORDER BY sort_order ASC"
  ).all(org.id);

  const transactions = db.prepare(`
    SELECT * FROM transactions
    WHERE org_id = ? AND date >= ? AND date <= ?
    ORDER BY date DESC, created_at DESC
    LIMIT 50
  `).all(org.id, from, to);

  const summaryRow = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'Доход' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type = 'Расход' THEN amount ELSE 0 END) AS expense
    FROM transactions
    WHERE org_id = ? AND date >= ? AND date <= ?
  `).get(org.id, from, to);

  return res.json({
    accounts,
    transactions: transactions.map(mapTx),
    summary: {
      income:  summaryRow.income  || 0,
      expense: summaryRow.expense || 0,
    },
  });
});

// ─── Shifts ───────────────────────────────────────────────────────────────────

// POST /api/orgs/:orgId/shifts
app.post('/api/orgs/:orgId/shifts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const {
    date, shiftNum, cashier,
    zCash, zCard, zSbp, zTotal,
    factCash, factCard, factSbp,
    withdrawals = [],
    discrepancy,
  } = req.body || {};

  const shiftId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO shifts
        (id, org_id, date, shift_num, cashier, z_cash, z_card, z_sbp, z_total, fact_cash, fact_card, fact_sbp, withdrawals, discrepancy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shiftId, org.id, date || today, shiftNum || 1,
      cashier || '',
      zCash || 0, zCard || 0, zSbp || 0, zTotal || 0,
      factCash || 0, factCard || 0, factSbp || 0,
      JSON.stringify(withdrawals),
      discrepancy || 0
    );

    // Save withdrawal transactions (locked)
    if (Array.isArray(withdrawals)) {
      withdrawals.forEach((w) => {
        if (!w.amount) return;
        const txId = randomUUID();
        db.prepare(`
          INSERT INTO transactions
            (id, uuid, org_id, date, type, category, amount, account_id, employee, comment, shift_id, locked, shift_num)
          VALUES (?, ?, ?, ?, 'Расход', 'Инкассация', ?, ?, ?, '', ?, 1, ?)
        `).run(
          txId, txId, org.id, date || today,
          w.amount, w.accountId || '', w.name || '',
          shiftId, shiftNum || 1
        );

        applyBalanceDelta(db, w.accountId, 'Расход', w.amount);
      });
    }
  })();

  const saved = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  return res.json({
    id:          saved.id,
    date:        saved.date,
    shiftNum:    saved.shift_num,
    cashier:     saved.cashier,
    zCash:       saved.z_cash,
    zCard:       saved.z_card,
    zSbp:        saved.z_sbp,
    zTotal:      saved.z_total,
    factCash:    saved.fact_cash,
    factCard:    saved.fact_card,
    factSbp:     saved.fact_sbp,
    withdrawals: JSON.parse(saved.withdrawals || '[]'),
    discrepancy: saved.discrepancy,
  });
});

// GET /api/orgs/:orgId/shifts
app.get('/api/orgs/:orgId/shifts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { from, to, cashier } = req.query;
  let sql = 'SELECT * FROM shifts WHERE org_id = ?';
  const params = [org.id];

  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to)   { sql += ' AND date <= ?'; params.push(to); }
  if (cashier) { sql += ' AND cashier = ?'; params.push(cashier); }

  sql += ' ORDER BY date DESC, shift_num DESC';

  const rows = db.prepare(sql).all(...params);
  return res.json(
    rows.map((s) => ({
      id:          s.id,
      date:        s.date,
      shiftNum:    s.shift_num,
      cashier:     s.cashier,
      zCash:       s.z_cash,
      zCard:       s.z_card,
      zSbp:        s.z_sbp,
      zTotal:      s.z_total,
      factCash:    s.fact_cash,
      factCard:    s.fact_card,
      factSbp:     s.fact_sbp,
      withdrawals: JSON.parse(s.withdrawals || '[]'),
      discrepancy: s.discrepancy,
    }))
  );
});

// DELETE /api/orgs/:orgId/shifts/:id
app.delete('/api/orgs/:orgId/shifts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ? AND org_id = ?').get(req.params.id, org.id);
  if (!shift) return res.status(404).json({ __error: 'Shift not found' });

  db.transaction(() => {
    // Reverse locked transactions linked to this shift
    const lockedTxs = db.prepare(
      "SELECT * FROM transactions WHERE shift_id = ? AND org_id = ? AND locked = 1"
    ).all(shift.id, org.id);

    lockedTxs.forEach((tx) => {
      reverseBalanceDelta(db, tx.account_id, tx.type, tx.amount);
    });

    db.prepare("DELETE FROM transactions WHERE shift_id = ? AND org_id = ? AND locked = 1").run(shift.id, org.id);
    db.prepare('DELETE FROM shifts WHERE id = ?').run(shift.id);
  })();

  return res.json({ ok: true });
});

// ─── Debts ────────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/debts
app.get('/api/orgs/:orgId/debts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const rows = db.prepare(
    'SELECT * FROM debts WHERE org_id = ? ORDER BY date DESC'
  ).all(org.id);

  // Group by rep_name
  const byRep = {};
  rows.forEach((d) => {
    if (!byRep[d.rep_name]) byRep[d.rep_name] = { name: d.rep_name, balance: 0, entries: [] };
    byRep[d.rep_name].balance += d.amount;
    byRep[d.rep_name].entries.push({
      id:        d.id,
      type:      d.type,
      amount:    d.amount,
      date:      d.date,
      status:    d.status,
      accountId: d.account_id,
      comment:   d.comment,
      invoice:   d.invoice,
    });
  });

  return res.json({ reps: Object.values(byRep) });
});

// POST /api/orgs/:orgId/debts
app.post('/api/orgs/:orgId/debts', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { repName, type, amount, date, accountId, comment, invoice } = req.body || {};
  if (!repName || !type || amount === undefined || !date) {
    return res.status(400).json({ __error: 'repName, type, amount, date required' });
  }

  const debtId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO debts (id, org_id, rep_name, type, amount, date, account_id, comment, invoice)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      debtId, org.id, repName, type, amount,
      date || today, accountId || '', comment || '', invoice || ''
    );

    // If type is Оплата, insert a Расход transaction with category=Долг ТП
    if (type === 'Оплата' && accountId) {
      const txId = randomUUID();
      db.prepare(`
        INSERT INTO transactions
          (id, uuid, org_id, date, type, category, amount, account_id, comment, shift_id)
        VALUES (?, ?, ?, ?, 'Расход', 'Долг ТП', ?, ?, ?, ?)
      `).run(txId, txId, org.id, date || today, Math.abs(amount), accountId, comment || '', debtId);

      applyBalanceDelta(db, accountId, 'Расход', Math.abs(amount));
    }
  })();

  const saved = db.prepare('SELECT * FROM debts WHERE id = ?').get(debtId);
  return res.json({
    id:        saved.id,
    type:      saved.type,
    amount:    saved.amount,
    date:      saved.date,
    status:    saved.status,
    accountId: saved.account_id,
    comment:   saved.comment,
    invoice:   saved.invoice,
  });
});

// PUT /api/orgs/:orgId/debts/:id
app.put('/api/orgs/:orgId/debts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const old = db.prepare('SELECT * FROM debts WHERE id = ? AND org_id = ?').get(req.params.id, org.id);
  if (!old) return res.status(404).json({ __error: 'Debt not found' });

  const { repName, type, amount, date, accountId, comment, invoice, status } = req.body || {};

  db.prepare(`
    UPDATE debts SET
      rep_name = ?, type = ?, amount = ?, date = ?,
      account_id = ?, comment = ?, invoice = ?, status = ?
    WHERE id = ?
  `).run(
    repName    !== undefined ? repName    : old.rep_name,
    type       !== undefined ? type       : old.type,
    amount     !== undefined ? amount     : old.amount,
    date       !== undefined ? date       : old.date,
    accountId  !== undefined ? accountId  : old.account_id,
    comment    !== undefined ? comment    : old.comment,
    invoice    !== undefined ? invoice    : old.invoice,
    status     !== undefined ? status     : old.status,
    old.id
  );

  const updated = db.prepare('SELECT * FROM debts WHERE id = ?').get(old.id);
  return res.json({
    id:        updated.id,
    type:      updated.type,
    amount:    updated.amount,
    date:      updated.date,
    status:    updated.status,
    accountId: updated.account_id,
    comment:   updated.comment,
    invoice:   updated.invoice,
  });
});

// DELETE /api/orgs/:orgId/debts/:id
app.delete('/api/orgs/:orgId/debts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const debt = db.prepare('SELECT * FROM debts WHERE id = ? AND org_id = ?').get(req.params.id, org.id);
  if (!debt) return res.status(404).json({ __error: 'Debt not found' });

  db.transaction(() => {
    // If linked transaction exists (Оплата type → shift_id=debt.id), reverse it
    if (debt.type === 'Оплата' && debt.account_id) {
      const linked = db.prepare(
        "SELECT * FROM transactions WHERE shift_id = ? AND org_id = ? AND category = 'Долг ТП'"
      ).get(debt.id, org.id);
      if (linked) {
        reverseBalanceDelta(db, linked.account_id, linked.type, linked.amount);
        db.prepare('DELETE FROM transactions WHERE id = ?').run(linked.id);
      }
    }
    db.prepare('DELETE FROM debts WHERE id = ?').run(debt.id);
  })();

  return res.json({ ok: true });
});

// PATCH /api/orgs/:orgId/debts/:id/status
app.patch('/api/orgs/:orgId/debts/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { status } = req.body || {};
  db.prepare('UPDATE debts SET status = ? WHERE id = ? AND org_id = ?').run(
    status, req.params.id, org.id
  );
  return res.json({ ok: true });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/analytics
app.get('/api/orgs/:orgId/analytics', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { period } = req.query;
  const { from, to } = periodToRange(period);

  // P&L
  const plRow = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'Доход'  THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN type = 'Расход' THEN amount ELSE 0 END) AS expense
    FROM transactions
    WHERE org_id = ? AND date >= ? AND date <= ?
  `).get(org.id, from, to);
  const income  = plRow.income  || 0;
  const expense = plRow.expense || 0;

  // By category
  const byCat = db.prepare(`
    SELECT category AS name, SUM(amount) AS amount, type
    FROM transactions
    WHERE org_id = ? AND date >= ? AND date <= ?
      AND type IN ('Доход','Расход')
      AND category != ''
    GROUP BY category, type
    ORDER BY amount DESC
  `).all(org.id, from, to);

  // By account
  const byAcc = db.prepare(`
    SELECT a.name,
      SUM(CASE WHEN t.type = 'Доход'  THEN t.amount ELSE 0 END) AS income,
      SUM(CASE WHEN t.type = 'Расход' THEN t.amount ELSE 0 END) AS expense
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.org_id = ? AND t.date >= ? AND t.date <= ?
    GROUP BY a.id, a.name
    ORDER BY income DESC
  `).all(org.id, from, to);

  // Cashiers (from shifts)
  const cashiers = db.prepare(`
    SELECT cashier AS name,
      SUM(z_total) AS revenue,
      COUNT(*) AS shifts,
      SUM(discrepancy) AS discrepancy
    FROM shifts
    WHERE org_id = ? AND date >= ? AND date <= ?
    GROUP BY cashier
    ORDER BY revenue DESC
  `).all(org.id, from, to);

  // Debt summary
  const debtRows = db.prepare(`
    SELECT rep_name AS name, SUM(amount) AS balance
    FROM debts
    WHERE org_id = ?
    GROUP BY rep_name
    ORDER BY balance DESC
  `).all(org.id);
  const debtTotal = debtRows.reduce((s, r) => s + r.balance, 0);

  return res.json({
    pl: { income, expense, profit: income - expense },
    byCategory: byCat,
    byAccount: byAcc,
    cashiers,
    debtSummary: { total: debtTotal, reps: debtRows },
  });
});

// GET /api/orgs/:orgId/trends
app.get('/api/orgs/:orgId/trends', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const now = new Date();
  const curFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const curTo   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const prevTo   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

  function monthSummary(from, to) {
    return db.prepare(`
      SELECT
        SUM(CASE WHEN type='Доход'  THEN amount ELSE 0 END) AS income,
        SUM(CASE WHEN type='Расход' THEN amount ELSE 0 END) AS expense
      FROM transactions
      WHERE org_id = ? AND date >= ? AND date <= ?
    `).get(org.id, from, to);
  }

  const cur  = monthSummary(curFrom, curTo);
  const prev = monthSummary(prevFrom, prevTo);

  const curIncome   = cur.income   || 0;
  const curExpense  = cur.expense  || 0;
  const prevIncome  = prev.income  || 0;
  const prevExpense = prev.expense || 0;

  const momIncome  = prevIncome  ? Math.round(((curIncome  - prevIncome)  / prevIncome)  * 100) : 0;
  const momExpense = prevExpense ? Math.round(((curExpense - prevExpense) / prevExpense) * 100) : 0;

  return res.json({
    currentMonth: { income: curIncome,  expense: curExpense },
    prevMonth:    { income: prevIncome, expense: prevExpense },
    momIncome,
    momExpense,
  });
});

// GET /api/orgs/:orgId/heatmap
app.get('/api/orgs/:orgId/heatmap', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  // Day-of-week heatmap (0=Sun … 6=Sat) using SQLite strftime
  const byDow = db.prepare(`
    SELECT CAST(strftime('%w', date) AS INTEGER) AS day,
           SUM(CASE WHEN type='Доход' THEN amount ELSE 0 END) AS revenue
    FROM transactions
    WHERE org_id = ? AND type IN ('Доход','Расход')
    GROUP BY day
    ORDER BY day
  `).all(org.id);

  // Ensure all 7 days present
  const dowMap = {};
  byDow.forEach((r) => { dowMap[r.day] = r.revenue; });
  const byDayOfWeek = [];
  for (let d = 0; d < 7; d++) {
    byDayOfWeek.push({ day: d, revenue: dowMap[d] || 0 });
  }

  // Hour heatmap — derived from created_at (ISO datetime)
  const byHourRaw = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
           SUM(CASE WHEN type='Доход' THEN amount ELSE 0 END) AS revenue
    FROM transactions
    WHERE org_id = ? AND type IN ('Доход','Расход')
    GROUP BY hour
    ORDER BY hour
  `).all(org.id);

  const hourMap = {};
  byHourRaw.forEach((r) => { hourMap[r.hour] = r.revenue; });
  const byHour = [];
  for (let h = 0; h < 24; h++) {
    byHour.push({ hour: h, revenue: hourMap[h] || 0 });
  }

  return res.json({ byDayOfWeek, byHour });
});

// GET /api/orgs/:orgId/cashier-shifts/:cashierName
app.get('/api/orgs/:orgId/cashier-shifts/:cashierName', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const rows = db.prepare(
    'SELECT * FROM shifts WHERE org_id = ? AND cashier = ? ORDER BY date DESC'
  ).all(org.id, req.params.cashierName);

  return res.json(
    rows.map((s) => ({
      id:          s.id,
      date:        s.date,
      shiftNum:    s.shift_num,
      cashier:     s.cashier,
      zCash:       s.z_cash,
      zCard:       s.z_card,
      zSbp:        s.z_sbp,
      zTotal:      s.z_total,
      factCash:    s.fact_cash,
      factCard:    s.fact_card,
      factSbp:     s.fact_sbp,
      withdrawals: JSON.parse(s.withdrawals || '[]'),
      discrepancy: s.discrepancy,
    }))
  );
});

// ─── Settings ─────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/settings
app.get('/api/orgs/:orgId/settings', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const categories = db.prepare(
    'SELECT id, name, type FROM categories WHERE org_id = ? ORDER BY type, name'
  ).all(org.id);

  const employees = db.prepare(
    'SELECT id, name, rate, status FROM employees WHERE org_id = ? ORDER BY name'
  ).all(org.id);

  const recurring = db.prepare(
    'SELECT * FROM recurring WHERE org_id = ? ORDER BY day_of_month, name'
  ).all(org.id).map((r) => ({
    id:          r.id,
    name:        r.name,
    category:    r.category,
    amount:      r.amount,
    accountId:   r.account_id,
    dayOfMonth:  r.day_of_month,
    active:      r.active === 1,
  }));

  return res.json({ categories, employees, recurring });
});

// POST /api/orgs/:orgId/settings/categories  (replace all)
app.post('/api/orgs/:orgId/settings/categories', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { categories = [] } = req.body || {};

  db.transaction(() => {
    db.prepare('DELETE FROM categories WHERE org_id = ?').run(org.id);
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO categories (id, org_id, name, type) VALUES (?, ?, ?, ?)'
    );
    categories.forEach((c) => {
      stmt.run(randomUUID(), org.id, c.name, c.type || 'expense');
    });
  })();

  return res.json({ ok: true });
});

// POST /api/orgs/:orgId/settings/employees  (upsert)
app.post('/api/orgs/:orgId/settings/employees', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { employees = [] } = req.body || {};

  db.transaction(() => {
    employees.forEach((e) => {
      const existing = db.prepare('SELECT id FROM employees WHERE org_id = ? AND name = ?').get(org.id, e.name);
      if (existing) {
        db.prepare('UPDATE employees SET rate=?, status=? WHERE id=?').run(
          e.rate || 0, e.status || 'active', existing.id
        );
      } else {
        db.prepare('INSERT INTO employees (id, org_id, name, rate, status) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(), org.id, e.name, e.rate || 0, e.status || 'active'
        );
      }
    });
  })();

  return res.json({ ok: true });
});

// ─── Recurring ────────────────────────────────────────────────────────────────

// POST /api/orgs/:orgId/recurring
app.post('/api/orgs/:orgId/recurring', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { name, category, amount, accountId, dayOfMonth, active } = req.body || {};
  if (!name) return res.status(400).json({ __error: 'name required' });

  const id = randomUUID();
  db.prepare(`
    INSERT INTO recurring (id, org_id, name, category, amount, account_id, day_of_month, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, org.id, name,
    category || '', amount || 0, accountId || '',
    dayOfMonth || 1, active !== false ? 1 : 0
  );

  const saved = db.prepare('SELECT * FROM recurring WHERE id = ?').get(id);
  return res.json({
    id:         saved.id,
    name:       saved.name,
    category:   saved.category,
    amount:     saved.amount,
    accountId:  saved.account_id,
    dayOfMonth: saved.day_of_month,
    active:     saved.active === 1,
  });
});

// DELETE /api/orgs/:orgId/recurring/:id
app.delete('/api/orgs/:orgId/recurring/:id', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  db.prepare('DELETE FROM recurring WHERE id = ? AND org_id = ?').run(req.params.id, org.id);
  return res.json({ ok: true });
});

// ─── Org Info ─────────────────────────────────────────────────────────────────

// GET /api/orgs/:orgId/info
app.get('/api/orgs/:orgId/info', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });
  return res.json({ id: org.id, name: org.name, createdAt: org.created_at });
});

// PUT /api/orgs/:orgId/info
app.put('/api/orgs/:orgId/info', requireAuth, (req, res) => {
  const db = getDb();
  const org = getOrgForUser(req.params.orgId, req.uid);
  if (!org) return res.status(404).json({ __error: 'Org not found' });

  const { name } = req.body || {};
  if (!name) return res.status(400).json({ __error: 'name required' });

  db.prepare('UPDATE orgs SET name = ? WHERE id = ?').run(name, org.id);
  return res.json({ ok: true });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../app/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log('Auron server on port ' + PORT));
