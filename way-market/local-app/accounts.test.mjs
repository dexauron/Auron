import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAccounts } from './accounts.mjs';
import { permitted } from './access.mjs';

const password = 'Тестовая фраза для входа 123';
const ownerInput = { login: 'owner', name: 'Тестовый владелец', password };
async function fixture(t) {
  let time = 1800000000000;
  const directory = mkdtempSync(join(tmpdir(), 'way-accounts-'));
  const file = join(directory, 'accounts.sqlite');
  const accounts = openAccounts(file, { clock: () => time });
  t.after(() => { accounts.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = await accounts.bootstrapOwner(ownerInput);
  const login = await accounts.login({ login: 'OWNER', password });
  return { accounts, owner, token: login.token, file, advance: ms => { time += ms; } };
}

test('policy denies unknown actions, roles, absent owner and confidential fields to cashiers', () => {
  const cashier = { id: 'c1', role: 'cashier', active: true };
  assert.equal(permitted(cashier, 'cash.submit', { cashierId: 'c1' }), true);
  for (const resource of [{ cashierId: 'c2' }, {}, null]) assert.equal(permitted(cashier, 'cash.read', resource), false);
  for (const action of ['cash.accept', 'cash.correct', 'archive.manage', 'accounts.manage', 'security.read', 'cash.settings']) assert.equal(permitted(cashier, action, { cashierId: 'c1' }), false);
  assert.equal(permitted({ ...cashier, active: false }, 'cash.read', { cashierId: 'c1' }), false);
  assert.equal(permitted({ ...cashier, role: 'employee' }, 'cash.read', { cashierId: 'c1' }), false);
  assert.equal(permitted({ ...cashier, role: 'owner' }, 'invented.action'), false);
  assert.equal(permitted(null, 'cash.read'), false);
});

test('bootstrap is once-only, salts differ, database and audit never store passwords or tokens', async t => {
  const { accounts, token, file } = await fixture(t);
  await assert.rejects(accounts.bootstrapOwner(ownerInput), /уже создан/);
  const cashier = await accounts.createUser(token, { login: 'cashier', name: 'Тестовый кассир', password, role: 'cashier' });
  assert.equal(cashier.role, 'cashier');
  assert.deepEqual(Object.keys(cashier).sort(), ['active', 'id', 'login', 'name', 'role', 'version']);
  const db = new DatabaseSync(file);
  try {
    const users = db.prepare('SELECT * FROM account_users').all();
    assert.notEqual(users[0].salt, users[1].salt);
    assert.notEqual(users[0].verifier, users[1].verifier);
    const dump = JSON.stringify([...users, ...db.prepare('SELECT * FROM account_sessions').all(), ...db.prepare('SELECT * FROM account_events').all()]);
    assert.equal(dump.includes(password), false);
    assert.equal(dump.includes(token), false);
  } finally { db.close(); }
});

test('unknown and wrong-password login share error, failures persist and limits expire', async t => {
  const { accounts, token, advance } = await fixture(t);
  const wrong = await accounts.login({ login: 'owner', password: 'wrong' }).catch(e => e.message);
  const unknown = await accounts.login({ login: 'missing', password: 'wrong' }).catch(e => e.message);
  assert.equal(wrong, unknown);
  for (let n = 0; n < 3; n++) await assert.rejects(accounts.login({ login: 'owner', password: 'wrong' }));
  await assert.rejects(accounts.login({ login: 'owner', password }));
  const history = accounts.securityHistory(token);
  assert.equal(history.filter(e => e.kind === 'login.failed').length, 5);
  assert.equal(history.at(-1).kind, 'login.throttled');
  advance(61000);
  assert.equal((await accounts.login({ login: 'owner', password })).user.role, 'owner');
});

test('cashier cannot impersonate owner; accountant cannot manage accounts or view security history', async t => {
  const { accounts, token } = await fixture(t);
  const cashier = await accounts.createUser(token, { login: 'cashier', name: 'Кассир', password, role: 'cashier' });
  await accounts.createUser(token, { login: 'accountant', name: 'Бухгалтер', password, role: 'accountant' });
  const c = await accounts.login({ login: 'cashier', password });
  const a = await accounts.login({ login: 'accountant', password });
  assert.equal(accounts.authorize(c.token, 'cash.submit', { cashierId: cashier.id }).id, cashier.id);
  assert.throws(() => accounts.authorize(c.token, 'cash.read', { cashierId: 'another' }));
  assert.throws(() => accounts.authorize(token.slice(1), 'cash.read'));
  assert.throws(() => accounts.authorize({ ...c.user, role: 'owner' }, 'cash.read'));
  assert.equal(accounts.authorize(a.token, 'cash.accept').role, 'accountant');
  for (const s of [a.token, c.token]) {
    assert.throws(() => accounts.listUsers(s));
    assert.throws(() => accounts.securityHistory(s));
    await assert.rejects(accounts.createUser(s, { ...ownerInput, login: 'rogue' }));
  }
});

test('changing role or active state revokes sessions and retains before/after/reason; stale writes fail', async t => {
  const { accounts, token } = await fixture(t);
  const u = await accounts.createUser(token, { login: 'cashier', name: 'Кассир', password, role: 'cashier' });
  const c = await accounts.login({ login: 'cashier', password });
  const command = { id: u.id, expectedVersion: 1, role: 'employee', active: false, name: 'Кассир', reason: 'Тестовое отключение' };
  const updated = accounts.updateUser(token, command);
  assert.equal(updated.version, 2);
  assert.throws(() => accounts.session(c.token));
  await assert.rejects(accounts.login({ login: 'cashier', password }));
  assert.throws(() => accounts.updateUser(token, command), /уже изменён/);
  const e = accounts.securityHistory(token).find(e => e.kind === 'account.updated');
  assert.equal(e.detail.before.active, true);
  assert.equal(e.detail.after.active, false);
  assert.equal(e.detail.reason, command.reason);
});

test('last owner cannot be disabled or demoted, rejected command leaves no audit event', async t => {
  const { accounts, owner, token } = await fixture(t);
  const before = accounts.securityHistory(token).length;
  for (const [role, active] of [['cashier', true], ['owner', false]]) assert.throws(() => accounts.updateUser(token, { id: owner.id, expectedVersion: 1, role, active, name: owner.name, reason: 'Ошибка' }), /последнего владельца/);
  assert.equal(accounts.securityHistory(token).length, before);
  assert.equal(accounts.session(token).role, 'owner');
});

test('logout, idle timeout, absolute timeout and backwards clock invalidate sessions', async t => {
  const { accounts, token, advance } = await fixture(t);
  accounts.logout(token);
  assert.throws(() => accounts.session(token));
  const idle = await accounts.login({ login: 'owner', password });
  advance(15 * 60000);
  assert.throws(() => accounts.session(idle.token));
  const absolute = await accounts.login({ login: 'owner', password });
  for (let i = 0; i < 47; i++) { advance(10 * 60000); accounts.session(absolute.token); }
  advance(10 * 60000);
  assert.throws(() => accounts.session(absolute.token));
  const backward = await accounts.login({ login: 'owner', password });
  advance(-1);
  assert.throws(() => accounts.session(backward.token));
});

test('existing financial database is rejected without changing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'way-account-guard-')), file = join(dir, 'cash.sqlite');
  try {
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE revisions (id TEXT); PRAGMA user_version=1;'); db.close();
    assert.throws(() => openAccounts(file), /отдельная база/);
    const check = new DatabaseSync(file);
    assert.equal(check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'account_%'").get().n, 0);
    check.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('revocation and audit are visible to another connection', async t => {
  const { accounts, token, file } = await fixture(t);
  const reopened = openAccounts(file, { clock: () => 1800000000000 });
  try {
    assert.equal(reopened.session(token).role, 'owner');
    const cashier = await accounts.createUser(token, { login: 'cashier', name: 'Кассир', password, role: 'cashier' });
    const login = await accounts.login({ login: 'cashier', password });
    assert.equal(reopened.session(login.token).id, cashier.id);
    accounts.updateUser(token, { id: cashier.id, expectedVersion: 1, role: 'cashier', active: false, name: cashier.name, reason: 'Отключение' });
    assert.throws(() => reopened.session(login.token));
    assert.equal(reopened.securityHistory(token).at(-1).kind, 'account.updated');
  } finally { reopened.close(); }
});

test('accounts, sessions and audit survive closing and reopening the database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'way-account-restart-')), file = join(dir, 'accounts.sqlite');
  let a = openAccounts(file);
  try {
    const owner = await a.bootstrapOwner(ownerInput);
    const login = await a.login({ login: 'owner', password });
    a.close(); a = openAccounts(file);
    assert.equal(a.session(login.token).id, owner.id);
    assert.deepEqual(a.securityHistory(login.token).map(e => e.kind), ['owner.bootstrap', 'login.succeeded']);
    assert.equal((await a.login({ login: 'owner', password })).user.id, owner.id);
  } finally { a.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent bootstrap creates only one owner', async t => {
  const a = openAccounts(':memory:'); t.after(() => a.close());
  const results = await Promise.allSettled([
    a.bootstrapOwner(ownerInput),
    a.bootstrapOwner({ ...ownerInput, login: 'second-owner' })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});

test('permissions are rechecked after password hashing, not just before it', async t => {
  const { accounts, owner, token } = await fixture(t);
  await accounts.createUser(token, { ...ownerInput, login: 'second-owner', role: 'owner' });
  const second = await accounts.login({ login: 'second-owner', password });
  const pending = accounts.createUser(token, { login: 'pending-cashier', name: 'Кассир', password, role: 'cashier' });
  accounts.updateUser(second.token, { id: owner.id, expectedVersion: 1, role: 'employee', active: true, name: owner.name, reason: 'Смена роли во время запроса' });
  await assert.rejects(pending);
  assert.equal(accounts.listUsers(second.token).some(u => u.login === 'pending-cashier'), false);
});
