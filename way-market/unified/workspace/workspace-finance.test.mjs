import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { openWorkspace, emptySheet } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { makeWorkspaceArchive, validateWorkspaceArchive } from './workspace-archive.mjs';
import { backupWorker } from './workspace-backups.mjs';
const password = 'Испытания финансов длинная фраза 123';
let w, owner, accountant, restricted = [], server, base, csrf;
const cmd = (kind, data = {}) => ({ kind, expectedVersion: 0, requestId: randomUUID(), refVersions: {}, ...data });
const save = p => w.financeSave(owner.token, p);
const state = () => w.finance(owner.token);
const find = (kind, id) => state()[{ account: 'accounts', obligation: 'obligations', plan: 'plans', movement: 'movements', reversal: 'reversals' }[kind]].find(x => x.id === id);
const refs = (...docs) => Object.fromEntries(docs.map(d => [d.id, d.version]));
before(async () => {
  w = openWorkspace(':memory:'); await w.accounts.bootstrapOwner({ login: 'owner', name: 'Владелец', password }); owner = await w.accounts.login({ login: 'owner', password });
  for (const role of ['accountant', 'administrator', 'cashier', 'employee', 'representative']) { await w.accounts.createUser(owner.token, { login: role, name: role, role, password }); const s = await w.accounts.login({ login: role, password }); if (role === 'accountant') accountant = s; else restricted.push(s); }
  ({ server } = createWorkspaceServer(w)); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; csrf = (await (await fetch(base + '/api/session')).json()).csrf;
});
after(async () => { await new Promise(r => server.close(r)); w.close(); });
const account = (data = {}) => save(cmd('account', { name: 'Касса магазина', type: 'cash', openingDate: '2026-10-01', openingBalance: '1000', active: true, ...data }));
const debt = (data = {}) => save(cmd('obligation', { direction: 'payable', party: 'Поставщик', supplierId: null, receiptId: null, amount: '100', date: '2026-10-18', dueDate: '2026-10-25', basis: 'Ручное основание № 1', status: 'open', ...data }));
const movement = (a, data = {}) => cmd('movement', { type: 'outflow', accountId: a.id, amount: '10', date: '2026-10-19', purpose: 'Хозяйственная покупка', evidence: 'Чек № 1', confirmed: true, refVersions: refs(a), ...data });
const plan = (a, o, data = {}) => save(cmd('plan', { accountId: a.id, obligationId: o.id, amount: '60', date: '2026-10-25', status: 'scheduled', note: 'Согласованный срок', refVersions: refs(a, o), ...data }));
const settle = (a, o, data = {}) => movement(a, { type: 'settlement', obligationId: o.id, amount: '40', purpose: 'Оплата долга', refVersions: refs(a, o), ...data });
const reverse = (m, data = {}) => save(cmd('reversal', { movementId: m.id, date: '2026-10-19', reason: 'Запись внесена ошибочно, движения не было', confirmed: true, refVersions: refs(m), ...data }));
function receiptFixture() {
  const supplier = w.procurementSave(owner.token, cmd('supplier', { name: 'Поставщик накладной', contact: '', terms: '', active: true }));
  const budget = w.procurementSave(owner.token, cmd('budget', { name: 'Лимит', scope: 'Магазин', start: '2026-10-01', end: '2026-10-31', amount: '1000' }));
  const product = w.productSave(owner.token, { requestId: randomUUID(), expectedVersion: 0, name: 'Товар', barcode: '', price: '90', active: true }), lineId = randomUUID();
  const order = w.procurementSave(owner.token, cmd('order', { supplierId: supplier.id, budgetId: budget.id, date: '2026-10-18', status: 'open', lines: [{ id: lineId, productId: product.id, unit: 'шт', quantity: '10', price: '10' }] }));
  const receipt = w.procurementSave(owner.token, cmd('receipt', { orderId: order.id, orderVersion: 1, number: randomUUID(), date: '2026-10-19', final: false, note: '', lines: [{ lineId, quantity: '4', price: '10' }] }));
  return { supplier, budget, order, receipt, obligation: cmd('obligation', { receiptId: receipt.id, receiptVersion: 1, dueDate: '2026-10-26', basis: 'Проверенная накладная', status: 'open' }) };
}
function acceptedCash() {
  const input = emptySheet(); input.date = '2026-10-19'; input.shiftNo = randomUUID();
  for (const row of input.worksheet.settings.rows) input.worksheet.values[row.id] = row.enabled ? '0' : '';
  Object.assign(input.worksheet.values, { cashReport: '100', received: '100' });
  const cash = w.cashSave(owner.token, { requestId: randomUUID(), expectedVersion: 0, accept: true, input });
  return { cash, input };
}
test('opening balances, exact kopeck inflow/outflow and two-account transfer do not create profit', () => {
  const a = account(), bank = account({ name: 'Банк', type: 'bank', openingBalance: '20' });
  save(movement(a, { type: 'inflow', amount: '0.01' })); save(movement(a, { amount: '0.02' }));
  save(movement(a, { type: 'transfer', toAccountId: bank.id, amount: '100', refVersions: refs(a, bank) }));
  assert.equal(find('account', a.id).balance, 89999); assert.equal(find('account', bank.id).balance, 12000);
  assert.equal(find('account', a.id).balance + find('account', bank.id).balance, 101999);
  assert.throws(() => save(movement(a, { type: 'transfer', toAccountId: a.id })), /разных/);
});
test('receipt confirmation derives supplier and actual amount once, without creating money movement', () => {
  const f = receiptFixture(), before = state().movements.length, o = save({ ...f.obligation, amount: '999999', supplierId: randomUUID(), party: 'Подмена' });
  assert.equal(find('obligation', o.id).data.amount, 4000); assert.equal(find('obligation', o.id).data.supplierId, f.supplier.id); assert.equal(state().movements.length, before);
  assert.throws(() => save({ ...f.obligation, requestId: randomUUID() }), /уже подтверждено/);
  assert.equal(w.procurement(owner.token).budgets.find(x => x.id === f.budget.id).reserved, 6000);
});
test('partial supplier payments reduce debt only once and leave procurement budget untouched', () => {
  const f = receiptFixture(), a = account(), o = save(f.obligation), before = w.procurement(owner.token), p = settle(a, o, { amount: '15.01' });
  const saved = save(p); assert.deepEqual(save(p), saved); assert.equal(find('obligation', o.id).remaining, 2499); assert.equal(find('account', a.id).balance, 98499);
  assert.deepEqual(w.procurement(owner.token), before);
  assert.throws(() => save(settle(a, o, { amount: '25' })), /превышает остаток долга/);
  save(settle(a, o, { amount: '24.99' })); assert.equal(find('obligation', o.id).remaining, 0);
});
test('payment plans change no balance and support partial execution and cancellation of remainder', () => {
  const a = account(), o = debt(), p = plan(a, o); assert.equal(find('account', a.id).balance, 100000); assert.equal(find('obligation', o.id).paid, 0);
  save(settle(a, o, { planId: p.id, amount: '20', refVersions: refs(a, o, p) })); assert.equal(find('plan', p.id).remaining, 4000); assert.equal(find('obligation', o.id).remaining, 8000);
  const old = find('plan', p.id); save(cmd('plan', { ...old.data, id: p.id, expectedVersion: 1, amount: '60', status: 'cancelled', reason: 'Остаток перенесён на новый срок', refVersions: refs(a, o) }));
  assert.equal(find('obligation', o.id).planned, 0); assert.equal(find('account', a.id).balance, 98000);
  assert.throws(() => save(settle(a, o, { planId: p.id, refVersions: refs(a, o, { id: p.id, version: 2 }) })), /закрыт/);
});
test('unplanned actual payment flags stale excess plans, while creating an excessive plan is rejected', () => {
  const a = account(), o = debt(), p = plan(a, o, { amount: '100' });
  assert.throws(() => plan(a, o, { amount: '1' }), /Назначения превышают/);
  save(settle(a, o, { amount: '40' })); assert.equal(find('obligation', o.id).overplanned, true); assert.equal(find('plan', p.id).remaining, 10000);
});
test('receivable settlement increases funds instead of paying a supplier', () => {
  const a = account(), o = debt({ direction: 'receivable', party: 'Должник магазина' }); save(settle(a, o));
  assert.equal(find('account', a.id).balance, 104000); assert.equal(find('obligation', o.id).remaining, 6000);
});
test('reversal appends an inverse journal entry, reopens debt and does not claim physical refund', () => {
  const a = account(), o = debt(), p = settle(a, o, { amount: '100' }), m = save(p); assert.equal(find('obligation', o.id).remaining, 0);
  const r = reverse(m); assert.equal(find('account', a.id).balance, 100000); assert.equal(find('obligation', o.id).remaining, 10000); assert.equal(find('movement', m.id).reversedBy, r.id);
  assert.deepEqual(save(p), m); assert.equal(find('account', a.id).balance, 100000);
  assert.throws(() => reverse(m), /уже скорректирована/);
  assert.throws(() => save({ ...p, id: m.id, expectedVersion: 1, requestId: randomUUID(), reason: 'Перезаписать' }), /неизменяема/);
});
test('dated reports retain original movement in its period and inverse correction in the next period', () => {
  const a = account(), m = save(movement(a, { amount: '10', date: '2026-10-18' })); reverse(m);
  const first = w.financeReport(owner.token, '2026-10-18', '2026-10-18').accounts.find(x => x.id === a.id), second = w.financeReport(owner.token, '2026-10-19', '2026-10-19').accounts.find(x => x.id === a.id);
  assert.equal(first.opening, 100000); assert.equal(first.outgoing, 1000); assert.equal(first.closing, 99000);
  assert.equal(second.opening, 99000); assert.equal(second.incoming, 1000); assert.equal(second.closing, 100000);
  assert.throws(() => w.financeReport(owner.token, '2026-02-30', '2026-10-01'));
});
test('account introduced during report period is not shown as operating inflow', () => {
  const a = account({ openingDate: '2026-10-18', openingBalance: '50' });
  const report = w.financeReport(owner.token, '2026-10-01', '2026-10-19').accounts.find(x => x.id === a.id);
  assert.equal(report.opening, 0); assert.equal(report.introduced, 5000); assert.equal(report.incoming, 0); assert.equal(report.closing, 5000);
});
test('negative funds require explanation and remain a visible discrepancy instead of hiding a fact', () => {
  const a = account({ openingBalance: '0' }), p = movement(a, { amount: '10' }), count = state().movements.length;
  assert.throws(() => save(p), /отрицательный остаток/); assert.equal(state().movements.length, count);
  save({ ...p, reason: 'Начальный остаток неполон, покупка фактически состоялась' }); assert.equal(find('account', a.id).negative, true); assert.equal(find('account', a.id).balance, -1000);
});
test('opening data locks after any movement, including reversed; archived account keeps funds', () => {
  const a = account(), m = save(movement(a)); reverse(m); const old = find('account', a.id);
  assert.throws(() => save(cmd('account', { ...old.data, id: a.id, expectedVersion: 1, openingBalance: '2000', reason: 'Подмена остатка' })), /неизменяемы/);
  const disabled = save(cmd('account', { ...old.data, id: a.id, expectedVersion: 1, openingBalance: '1000', active: false, reason: 'Не использовать' }));
  assert.equal(find('account', a.id).balance, 100000); assert.throws(() => save(movement(disabled)), /закрыт/);
});
test('scheduled plan prevents account deactivation and paid obligation cannot be cancelled', () => {
  const a = account(), o = debt(); plan(a, o); const ad = find('account', a.id);
  assert.throws(() => save(cmd('account', { ...ad.data, id: a.id, expectedVersion: 1, openingBalance: '1000', active: false, reason: 'Закрыть' })), /назначения/);
  save(settle(a, o, { amount: '10' })); const od = find('obligation', o.id);
  assert.throws(() => save(cmd('obligation', { ...od.data, id: o.id, expectedVersion: 1, amount: '100', status: 'cancelled', reason: 'Ошибка' })));
});
test('stale source revisions, actor-switched retries and unrelated links are rejected', () => {
  const a = account(), p = movement(a), old = find('account', a.id); save(cmd('account', { ...old.data, id: a.id, expectedVersion: 1, name: 'Новое имя', openingBalance: '1000', reason: 'Переименовали' }));
  assert.throws(() => save(p), /Связанные данные изменились/);
  const fresh = { ...p, refVersions: refs({ id: a.id, version: 2 }) }, saved = save(fresh); assert.deepEqual(save(fresh), saved);
  assert.throws(() => w.financeSave(accountant.token, fresh), /Идентификатор/);
  assert.throws(() => save(movement({ id: a.id, version: 2 }, { obligationId: randomUUID() })), /основание/);
});
test('independent commands with the same account operation reference cannot duplicate a fact', () => {
  const a = account(), p = movement(a, { reference: 'ПЛ-001' }), m = save(p);
  assert.throws(() => save({ ...p, requestId: randomUUID(), reference: 'пл-001' }), /Номер операции уже/);
  const other = account(); save(movement(other, { reference: 'ПЛ-001' }));
  reverse(m); save({ ...p, requestId: randomUUID() }); assert.equal(find('account', a.id).balance, 99000);
});
test('future actual movements, invalid amounts, missing fact confirmation and bad references fail atomically', () => {
  const a = account(), count = state().movements.length;
  for (const extra of [{ amount: '' }, { amount: '0' }, { amount: '-1' }, { amount: '1.001' }, { amount: 1 }, { date: '2099-01-01' }, { confirmed: false }, { evidence: '' }, { accountId: randomUUID() }, { cashId: {} }, { id: [] }]) assert.throws(() => save(movement(a, extra)));
  assert.equal(state().movements.length, count);
});
test('cash handover records actual receipt once and blocks changing it until explicit reversal', () => {
  const a = account(), { cash, input } = acceptedCash(), p = movement(a, { type: 'cash_handover', cashId: cash.id, cashVersion: cash.version, amount: '100', purpose: 'Сдача кассира' });
  const m = save(p); assert.deepEqual(save(p), m); assert.equal(find('account', a.id).balance, 110000);
  assert.throws(() => save({ ...p, requestId: randomUUID() }), /уже отражена/);
  const changed = structuredClone(input); changed.worksheet.values.received = '90';
  const edit = { requestId: randomUUID(), id: cash.id, expectedVersion: 1, accept: true, input: changed, reason: 'Пересчёт' };
  assert.throws(() => w.cashSave(owner.token, edit), /Сдача изменена/); assert.equal(w.cashGet(owner.token, cash.id).version, 1);
  reverse(m); const v2 = w.cashSave(owner.token, edit); assert.equal(v2.version, 2);
  save({ ...p, requestId: randomUUID(), cashVersion: 2, amount: '90' }); assert.equal(find('account', a.id).balance, 109000);
});
test('only owner manages account setup and corrections; other staff cannot read financial routes or reports', async () => {
  const a = account(); w.financeSave(accountant.token, movement(a)); assert.throws(() => w.financeSave(accountant.token, cmd('account', {})));
  const m = save(movement(a)); assert.throws(() => w.financeSave(accountant.token, cmd('reversal', { movementId: m.id })));
  for (const s of restricted) {
    assert.throws(() => w.finance(s.token)); assert.throws(() => w.financeHistory(s.token, a.id)); assert.throws(() => w.financeReport(s.token, '2026-10-01', '2026-10-19'));
    for (const path of ['/api/finance', '/api/finance/report?start=2026-10-01&end=2026-10-19', `/api/finance/history/${a.id}`]) assert.equal((await fetch(base + path, { headers: { Cookie: `way_workspace=${s.token}` } })).status, 403);
  }
  const headers = { Cookie: `way_workspace=${owner.token}`, 'Content-Type': 'application/json', 'X-Way-Token': csrf };
  assert.equal((await fetch(base + '/api/finance', { method: 'POST', headers: { ...headers, 'X-Way-Token': '' }, body: JSON.stringify(movement(a)) })).status, 403);
  assert.equal((await fetch(base + '/api/finance/report?start=bad&end=bad', { headers })).status, 400);
});
test('bank reconciliation compares signed statement lines without creating money twice', () => {
  const source = account(), bank = account({ type: 'bank', name: 'Банк сверки' });
  const transfer = save(movement(source, { type: 'transfer', toAccountId: bank.id, amount: '100', refVersions: refs(source, bank) }));
  const before = find('account', bank.id).balance;
  const payload = cmd('bank_line', { accountId: bank.id, reference: 'ВЫП-001', date: '2026-10-19', direction: 'in', amount: '100', movementId: transfer.id, note: '', refVersions: refs(bank, transfer) });
  const line = save(payload); assert.equal(state().bankLines.find(x => x.id === line.id).status, 'matched'); assert.equal(find('account', bank.id).balance, before);
  assert.throws(() => save({ ...payload, requestId: randomUUID(), reference: 'вып-001' }), /Повтор строки/);
  assert.throws(() => save({ ...payload, requestId: randomUUID(), reference: 'ВЫП-002' }), /уже сопоставлено/);
  reverse(transfer); assert.equal(state().bankLines.find(x => x.id === line.id).status, 'needs_review');
});
test('bank discrepancies retain actual source amount and reject matching another account', () => {
  const bank = account({ type: 'bank' }), other = account(), m = save(movement(bank, { amount: '10' }));
  const line = save(cmd('bank_line', { accountId: bank.id, reference: 'РАЗН-1', date: '2026-10-19', direction: 'out', amount: '11', movementId: m.id, note: 'Проверить комиссию', refVersions: refs(bank, m) }));
  const saved = state().bankLines.find(x => x.id === line.id); assert.equal(saved.status, 'amount_difference'); assert.equal(saved.difference, -100); assert.equal(find('account', bank.id).balance, 99000);
  const alien = save(movement(other)); assert.throws(() => save(cmd('bank_line', { accountId: bank.id, reference: 'РАЗН-2', date: '2026-10-19', direction: 'out', amount: '10', movementId: alien.id, note: '', refVersions: refs(bank, alien) })), /не относится/);
});
test('bank line preserves source and permits audited rematching; date mismatch remains visible', () => {
  const bank = account({ type: 'bank' }), m = save(movement(bank, { amount: '10', date: '2026-10-18' }));
  const p = cmd('bank_line', { accountId: bank.id, reference: 'ДАТА-1', date: '2026-10-19', direction: 'out', amount: '10', movementId: null, note: '', refVersions: refs(bank) }), line = save(p);
  save({ ...p, id: line.id, expectedVersion: 1, requestId: randomUUID(), movementId: m.id, reason: 'Сопоставили по документу', refVersions: refs(bank, m) }); assert.equal(state().bankLines.find(x => x.id === line.id).status, 'date_difference');
  assert.throws(() => save({ ...p, id: line.id, expectedVersion: 2, requestId: randomUUID(), amount: '9', reason: 'Скрыть разницу' }), /неизменяемы/);
  save({ ...p, id: line.id, expectedVersion: 2, requestId: randomUUID(), status: 'cancelled', reason: 'Ошибочно переписали дату' });
  const replacement = save({ ...p, requestId: randomUUID(), date: '2026-10-18', movementId: m.id, refVersions: refs(bank, m) }); assert.equal(state().bankLines.find(x => x.id === replacement.id).status, 'matched');
});
test('simultaneous HTTP commands cannot settle the same outstanding amount twice', async () => {
  const a = account(), o = debt(), headers = { Cookie: `way_workspace=${accountant.token}`, 'Content-Type': 'application/json', 'X-Way-Token': csrf };
  const responses = await Promise.all([1, 2].map(() => fetch(base + '/api/finance', { method: 'POST', headers, body: JSON.stringify(settle(a, o, { amount: '100' })) })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]); assert.equal(find('obligation', o.id).remaining, 0); assert.equal(find('account', a.id).balance, 90000);
});
test('archive v4 validates financial links, audit, retries and recalculated balances', () => {
  const standalone = account({ name: 'Отдельный счёт для проверки аудита' });
  const archive = makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token)); assert.equal(archive.version, 5);
  for (const mutate of [
    a => { a.tables.workspace_finance = a.tables.workspace_finance.filter(d => d.id !== standalone.id); a.tables.workspace_requests = a.tables.workspace_requests.filter(r => JSON.parse(r.result).id !== standalone.id); },
    a => { const m = a.tables.workspace_finance.find(x => x.kind === 'movement'), d = JSON.parse(m.data); d.accountId = randomUUID(); m.data = JSON.stringify(d); },
    a => { const m = a.tables.workspace_finance.find(x => x.kind === 'movement'); a.tables.account_events = a.tables.account_events.filter(e => e.subject_id !== m.id); },
    a => { a.tables.workspace_requests = []; },
    a => { const m = a.tables.workspace_finance.find(x => x.kind === 'reversal'), d = JSON.parse(m.data); d.movementId = randomUUID(); m.data = JSON.stringify(d); }
  ]) { const invalid = structuredClone(archive); mutate(invalid); const { digest, ...payload } = invalid; invalid.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); assert.throws(() => validateWorkspaceArchive(invalid)); }
});
test('encrypted restore preserves balances, debt, plans, corrections and retry results but not sessions', async () => {
  const a = account(), o = debt(), p = plan(a, o), command = settle(a, o, { planId: p.id, refVersions: refs(a, o, p) }), m = save(command), original = state();
  const key = 'Отдельный пароль финансовой копии 123';
  const encrypted = await backupWorker({ operation: 'encrypt', password: key, tables: w.accounts.workspaceSnapshot(owner.token) });
  const { archive, stats } = await backupWorker({ operation: 'decrypt', password: key, bytes: encrypted.bytes }); assert.equal(stats.moneyAccounts, original.accounts.length);
  const restored = openWorkspace(':memory:');
  try { restored.accounts.restoreWorkspace(archive, owner.user.id); assert.throws(() => restored.finance(owner.token)); const s = await restored.accounts.login({ login: 'owner', password }); assert.deepEqual(restored.finance(s.token), original); assert.deepEqual(restored.financeSave(s.token, command), m); }
  finally { restored.close(); }
});

test('version 3 restores procurement and cash with empty finance, without inventing money from prior receipts', async () => {
  const legacy = makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token)), financeIds = new Set(legacy.tables.workspace_finance.map(d => d.id));
  legacy.version = 3; delete legacy.tables.workspace_finance; delete legacy.tables.workspace_catalog;
  legacy.tables.account_events = legacy.tables.account_events.filter(e => e.kind !== 'finance.changed' && e.kind !== 'catalog.changed');
  legacy.tables.workspace_requests = legacy.tables.workspace_requests.filter(r => !financeIds.has(JSON.parse(r.result).id));
  const { digest, ...payload } = legacy; legacy.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); const stats = validateWorkspaceArchive(legacy); assert.equal(stats.moneyAccounts, 0); assert.ok(stats.receipts > 0);
  const restored = openWorkspace(':memory:');
  try { restored.accounts.restoreWorkspace(legacy, owner.user.id); const s = await restored.accounts.login({ login: 'owner', password }); const result = restored.finance(s.token); assert.equal(result.accounts.length, 0); assert.equal(result.movements.length, 0); assert.ok(result.unconfirmedReceipts.length > 0); await backupWorker({ operation: 'check-restore', archive: legacy, tables: restored.accounts.workspaceSnapshot(s.token) }); }
  finally { restored.close(); }
});
