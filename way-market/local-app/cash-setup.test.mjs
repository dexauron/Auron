import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reconcile, reconcileNonCash } from './domain.mjs';
import { openStore } from './store.mjs';

const base = () => ({ date: '2026-10-17', register: 'Вымышленная касса', shiftNo: 'DEMO', cashier: 'Тест', author: 'Тест', accountant: 'Тест', opening: '1000', zCash: '30000', otherIn: '0', retained: '1000', claimed: '', received: '25000', zBasisConfirmed: true, payments: [] });
const setup = extra => ({ additionalCash: '2000', independentReports: true, paymentMode: 'totals', suppliers: '5000', payroll: '2000', other: '0', previousTransfers: '0', factBasisConfirmed: true, ...extra });
const nc = extra => ({ mode: 'aggregate', zMode: 'net', zNet: '100', reportMode: 'net', reportNet: '100', reportRef: 'Вымышленный отчёт', periodConfirmed: true, ...extra });
test('two cash sources add once; aggregate payroll and suppliers reduce physical cash', () => {
  const r = reconcile({ ...base(), cashSetup: setup() });
  assert.equal(r.expected, 2500000); assert.equal(r.cashPaid, 700000); assert.equal(r.receivedDifference, 0);
  assert.equal(r.formulaVersion, 'cash-multi-source-v2');
});
test('actual retained change cancels initial change without becoming an expense', () => {
  assert.equal(reconcile({ ...base(), cashSetup: setup({ additionalCash: '0', suppliers: '0', payroll: '0' }) }).expected, 3000000);
  assert.equal(reconcile({ ...base(), opening: '0', otherIn: '1000', cashSetup: setup({ additionalCash: '0', suppliers: '0', payroll: '0' }) }).expected, 3000000);
});
test('previous physical transfers and payroll are not sales or profit expenses', () => {
  assert.equal(reconcile({ ...base(), cashSetup: setup({ previousTransfers: '500' }) }).expected, 2450000);
});
test('mutually exclusive totals and detail cannot silently double-count or hide amounts', () => {
  const payment = { recipient: 'Тест', document: 'Тест', source: 'cash', amount: '5000', confirmed: true };
  assert.throws(() => reconcile({ ...base(), payments: [payment], cashSetup: setup() }), /вместе/);
  assert.throws(() => reconcile({ ...base(), payments: [payment], cashSetup: setup({ paymentMode: 'details' }) }), /должны быть 0/);
  const totals = reconcile({ ...base(), cashSetup: setup() });
  const detailed = reconcile({ ...base(), payments: [payment, { ...payment, amount: '2000' }], cashSetup: setup({ paymentMode: 'details', suppliers: '0', payroll: '0' }) });
  assert.equal(totals.expected, detailed.expected);
});
test('unknown source, missing actual basis and overlapping reports fail closed', () => {
  for (const s of [setup({ additionalCash: '' }), setup({ independentReports: false }), setup({ factBasisConfirmed: false }), setup({ payroll: '' }), setup({ previousTransfers: '-1' }), setup({ surprise: '1' })]) assert.throws(() => reconcile({ ...base(), cashSetup: s }));
});
test('aggregate noncash does not fabricate a card or SBP split and leaves cash unchanged', () => {
  const r = reconcile({ ...base(), nonCash: nc({ reportNet: '99.99' }) });
  assert.equal(r.nonCash.difference, -1); assert.equal(r.expected, reconcile(base()).expected);
  assert.equal(Object.hasOwn(r.nonCash, 'card'), false);
});
test('gross and net bases reconcile identically; double returns are rejected', () => {
  const gross = reconcileNonCash(nc({ zMode: 'gross', zNet: '', zSales: '110', zReturns: '10' }));
  assert.equal(gross.difference, 0);
  assert.throws(() => reconcileNonCash(nc({ zReturns: '10' })), /одновременно/);
  assert.throws(() => reconcileNonCash(nc({ zMode: 'gross', zNet: '', zSales: '110' })), /нужны продажи/);
});
test('missing source or unconfirmed period never becomes a zero discrepancy', () => {
  assert.equal(reconcileNonCash(nc({ reportNet: '' })).difference, null);
  assert.equal(reconcileNonCash(nc({ periodConfirmed: false })).difference, null);
  assert.equal(reconcileNonCash(nc({ zNet: '0', reportNet: '0' })).difference, 0);
  assert.throws(() => reconcileNonCash(nc({ reportRef: '' })));
});
test('negative net period and boundary kopeck stay exact', () => {
  assert.equal(reconcileNonCash(nc({ zNet: '-100', reportNet: '-100' })).difference, 0);
  assert.equal(reconcileNonCash(nc({ zNet: '999999999.99', reportNet: '999999999.98' })).difference, -1);
});
test('mixed legacy and expanded revisions restore exactly without changing old formulas', () => {
  const a = openStore(':memory:'), b = openStore(':memory:');
  try {
    const first = a.save({ requestId: randomUUID(), expectedVersion: 0, input: base() });
    const second = a.save({ requestId: randomUUID(), id: first.id, expectedVersion: 1, reason: 'Включена расширенная сверка', input: { ...base(), cashSetup: setup(), nonCash: nc() } });
    b.restoreArchive(a.archive());
    assert.deepEqual(b.history(first.id), a.history(first.id));
    assert.equal(b.get(first.id).result.expected, second.result.expected);
    assert.equal(b.history(first.id)[1].result.formulaVersion, 'cash-net-v1');
  } finally { a.close(); b.close(); }
});
