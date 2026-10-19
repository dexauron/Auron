import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { openWorkspace } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { makeWorkspaceArchive, validateWorkspaceArchive } from './workspace-archive.mjs';
import { backupWorker } from './workspace-backups.mjs';
import { quantity, lineAmount } from './procurement-data.mjs';
const password = 'Пароль испытания закупок 12345';
let w, owner, accountant, others = [], server, base, csrf;
const command = (kind, extra = {}) => ({ kind, requestId: randomUUID(), expectedVersion: 0, ...extra });
const save = p => w.procurementSave(owner.token, p);
const read = () => w.procurement(owner.token);
before(async () => {
  w = openWorkspace(':memory:'); await w.accounts.bootstrapOwner({ login: 'owner', name: 'Владелец', password }); owner = await w.accounts.login({ login: 'owner', password });
  for (const role of ['accountant', 'administrator', 'cashier', 'employee', 'representative']) {
    await w.accounts.createUser(owner.token, { login: role, name: role, role, password }); const s = await w.accounts.login({ login: role, password }); if (role === 'accountant') accountant = s; else others.push(s);
  }
  ({ server } = createWorkspaceServer(w)); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; csrf = (await (await fetch(base + '/api/session')).json()).csrf;
});
after(async () => { await new Promise(r => server.close(r)); w.close(); });
function seed({ amount = '1000', quantity: q = '10', price = '10' } = {}) {
  const supplier = save(command('supplier', { name: 'Поставщик', contact: '', terms: 'Отсрочка 7 дней', active: true }));
  const budget = save(command('budget', { name: 'Закупки', scope: 'Магазин', start: '2026-10-01', end: '2026-10-31', amount }));
  const product = w.productSave(owner.token, { requestId: randomUUID(), expectedVersion: 0, name: 'Молоко', barcode: '', price: '90', active: true });
  const line = { id: randomUUID(), productId: product.id, unit: 'шт', quantity: q, price };
  const orderPayload = command('order', { supplierId: supplier.id, budgetId: budget.id, date: '2026-10-19', status: 'open', lines: [line] });
  const order = save(orderPayload);
  const receipt = (q = '4', price = '11', extra = {}) => command('receipt', { orderId: order.id, orderVersion: order.version, number: randomUUID(), date: '2026-10-20', final: false, note: 'Изменение цены', lines: [{ lineId: line.id, quantity: q, price }], ...extra });
  return { supplier, budget, product, line, order, orderPayload, receipt };
}
function budgetFor(f) { return read().budgets.find(x => x.id === f.budget.id); }
function orderFor(f) { return read().orders.find(x => x.id === f.order.id); }
test('decimal quantities and kopecks round once without floating point accumulation', () => {
  assert.equal(quantity('0,125'), 125); assert.equal(lineAmount(125, 199), 25); assert.equal(lineAmount(1, 500), 1);
  for (const v of ['0', '-1', '1.0001', '1e3', 1, '9999999']) assert.throws(() => quantity(v));
  assert.throws(() => lineAmount(999999999, 99999999999));
});
test('partial receipt replaces only corresponding reserve by actual invoice amount', () => {
  const f = seed(); assert.equal(budgetFor(f).reserved, 10000);
  save(f.receipt()); const b = budgetFor(f); assert.equal(b.used, 4400); assert.equal(b.reserved, 6000); assert.equal(b.available, 89600);
  assert.equal(orderFor(f).lines[0].remaining, 6000); assert.equal(w.cashList(owner.token).length, 0);
});
test('fractional split receipts release rounding residue precisely', () => {
  const f = seed({ quantity: '0.003', price: '5' });
  assert.equal(budgetFor(f).reserved, 2);
  save(f.receipt('0.001', '5')); assert.equal(budgetFor(f).reserved, 1);
  save(f.receipt('0.001', '5')); assert.equal(budgetFor(f).reserved, 1);
  save(f.receipt('0.001', '5')); assert.equal(budgetFor(f).reserved, 0);
  assert.equal(budgetFor(f).used, 3); // three invoices each round their own factual line
});
test('final partial receipt releases remaining reserve and opens shortage discrepancy', () => {
  const f = seed(); const r = save(f.receipt('4', '10', { final: true, note: 'Недовоз, больше не ожидаем' }));
  assert.equal(orderFor(f).closed, true); assert.equal(budgetFor(f).reserved, 0); assert.equal(budgetFor(f).used, 4000);
  assert.equal(read().receipts.find(x => x.id === r.id).discrepancies.find(x => x.kind === 'shortage').quantity, 6000);
  assert.throws(() => save(f.receipt('1', '10')), /закрыт/);
});
test('budget overspend rolls back receipt, audit and retry; increase budget and retry succeeds', () => {
  const f = seed({ amount: '100' }), p = f.receipt('4', '11'); const events = w.accounts.securityHistory(owner.token).length;
  assert.throws(() => save(p), /лимита/); assert.equal(orderFor(f).receiptIds.length, 0); assert.equal(w.accounts.securityHistory(owner.token).length, events);
  save(command('budget', { id: f.budget.id, expectedVersion: 1, name: 'Закупки', scope: 'Магазин', start: '2026-10-01', end: '2026-10-31', amount: '104', reason: 'Согласована новая цена' }));
  save(p); assert.equal(budgetFor(f).available, 0);
});
test('idempotency is actor-bound and stale revisions are rejected', () => {
  const f = seed(), p = f.receipt(), r = save(p); assert.deepEqual(save(p), r); assert.equal(orderFor(f).receiptIds.length, 1);
  assert.throws(() => w.procurementSave(accountant.token, p), /идентификатор|Идентификатор/);
  const edit = { ...f.orderPayload, id: f.order.id, expectedVersion: 0, requestId: randomUUID(), reason: 'Уточнение' }; assert.throws(() => save(edit), /изменён/);
  assert.throws(() => save({ ...p, lines: [{ ...p.lines[0], quantity: '3' }] }), /Идентификатор/);
});
test('receipt refuses a changed order snapshot and malformed lines without side effects', () => {
  const f = seed(), p = f.receipt();
  save({ ...f.orderPayload, id: f.order.id, expectedVersion: 1, requestId: randomUUID(), reason: 'Уточнили количество', lines: [{ ...f.line, quantity: '12' }] });
  assert.throws(() => save(p), /Заказ изменён/);
  assert.throws(() => save({ ...p, orderVersion: 2, lines: [null] }), /позиции/);
  assert.equal(orderFor(f).receiptIds.length, 0);
});
test('duplicate invoice number, excess quantity and unknown lines fail atomically', () => {
  const f = seed(); save(f.receipt('2', '10', { number: 'АБ-1' }));
  assert.throws(() => save(f.receipt('2', '10', { number: 'аб-1' })));
  assert.throws(() => save(f.receipt('9', '10')));
  assert.throws(() => save(f.receipt('1', '10', { lines: [{ lineId: randomUUID(), quantity: '1', price: '10' }] })));
  assert.equal(orderFor(f).receiptIds.length, 1);
});
test('several orders cannot share a supplier invoice number', () => {
  const f = seed(); save(f.receipt('2', '10', { number: 'ОДНА' }));
  const second = save({ ...f.orderPayload, requestId: randomUUID() });
  assert.throws(() => save(f.receipt('2', '10', { number: 'ОДНА', orderId: second.id })));
});
test('receipts are immutable and order edits lock after receiving; explicit close releases remainder', () => {
  const f = seed(), p = f.receipt(), r = save(p);
  assert.throws(() => save({ ...p, id: r.id, expectedVersion: 1, requestId: randomUUID(), reason: 'Изменение' }), /неизменяема/);
  assert.throws(() => save({ ...f.orderPayload, id: f.order.id, expectedVersion: 1, requestId: randomUUID(), reason: 'Цена', lines: [{ ...f.line, price: '12' }] }), /только закрыть/);
  save({ ...f.orderPayload, id: f.order.id, expectedVersion: 1, requestId: randomUUID(), reason: 'Отмена остатка', status: 'closed' });
  assert.equal(budgetFor(f).reserved, 0); assert.equal(budgetFor(f).used, 4400);
});
test('review resolution retains receipt amounts and can be reopened with reason', () => {
  const f = seed(), r = save(f.receipt()), before = budgetFor(f);
  const p = command('review', { receiptId: r.id, state: 'resolved', explanation: 'Цена подтверждена', reason: 'Проверено по документу' }), review = save(p);
  save({ ...p, id: review.id, expectedVersion: 1, requestId: randomUUID(), state: 'open', reason: 'Новые сведения' });
  assert.deepEqual(budgetFor(f), before); assert.equal(read().reviews.find(x => x.id === review.id).data.state, 'open');
  assert.throws(() => save({ ...p, requestId: randomUUID() }), /уже создан/);
});
test('only owner sets limits; operational roles cannot read procurement through lists/history/HTTP', async () => {
  const f = seed(); assert.equal(w.procurement(accountant.token).suppliers.length > 0, true);
  assert.throws(() => w.procurementSave(accountant.token, command('budget', { amount: '1' })));
  for (const s of others) {
    assert.throws(() => w.procurement(s.token)); assert.throws(() => w.procurementHistory(s.token, f.order.id)); assert.throws(() => w.procurementSave(s.token, f.receipt()));
    for (const path of ['/api/procurement', `/api/procurement/history/${f.order.id}`]) assert.equal((await fetch(base + path, { headers: { Cookie: `way_workspace=${s.token}` } })).status, 403);
  }
  const response = await fetch(base + '/api/procurement', { method: 'POST', headers: { Cookie: `way_workspace=${accountant.token}`, 'Content-Type': 'application/json', 'X-Way-Token': csrf }, body: JSON.stringify(command('budget', { amount: '1' })) }); assert.equal(response.status, 403);
});
test('archive v3 recalculates procurement and rejects tampered links, audit, quantities and lost requests', () => {
  const f = seed(); save(f.receipt());
  const archive = makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token)); assert.equal(archive.version, 3);
  for (const mutate of [
    a => { a.tables.workspace_procurement.find(x => x.id === f.order.id).data = JSON.stringify({ ...orderFor(f).data, budgetId: randomUUID() }); },
    a => { a.tables.workspace_requests = a.tables.workspace_requests.filter(x => x.id !== f.orderPayload.requestId); },
    a => { a.tables.account_events = a.tables.account_events.filter(x => x.subject_id !== f.order.id); },
    a => { const row = a.tables.workspace_procurement.find(x => x.id === f.budget.id); const d = JSON.parse(row.data); d.amount = 0; row.data = JSON.stringify(d); }
  ]) {
    const changed = structuredClone(archive); mutate(changed); const { digest, ...payload } = changed; changed.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); assert.throws(() => validateWorkspaceArchive(changed));
  }
});
test('encrypted backup restores procurement history, computed reserve and idempotency in a new database', async () => {
  const f = seed(), p = f.receipt(); const r = save(p), original = read();
  const key = 'Отдельная фраза копии закупок 123';
  const encrypted = await backupWorker({ operation: 'encrypt', password: key, tables: w.accounts.workspaceSnapshot(owner.token) });
  const { archive, stats } = await backupWorker({ operation: 'decrypt', password: key, bytes: encrypted.bytes }); assert.equal(stats.receipts, original.receipts.length);
  const restored = openWorkspace(':memory:');
  try { restored.accounts.restoreWorkspace(archive, owner.user.id); assert.throws(() => restored.procurement(owner.token)); const s = await restored.accounts.login({ login: 'owner', password }); assert.deepEqual(restored.procurement(s.token), original); assert.deepEqual(restored.procurementSave(s.token, p), r); }
  finally { restored.close(); }
});
test('legacy archives v1/v2 restore without invented procurement documents', () => {
  for (const version of [1, 2]) {
    const empty = structuredClone(makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token)));
    empty.version = version; empty.tables.workspace_procurement = []; delete empty.tables.workspace_procurement;
    empty.tables.workspace_requests = []; empty.tables.workspace_products = [];
    empty.tables.account_events = empty.tables.account_events.filter(e => !e.kind.startsWith('procurement.') && e.kind !== 'product.changed');
    if (version === 1) delete empty.tables.workspace_drafts;
    const { digest, ...payload } = empty; empty.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); assert.equal(validateWorkspaceArchive(empty).orders, 0);
  }
});
