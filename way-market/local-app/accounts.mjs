// Account foundation. The new workspace server uses the optional shared business
// transaction; the legacy cash HTTP server remains separate. LAN stays disabled.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { permitted, AccessError } from './access.mjs';
import { InputError } from './domain.mjs';
import { ARCHIVE_TABLES, MAX_WORKSPACE_ROWS } from './workspace-archive.mjs';
export class AccountConflictError extends Error {}

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const cost = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const roles = new Set(['owner', 'administrator', 'accountant', 'cashier', 'employee', 'representative']);
const absoluteMs = 8 * 60 * 60 * 1000, idleMs = 15 * 60 * 1000;
const publicUser = u => ({ id: u.id, login: u.login, name: u.name, role: u.role, active: Boolean(u.active), version: u.version });
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const failure = () => new AccessError('Вход не выполнен. Проверьте данные или повторите позже.');
function credentials(login, name, password, role) {
  if (typeof login !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(login)) throw new InputError('Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание');
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new InputError('Укажите имя до 100 символов');
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 || /[\x00-\x1f]/.test(password)) throw new InputError('Пароль: 15–128 символов; можно использовать фразу');
  if (!roles.has(role)) throw new InputError('Неизвестная роль');
  return { login: login.toLowerCase(), name: name.trim() };
}

export function openAccounts(filename, { clock = Date.now, workspace = false } = {}) {
  const db = new DatabaseSync(filename);
  if (![0, 1].includes(db.prepare('PRAGMA user_version').get().user_version)) { db.close(); throw new Error('Неподдерживаемая база аккаунтов'); }
  // Never pass cash-test.sqlite: this separate schema deliberately refuses a
  // financial database, including one whose user_version is also 1.
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='revisions'").get()) { db.close(); throw new Error('Нужна отдельная база аккаунтов'); }
  const ownTables = new Set(['account_users', 'account_sessions', 'account_events', 'account_attempts']);
  if (workspace) for (const name of ['workspace_cash', 'workspace_requests', 'workspace_tasks', 'workspace_products', 'workspace_drafts']) ownTables.add(name);
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
    CREATE INDEX IF NOT EXISTS account_event_kind ON account_events(kind,sequence);
    PRAGMA user_version=1;`);
  if (workspace) db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_cash (id TEXT NOT NULL, version INTEGER NOT NULL, shift_key TEXT NOT NULL, cashier_id TEXT NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL, at_ms INTEGER NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(id,version), UNIQUE(shift_key,version)) STRICT;
    CREATE INDEX IF NOT EXISTS workspace_cash_owner ON workspace_cash(cashier_id,id,version);
    CREATE TABLE IF NOT EXISTS workspace_requests (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_tasks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, creator_id TEXT NOT NULL, assignee_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, related_cash TEXT, at_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_products (id TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL, barcode TEXT NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_drafts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, slot TEXT NOT NULL, version INTEGER NOT NULL, base_version INTEGER NOT NULL, fields TEXT, at_ms INTEGER NOT NULL, request_id TEXT, request_digest TEXT, UNIQUE(user_id,slot)) STRICT;`);
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
    if (db.prepare('SELECT id FROM account_users WHERE login=?').get(c.login)) throw new InputError('Логин уже занят');
    const id = randomUUID();
    db.prepare('INSERT INTO account_users VALUES (?,?,?,?,1,1,?,?)').run(id, c.login, c.name, role, salt, passwordHash.toString('hex'));
    event(actor ?? id, actor ? 'account.created' : 'owner.bootstrap', id, { role });
    return publicUser(userById(id));
  }
  function backupActor(proof) {
    if (!workspace) throw new AccessError();
    if (typeof proof === 'string') return authorize(proof, 'backup.manage');
    // Only the trusted scheduler calls this branch. HTTP supplies cookie strings.
    const current = proof && userById(proof.id);
    if (!current || !current.active || current.role !== 'owner' || current.version !== proof.version) throw new AccessError('Владелец отключён или полномочия изменены. Настройте резервирование заново');
    return publicUser(current);
  }
  return {
    backupActor,
    backupState(proof) {
      backupActor(proof);
      const success = db.prepare("SELECT detail FROM account_events WHERE kind='backup.completed' ORDER BY sequence DESC LIMIT 1").get();
      const operation = db.prepare("SELECT kind,detail FROM account_events WHERE kind IN ('backup.failed','backup.completed','backup.verified','backup.restore-checked') ORDER BY sequence DESC LIMIT 1").get();
      const schedule = db.prepare("SELECT kind FROM account_events WHERE kind IN ('backup.schedule-enabled','backup.schedule-disabled') ORDER BY sequence DESC LIMIT 1").get();
      return { lastSuccess: success ? JSON.parse(success.detail) : null, lastOperation: operation ? { kind: operation.kind, detail: JSON.parse(operation.detail) } : null, lastSchedule: schedule?.kind ?? null };
    },
    backupEvent(proof, kind, detail = {}) {
      transaction(() => { const actor = backupActor(proof); event(actor.id, `backup.${kind}`, null, detail); });
    },
    workspaceSnapshot(proof, { withMetadata = false } = {}) {
      return transaction(() => {
        const actor = backupActor(proof); event(actor.id, 'backup.started', null);
        let total = 0;
        for (const table of Object.keys(ARCHIVE_TABLES)) total += db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
        if (total > MAX_WORKSPACE_ROWS) throw new InputError('База превышает лимит этого этапа резервирования');
        const tables = Object.fromEntries(Object.keys(ARCHIVE_TABLES).map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'account_events' ? 'sequence' : table === 'workspace_cash' ? 'id,version' : 'id'}`).all()]));
        return withMetadata ? { tables, createdAt: new Date(now()).toISOString() } : tables;
      });
    },
    // Trusted import only AFTER worker validation, into a new empty database.
    restoreWorkspace(archive, operatorId) {
      if (!workspace) throw new Error('Нужна рабочая база');
      return transaction(() => {
        if (Object.keys(ARCHIVE_TABLES).some(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n)) throw new AccountConflictError('Восстановление разрешено только в новую пустую базу');
        for (const [table, columns] of Object.entries(ARCHIVE_TABLES)) {
          const insert = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
          for (const row of archive.tables[table] ?? []) insert.run(...columns.map(k => row[k]));
        }
        db.prepare('DELETE FROM account_sessions').run(); db.prepare('DELETE FROM account_attempts').run();
        event(null, 'backup.restored', null, { operatorId, sourceCreatedAt: archive.createdAt, sourceDigest: archive.digest });
      });
    },
    async confirmPassword(token, currentPassword) {
      const actor = session(token), current = userById(actor.id), at = now(), bucket = `reauth-${actor.id}`;
      const allowed = transaction(() => {
        db.prepare('DELETE FROM account_attempts WHERE expires_ms<=?').run(at);
        if ((db.prepare('SELECT count FROM account_attempts WHERE bucket=?').get(bucket)?.count ?? 0) >= 5) return false;
        db.prepare('INSERT INTO account_attempts VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(bucket, at + 60000); return true;
      });
      if (!allowed || typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 512) throw failure();
      const candidate = await kdf(currentPassword, current.salt);
      if (!timingSafeEqual(candidate, Buffer.from(current.verifier, 'hex')) || session(token).version !== current.version) throw failure();
      return actor;
    },
    checkpoint() { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); },
    configured() { return Boolean(db.prepare('SELECT id FROM account_users LIMIT 1').get()); },
    // Trusted synchronous backend extension: auth, business write and audit share
    // this connection and transaction. Never expose SQL/callbacks over HTTP.
    command(token, action, resolveResource, apply) {
      if (!workspace) throw new Error('Рабочие модули не подключены');
      return transaction(() => {
        const actor = session(token), resource = resolveResource(db, actor);
        if (!permitted(actor, action, resource)) throw new AccessError();
        const result = apply(db, actor, (kind, subject, detail) => event(actor.id, kind, subject, detail), now());
        if (result && typeof result.then === 'function') throw new Error('Команда должна быть синхронной');
        return result;
      });
    },
    async changePassword(token, { currentPassword, password }) {
      const actor = session(token), current = userById(actor.id);
      credentials(current.login, current.name, password, current.role);
      if (typeof currentPassword !== 'string' || Buffer.byteLength(currentPassword) > 512) throw failure();
      const proof = await kdf(currentPassword, current.salt);
      if (!timingSafeEqual(proof, Buffer.from(current.verifier, 'hex'))) throw failure();
      const salt = randomBytes(16).toString('hex'), verifier = await kdf(password, salt);
      transaction(() => {
        const fresh = session(token);
        if (userById(fresh.id).version !== current.version) throw new AccessError('Аккаунт изменён. Войдите снова');
        db.prepare('UPDATE account_users SET salt=?,verifier=?,version=version+1 WHERE id=?').run(salt, verifier.toString('hex'), fresh.id);
        db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(fresh.id);
        event(fresh.id, 'password.changed', fresh.id);
      });
    },
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
        if (!target || target.version !== expectedVersion) throw new AccountConflictError('Аккаунт уже изменён. Обновите список');
        if (!roles.has(role) || typeof active !== 'boolean' || typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name) || typeof reason !== 'string' || !reason.trim() || reason.length > 500) throw new InputError('Укажите роль, имя, состояние и причину изменения');
        if (target.role === 'owner' && target.active && (role !== 'owner' || !active) && db.prepare("SELECT COUNT(*) n FROM account_users WHERE role='owner' AND active=1").get().n <= 1) throw new AccessError('Нельзя отключить последнего владельца');
        db.prepare('UPDATE account_users SET role=?,active=?,name=?,version=version+1 WHERE id=?').run(role, Number(active), name.trim(), id);
        db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(id);
        // A role change must never expose an accountant's raw received sum to a cashier.
        if (workspace && (target.role !== role || !active)) db.prepare('UPDATE workspace_drafts SET fields=NULL,version=version+1,request_id=NULL,request_digest=NULL WHERE user_id=?').run(id);
        event(actor.id, 'account.updated', id, { before: publicUser(target), after: publicUser(userById(id)), reason: reason.trim() });
        return publicUser(userById(id));
      });
    },
    securityHistory(token) { authorize(token, 'security.read'); return db.prepare('SELECT * FROM account_events ORDER BY sequence').all().map(e => ({ ...e, detail: JSON.parse(e.detail) })); },
    close() { db.close(); }
  };
}
