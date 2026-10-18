import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openWorkspace, emptySheet } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { once } from 'node:events';

const password = 'Тестовая длинная фраза входа 123';
let w, owner, accountant, cashier, other, admin, employee, representative, server, base, csrf;
before(async () => {
  w = openWorkspace(':memory:');
  await w.accounts.bootstrapOwner({ login: 'owner', name: 'Владелец', password });
  owner = await w.accounts.login({ login: 'owner', password });
  const sessions = [];
  for (const [login, role, name] of [['accountant', 'accountant', 'Бухгалтер'], ['cashier', 'cashier', 'Кассир'], ['other', 'cashier', 'Другой кассир'], ['admin', 'administrator', 'Администратор'], ['employee', 'employee', 'Сотрудник'], ['representative', 'representative', 'Представитель']]) {
    await w.accounts.createUser(owner.token, { login, name, role, password }); sessions.push(await w.accounts.login({ login, password }));
  }
  [accountant, cashier, other, admin, employee, representative] = sessions;
  ({ server } = createWorkspaceServer(w)); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  csrf = (await (await fetch(base + '/api/session')).json()).csrf;
});
after(async () => { await new Promise(r => server.close(r)); w.close(); });
function sheet() {
  const input = emptySheet(); input.date = '2026-10-18'; input.shiftNo = randomUUID();
  for (const row of input.worksheet.settings.rows) input.worksheet.values[row.id] = row.enabled && row.id !== 'received' ? '0' : '';
  Object.assign(input.worksheet.values, { cashReport: '34000', cashViaTerminal: '1000', insertion: '4000', suppliers: '7500', payroll: '1000', card: '30000', qr: '20000', bluetooth: '7900', bankZ: '57900' });
  return input;
}
const submit = (input = sheet(), extras = {}) => ({ requestId: randomUUID(), expectedVersion: 0, accept: false, input, ...extras });
const task = (assigneeId = employee.user.id, extras = {}) => ({ requestId: randomUUID(), expectedVersion: 0, title: 'Проверить полку', assigneeId, status: 'open', ...extras });
async function http(path, data, session) {
  const headers = { ...(session ? { Cookie: `way_workspace=${session.token}` } : {}), ...(data ? { 'Content-Type': 'application/json', 'X-Way-Token': csrf } : {}) };
  return fetch(base + path, data ? { method: 'POST', headers, body: JSON.stringify(data) } : { headers });
}

test('workspace derives author and cashier from accounts and preserves exact cash math', () => {
  const p = submit(); p.input.author = 'Подмена'; p.input.cashier = 'Подмена';
  const saved = w.cashSave(cashier.token, p), record = w.cashGet(owner.token, saved.id);
  assert.equal(record.input.author, cashier.user.name); assert.equal(record.input.cashier, cashier.user.name);
  assert.equal(record.actorId, cashier.user.id); assert.equal(record.result.expected, 2250000);
  assert.equal(record.status, 'submitted'); assert.equal(record.result.received, null);
});
test('cashier cannot read other shifts, accept cash, forge received amount or submit for another', () => {
  const saved = w.cashSave(cashier.token, submit());
  assert.throws(() => w.cashGet(other.token, saved.id));
  assert.equal(w.cashList(other.token).some(r => r.id === saved.id), false);
  assert.throws(() => w.cashSave(cashier.token, submit(sheet(), { accept: true })));
  const input = sheet(); input.worksheet.values.received = '22500';
  assert.throws(() => w.cashSave(cashier.token, submit(input)), /бухгалтер/);
  assert.throws(() => w.cashSave(cashier.token, submit(sheet(), { cashierId: other.user.id })));
  for (const session of [admin, employee, representative]) assert.throws(() => w.cashList(session.token));
});
test('cash acceptance is independent; cashier projection never includes actual accountant receipt', () => {
  const saved = w.cashSave(cashier.token, submit()), record = w.cashGet(accountant.token, saved.id);
  record.input.worksheet.values.received = '22499.99';
  const p = submit(record.input, { id: saved.id, expectedVersion: 1, reason: 'Самостоятельный пересчёт', accept: true });
  const accepted = w.cashSave(accountant.token, p);
  const full = w.cashGet(accountant.token, saved.id), own = w.cashGet(cashier.token, saved.id);
  assert.equal(accepted.version, 2); assert.equal(full.result.receivedDifference, -1);
  assert.equal(full.actorId, accountant.user.id); assert.equal(full.cashierId, cashier.user.id);
  assert.equal(own.input.worksheet.values.received, ''); assert.equal(own.result.received, null); assert.equal(own.result.receivedDifference, null);
  assert.equal(w.cashGet(cashier.token, saved.id, true)[0].result.received, null);
  assert.throws(() => w.cashSave(cashier.token, submit(own.input, { id: saved.id, expectedVersion: 2, reason: 'Попытка' })));
  assert.equal(w.accounts.securityHistory(owner.token).filter(e => e.subject_id === saved.id).length, 2);
});
test('retries do not duplicate cash or audit; stale versions and duplicate physical shift are rejected', () => {
  const p = submit(), saved = w.cashSave(cashier.token, p);
  assert.deepEqual(w.cashSave(cashier.token, p), saved);
  assert.throws(() => w.cashSave(cashier.token, { ...p, requestId: randomUUID() }), /уже сохранены/);
  const input = w.cashGet(cashier.token, saved.id).input;
  assert.throws(() => w.cashSave(accountant.token, submit(input, { id: saved.id, expectedVersion: 0, reason: 'Неверная версия' })));
  assert.equal(w.accounts.securityHistory(owner.token).filter(e => e.subject_id === saved.id).length, 1);
  assert.throws(() => w.cashSave(other.token, p));
});
test('employee and representative can act only on assigned tasks; administrator has no financial task access', () => {
  const saved = w.taskSave(admin.token, task());
  const assigned = w.tasks(employee.token).find(t => t.id === saved.id);
  assert.ok(assigned); assert.equal(w.tasks(representative.token).some(t => t.id === saved.id), false);
  assert.throws(() => w.taskSave(representative.token, { ...assigned, expectedVersion: 1, requestId: randomUUID(), status: 'done' }));
  assert.throws(() => w.taskSave(employee.token, { ...assigned, title: 'Подмена', expectedVersion: 1, requestId: randomUUID() }));
  const complete = { ...assigned, expectedVersion: 1, requestId: randomUUID(), status: 'done' };
  assert.equal(w.taskSave(employee.token, complete).version, 2);
  assert.equal(w.taskSave(employee.token, complete).version, 2);
  assert.throws(() => w.taskSave(employee.token, { ...complete, requestId: randomUUID() }), /изменена/);
  const cash = w.cashSave(cashier.token, submit());
  const financial = w.taskSave(accountant.token, task(cashier.user.id, { relatedCash: cash.id, title: 'Уточните сдачу' }));
  assert.equal(w.tasks(admin.token).some(t => t.id === financial.id), false);
  assert.throws(() => w.taskSave(accountant.token, task(admin.user.id, { relatedCash: cash.id })));
});
test('catalog can be edited by administrator; roles get only public product fields, prices in kopecks', () => {
  const p = { requestId: randomUUID(), expectedVersion: 0, name: '<script>Товар</script>', barcode: '123456789', price: '12.34', active: true };
  const saved = w.productSave(admin.token, p); assert.deepEqual(w.productSave(admin.token, p), saved);
  for (const session of [cashier, employee, representative]) {
    const product = w.products(session.token).find(p => p.id === saved.id); assert.equal(product.price, 1234);
    assert.deepEqual(Object.keys(product).sort(), ['active', 'barcode', 'id', 'name', 'price', 'version']);
    assert.throws(() => w.productSave(session.token, { ...p, requestId: randomUUID() }));
  }
});
test('HTTP requires cookie authentication and CSRF; legacy routes and database paths are inaccessible', async () => {
  assert.equal((await http('/api/cash')).status, 401);
  assert.equal((await http('/api/users', undefined, employee)).status, 403);
  assert.equal((await http('/api/cash', undefined, admin)).status, 403);
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', headers: { Cookie: `way_workspace=${owner.token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'https://example.org' } })).status, 403);
  for (const path of ['/advanced.html', '/api/shifts', '/workspace-test.sqlite', '/accounts.mjs']) assert.equal((await http(path, undefined, owner)).status, 404);
  const login = await http('/api/login', { login: 'owner', password }); assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await login.json()).token, undefined);
});
test('HTTP logout revokes cookie and password change revokes all existing sessions', async () => {
  const session = await w.accounts.login({ login: 'employee', password });
  assert.equal((await http('/api/logout', {}, session)).status, 200);
  assert.equal((await http('/api/products', undefined, session)).status, 401);
  const old = representative;
  await w.accounts.changePassword(old.token, { currentPassword: password, password: password + ' новый' });
  assert.throws(() => w.accounts.session(old.token));
  const fresh = await w.accounts.login({ login: 'representative', password: password + ' новый' }); assert.equal(fresh.user.id, old.user.id);
});
