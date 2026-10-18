import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openWorkspace, emptySheet } from './workspace-store.mjs';
import { createBackupService, backupWorker } from './workspace-backups.mjs';
import { validateWorkspaceArchive } from './workspace-archive.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';

const password = 'Пароль владельца для испытаний 123';
const key = 'Отдельный пароль резервной копии 456';
const request = () => randomUUID();
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'way-backups-')); let now = Date.now();
  const w = openWorkspace(join(dir, 'source.sqlite'), { clock: () => now });
  await w.accounts.bootstrapOwner({ login: 'owner', name: 'Владелец', password });
  const owner = await w.accounts.login({ login: 'owner', password });
  const config = { directory: join(dir, 'backups'), restoreDirectory: join(dir, 'restored'), ...options };
  const service = createBackupService(w, config);
  t.after(async () => { await service.close(); w.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, w, owner, service, config, advance: () => { now += 61000; } };
}
function seed(w, owner) {
  const input = emptySheet(); input.date = '2026-10-18'; input.shiftNo = '1';
  for (const row of input.worksheet.settings.rows) input.worksheet.values[row.id] = row.enabled ? '0' : '';
  Object.assign(input.worksheet.values, { cashReport: '1000', received: '999.99' });
  const cash = { requestId: request(), expectedVersion: 0, accept: true, input };
  const saved = w.cashSave(owner.token, cash);
  w.taskSave(owner.token, { requestId: request(), expectedVersion: 0, title: 'Проверить сдачу', assigneeId: owner.user.id, relatedCash: saved.id, status: 'open' });
  w.productSave(owner.token, { requestId: request(), expectedVersion: 0, name: 'Товар', barcode: '123', price: '12.34', active: true });
  return { cash, saved };
}
const auth = (extras = {}) => ({ password: key, passwordAgain: key, currentPassword: password, ...extras });

test('encrypted full backup restores accounts, exact results, links and retry keys; sessions are not restored', async t => {
  const { w, owner, service, advance } = await fixture(t); const original = seed(w, owner);
  const copy = await service.create(owner.token, auth());
  const bytes = await service.download(owner.token, auth({ id: copy.id }));
  assert.equal(bytes.includes(Buffer.from(password)), false); assert.equal(bytes.includes(Buffer.from(owner.token)), false);
  const decoded = await backupWorker({ operation: 'decrypt', password: key, bytes });
  assert.equal(Object.hasOwn(decoded.archive.tables, 'account_sessions'), false);
  assert.equal(Object.hasOwn(decoded.archive.tables, 'account_attempts'), false);
  assert.equal(decoded.stats.cashVersions, 1); assert.equal(decoded.stats.products, 1);
  const checked = await service.verify(owner.token, auth({ id: copy.id })); assert.equal(checked.tasks, 1);
  w.taskSave(owner.token, { requestId: request(), expectedVersion: 0, title: 'После копии', assigneeId: owner.user.id, status: 'open' });
  advance(); const restored = await service.restore(owner.token, auth({ id: copy.id })); assert.equal(restored.switched, false); assert.equal(restored.sessionsRestored, false);
  const r = openWorkspace(restored.path);
  try {
    assert.throws(() => r.accounts.session(owner.token));
    const login = await r.accounts.login({ login: 'owner', password });
    assert.equal(r.cashGet(login.token, original.saved.id).result.receivedDifference, -1);
    assert.equal(r.tasks(login.token).length, 1); assert.equal(w.tasks(owner.token).length, 2);
    assert.deepEqual(r.cashSave(login.token, original.cash), original.saved);
    assert.ok(r.accounts.securityHistory(login.token).some(e => e.kind === 'backup.restored'));
  } finally { r.close(); }
});
test('archive recalculates math and checks ownership, version continuity, retry links, audit and active owner', async t => {
  const { w, owner } = await fixture(t); seed(w, owner);
  const encrypted = await backupWorker({ operation: 'encrypt', password: key, tables: w.accounts.workspaceSnapshot(owner.token) });
  const { archive } = await backupWorker({ operation: 'decrypt', password: key, bytes: encrypted.bytes });
  const mutations = [
    a => { const c = a.tables.workspace_cash[0]; const result = JSON.parse(c.result); result.expected++; c.result = JSON.stringify(result); },
    a => { a.tables.workspace_tasks[0].assignee_id = randomUUID(); },
    a => { a.tables.workspace_cash[0].version = 2; },
    a => { a.tables.workspace_requests = []; },
    a => { a.tables.account_events = a.tables.account_events.filter(e => e.kind !== 'cash.accepted'); },
    a => { a.tables.account_users[0].active = 0; },
    a => { a.tables.unrecognized = []; }
  ];
  for (const mutate of mutations) { const changed = structuredClone(archive); mutate(changed); const { digest, ...payload } = changed; changed.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); assert.throws(() => validateWorkspaceArchive(changed)); }
});
test('wrong key and modified ciphertext fail; corruption creates no restored database and leaves source intact', async t => {
  const { w, owner, service, config, advance } = await fixture(t); seed(w, owner);
  const copy = await service.create(owner.token, auth()), path = join(config.directory, copy.id), original = await readFile(path);
  await assert.rejects(backupWorker({ operation: 'decrypt', password: key + 'wrong', bytes: original }), /пароль|повреждена/);
  const broken = Buffer.from(original); broken[broken.length - 20] ^= 1;
  await writeFile(path, broken); advance();
  await assert.rejects(service.restore(owner.token, auth({ id: copy.id })), /пароль|повреждена/);
  assert.equal(w.cashList(owner.token).length, 1); assert.equal(w.accounts.session(owner.token).role, 'owner');
  assert.deepEqual(await readdir(config.restoreDirectory).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e)), []);
  assert.ok((await service.status(owner.token)).lastError);
});
test('full backups are owner-only; unsafe names and mismatched passwords are rejected', async t => {
  const { w, owner, service } = await fixture(t);
  await w.accounts.createUser(owner.token, { login: 'accountant', name: 'Бухгалтер', password, role: 'accountant' });
  const a = await w.accounts.login({ login: 'accountant', password });
  for (const operation of ['status', 'create', 'download', 'verify', 'restore', 'configure', 'disable']) await assert.rejects(service[operation](a.token, auth({ id: '../source.sqlite', minutes: 10 })));
  await assert.rejects(service.create(owner.token, auth({ passwordAgain: 'другой' })), /не совпадают/);
  await assert.rejects(service.download(owner.token, auth({ id: '../source.sqlite' })), /Неверное имя/);
  assert.equal((await service.status(owner.token)).files.length, 0);
});
test('failed destination never reports success and does not delete an earlier good backup', async t => {
  const { w, owner, service, dir, config, advance } = await fixture(t); seed(w, owner);
  const good = await service.create(owner.token, auth()), goodBytes = await readFile(join(config.directory, good.id));
  const blocked = join(dir, 'regular-file'); await writeFile(blocked, 'not a directory');
  const bad = createBackupService(w, { ...config, directory: blocked }); t.after(() => bad.close()); advance();
  await assert.rejects(bad.create(owner.token, auth()));
  assert.deepEqual(await readFile(join(config.directory, good.id)), goodBytes);
  assert.ok(w.accounts.securityHistory(owner.token).some(e => e.kind === 'backup.failed'));
});
test('schedule works after logout, survives as a visible pause after restart, and never persists the key', async t => {
  const { w, owner, service, config, advance } = await fixture(t, { intervalUnitMs: 20 }); seed(w, owner);
  await service.configure(owner.token, auth({ minutes: 10 })); w.accounts.logout(owner.token);
  for (let i = 0; i < 200; i++) { if ((await readdir(config.directory)).filter(f => f.endsWith('.wmbackup')).length >= 2) break; await delay(50); }
  assert.ok((await readdir(config.directory)).filter(f => f.endsWith('.wmbackup')).length >= 2);
  await service.close(); advance(); const login = await w.accounts.login({ login: 'owner', password });
  for (let i = 0; i < 200 && (await service.status(login.token)).busy; i++) await delay(20);
  for (let i = 0; i < 501; i++) w.accounts.backupEvent(login.token, 'started');
  const restarted = createBackupService(w, config); t.after(() => restarted.close());
  const state = await restarted.status(login.token); assert.equal(state.schedule, null); assert.equal(state.scheduleNeedsUnlock, true); assert.equal(state.automaticKeyPersisted, false); assert.ok(state.lastSuccess);
  const eventJson = JSON.stringify(w.accounts.securityHistory(login.token)); assert.equal(eventJson.includes(key), false); assert.equal(eventJson.includes(password), false);
});
test('HTTP protects backup routes and downloads encrypted bytes after reauthentication', async t => {
  const { w, owner, service } = await fixture(t); seed(w, owner);
  const { server } = createWorkspaceServer(w, { backupService: service }); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, csrf = (await (await fetch(base + '/api/session')).json()).csrf;
  assert.equal((await fetch(base + '/api/backups')).status, 401);
  const headers = { Cookie: `way_workspace=${owner.token}`, 'Content-Type': 'application/json', 'X-Way-Token': csrf };
  const created = await fetch(base + '/api/backups/create', { method: 'POST', headers, body: JSON.stringify(auth()) }); assert.equal(created.status, 200); const result = await created.json();
  const downloaded = await fetch(base + '/api/backups/download', { method: 'POST', headers, body: JSON.stringify(auth({ id: result.id })) }); assert.equal(downloaded.status, 200); assert.match(downloaded.headers.get('content-type'), /octet-stream/);
  const decoded = await backupWorker({ operation: 'decrypt', password: key, bytes: new Uint8Array(await downloaded.arrayBuffer()) }); assert.equal(decoded.stats.cash, 1);
});
test('writes during encryption remain usable and snapshot retains its own consistent point', async t => {
  const { w, owner, service } = await fixture(t); seed(w, owner);
  const copying = service.create(owner.token, auth());
  for (let i = 0; i < 200 && !(await service.status(owner.token)).busy; i++) await delay(10);
  assert.equal((await service.status(owner.token)).busy, true);
  w.taskSave(owner.token, { requestId: request(), expectedVersion: 0, title: 'Во время копирования', assigneeId: owner.user.id, status: 'open' });
  assert.equal(w.tasks(owner.token).length, 2);
  const copy = await copying; assert.equal(copy.stats.tasks, 1);
});
test('revoking owner authority during encryption prevents publishing the backup', async t => {
  const { w, owner, service, config } = await fixture(t); seed(w, owner);
  await w.accounts.createUser(owner.token, { login: 'second-owner', name: 'Второй владелец', password, role: 'owner' });
  const second = await w.accounts.login({ login: 'second-owner', password });
  const copying = service.create(owner.token, auth());
  // Attach rejection handler immediately while waiting for the background job.
  const rejected = assert.rejects(copying, /Войдите|полномочия/);
  for (let i = 0; i < 200 && !(await service.status(owner.token)).busy; i++) await delay(10);
  assert.equal((await service.status(owner.token)).busy, true);
  w.accounts.updateUser(second.token, { id: owner.user.id, expectedVersion: 1, name: owner.user.name, role: 'employee', active: true, reason: 'Отзыв полномочий во время копии' });
  await rejected;
  const files = await readdir(config.directory).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e));
  assert.deepEqual(files, []); assert.equal((await service.status(second.token)).lastSuccess, null);
});
test('backup works on filesystems without hard links and validates the copied bytes', async t => {
  const { owner, service } = await fixture(t, { linkFile: async () => { const e = new Error('Unsupported'); e.code = 'ENOTSUP'; throw e; } });
  const copy = await service.create(owner.token, auth());
  const checked = await service.verify(owner.token, auth({ id: copy.id })); assert.equal(checked.users, 1);
  assert.equal((await service.status(owner.token)).files.length, 1);
});
test('passive session and backup health checks do not keep an idle owner logged in', async t => {
  const { w, owner, service, advance } = await fixture(t);
  const { server } = createWorkspaceServer(w, { backupService: service }); server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: `way_workspace=${owner.token}` };
  for (let i = 0; i < 14; i++) { advance(); const status = await (await fetch(base + '/api/session', { headers })).json(); assert.equal(status.user.id, owner.user.id); assert.equal(status.backupHealth.hasSuccessfulCopy, false); }
  advance(); assert.equal((await (await fetch(base + '/api/session', { headers })).json()).user, null);
});
