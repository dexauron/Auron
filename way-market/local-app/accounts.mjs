// Isolated foundation, NOT wired to the cash HTTP server yet. See the integration
// gates in docs/WAY_MARKET_ACCOUNTS.md before exposing any route or enabling LAN.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { permitted, AccessError } from './access.mjs';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const cost = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const roles = new Set(['owner', 'accountant', 'cashier', 'employee', 'representative']);
const absoluteMs = 8 * 60 * 60 * 1000, idleMs = 15 * 60 * 1000;
const publicUser = u => ({ id: u.id, login: u.login, name: u.name, role: u.role, active: Boolean(u.active), version: u.version });
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const failure = () => new AccessError('Вход не выполнен. Проверьте данные или повторите позже.');
function credentials(login, name, password, role) {
  if (typeof login !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(login)) throw new Error('Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание');
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Укажите имя до 100 символов');
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 || /[\x00-\x1f]/.test(password)) throw new Error('Пароль: 15–128 символов; можно использовать фразу');
  if (!roles.has(role)) throw new Error('Неизвестная роль');
  return { login: login.toLowerCase(), name: name.trim() };
}

export function openAccounts(filename, { clock = Date.now } = {}) {
  const db = new DatabaseSync(filename);
  if (![0, 1].includes(db.prepare('PRAGMA user_version').get().user_version)) { db.close(); throw new Error('Неподдерживаемая база аккаунтов'); }
  // Never pass cash-test.sqlite: this separate schema deliberately refuses a
  // financial database, including one whose user_version is also 1.
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revisions'").get()) { db.close(); throw new Error('Нужна отдельная база аккаунтов'); }
  const ownTables = new Set(['account_users', 'account_sessions', 'account_events', 'account_attempts']);
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().some(t => !ownTables.has(t.name))) { db.close(); throw new Error('Нужна отдельная база аккаунтов'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account_users (
      id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL, active INTEGER NOT NULL, version INTEGER NOT NULL,
      salt TEXT NOT NULL, verifier TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_sessions (
      digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_ms INTEGER NOT NULL,
      seen_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_events (
      sequence INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, actor_id TEXT,
      kind TEXT NOT NULL, subject_id TEXT, detail TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_attempts (
      bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_ms INTEGER NOT NULL
    ) STRICT;
    PRAGMA user_version=1;`);
  let activeKdf = 0;
  const now = () => {
    const n = clock();
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Неверное время сервера');
    return n;
  };
  async function kdf(password, salt) {
    // Bound memory use on the owner's 8 GB server; never build an unbounded queue.
    if (activeKdf >= 2) throw failure();
    activeKdf++;
    try { return await derive(password, Buffer.from(salt, 'hex'), 64, cost); }
    finally { activeKdf--; }
  }
  const event = (actor, kind, subject, detail = {}) => db.prepare('INSERT INTO account_events (at_ms,actor_id,kind,subject_id,detail) VALUES (?,?,?,?,?)').run(now(), actor, kind, subject, JSON.stringify(detail));
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const userById = id => db.prepare('SELECT * FROM account_users WHERE id=?').get(id);
  function session(token, touch = true) {
    if (!validToken(token)) throw new AccessError('Войдите в аккаунт');
    const digest = hash(token), s = db.prepare('SELECT * FROM account_sessions WHERE digest=?').get(digest), at = now();
    if (!s || at < s.seen_ms || at >= s.expires_ms || at - s.seen_ms >= idleMs) {
      db.prepare('DELETE FROM account_sessions WHERE digest=?').run(digest);
      throw new AccessError('Войдите в аккаунт');
    }
    const u = userById(s.user_id);
    if (!u?.active) throw new AccessError('Войдите в аккаунт');
    if (touch) db.prepare('UPDATE account_sessions SET seen_ms=? WHERE digest=?').run(at, digest);
    return publicUser(u);
  }
  function authorize(token, action, resource) {
    const actor = session(token);
    if (!permitted(actor, action, resource)) throw new AccessError();
    return actor;
  }
  function insertUser(c, passwordHash, salt, role, actor) {
    if (db.prepare('SELECT id FROM account_users WHERE login=?').get(c.login)) throw new Error('Логин уже занят');
    const id = randomUUID();
    db.prepare('INSERT INTO account_users VALUES (?,?,?,?,1,1,?,?)').run(id, c.login, c.name, role, salt, passwordHash.toString('hex'));
    event(actor ?? id, actor ? 'account.created' : 'owner.bootstrap', id, { role });
    return publicUser(userById(id));
  }
  return {
    async bootstrapOwner({ login, name, password }) {
      const c = credentials(login, name, password, 'owner');
      if (db.prepare('SELECT id FROM account_users LIMIT 1').get()) throw new AccessError('Первый владелец уже создан');
      const salt = randomBytes(16).toString('hex'), verifier = await kdf(password, salt);
      return transaction(() => {
        if (db.prepare('SELECT id FROM account_users LIMIT 1').get()) throw new AccessError('Первый владелец уже создан');
        return insertUser(c, verifier, salt, 'owner', null);
      });
    },
    async createUser(token, { login, name, password, role }) {
      authorize(token, 'accounts.manage');
      const c = credentials(login, name, password, role);
      const salt = randomBytes(16).toString('hex'), verifier = await kdf(password, salt);
      return transaction(() => insertUser(c, verifier, salt, role, authorize(token, 'accounts.manage').id));
    },
    async login({ login, password }) {
      if (typeof login !== 'string' || login.length > 64 || typeof password !== 'string' || Buffer.byteLength(password) > 512) throw failure();
      const normalized = login.toLowerCase(), bucket = hash(normalized), at = now();
      const allowed = transaction(() => {
        db.prepare('DELETE FROM account_attempts WHERE expires_ms<=?').run(at);
        db.prepare('DELETE FROM account_sessions WHERE expires_ms<=? OR seen_ms<=?').run(at, at - idleMs);
        for (const [key, limit] of [['all', 30], [bucket, 5]]) {
          const count = db.prepare('SELECT count FROM account_attempts WHERE bucket=?').get(key)?.count ?? 0;
          if (count >= limit) { event(null, 'login.throttled', null); return false; }
        }
        for (const key of ['all', bucket]) db.prepare('INSERT INTO account_attempts VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(key, at + 60000);
        return true;
      });
      if (!allowed) throw failure();
      const u = db.prepare('SELECT * FROM account_users WHERE login=?').get(normalized);
      const candidate = await kdf(password, u?.salt ?? '00'.repeat(16));
      const result = transaction(() => {
        // User/password/permissions may have changed while scrypt was running.
        const current = u && userById(u.id);
        if (!current?.active || current.version !== u.version || !timingSafeEqual(candidate, Buffer.from(u.verifier, 'hex'))) {
          event(null, 'login.failed', u?.id ?? null); return null;
        }
        const token = randomBytes(32).toString('hex'), issued = now();
        db.prepare('INSERT INTO account_sessions VALUES (?,?,?,?,?)').run(hash(token), u.id, issued, issued, issued + absoluteMs);
        event(u.id, 'login.succeeded', u.id);
        return { token, user: publicUser(current), expiresAt: issued + absoluteMs };
      });
      if (!result) throw failure();
      return result;
    },
    session,
    authorize,
    logout(token) {
      const actor = session(token, false);
      transaction(() => { db.prepare('DELETE FROM account_sessions WHERE digest=?').run(hash(token)); event(actor.id, 'logout', actor.id); });
    },
    listUsers(token) { authorize(token, 'accounts.manage'); return db.prepare('SELECT * FROM account_users ORDER BY login').all().map(publicUser); },
    updateUser(token, { id, expectedVersion, role, active, name, reason }) {
      return transaction(() => {
        const actor = authorize(token, 'accounts.manage'), target = userById(id);
        if (!target || target.version !== expectedVersion) throw new Error('Аккаунт уже изменён. Обновите список');
        if (!roles.has(role) || typeof active !== 'boolean' || typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new Error('Укажите роль, имя, состояние и причину изменения');
        if (target.role === 'owner' && target.active && (role !== 'owner' || !active) && db.prepare("SELECT COUNT(*) n FROM account_users WHERE role='owner' AND active=1").get().n <= 1) throw new AccessError('Нельзя отключить последнего владельца');
        db.prepare('UPDATE account_users SET role=?,active=?,name=?,version=version+1 WHERE id=?').run(role, Number(active), name.trim(), id);
        db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(id);
        event(actor.id, 'account.updated', id, { before: publicUser(target), after: publicUser(userById(id)), reason: reason.trim() });
        return publicUser(userById(id));
      });
    },
    securityHistory(token) { authorize(token, 'security.read'); return db.prepare('SELECT * FROM account_events ORDER BY sequence').all().map(e => ({ ...e, detail: JSON.parse(e.detail) })); },
    close() { db.close(); }
  };
}
