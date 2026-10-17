import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reconcile, reconcileNonCash } from './domain.mjs';
import { openStore } from './store.mjs';

const card = (extra = {}) => ({ zSales: '50000', zReturns: '2000', reportSales: '49900', reportReturns: '2000', reportRef: 'Терминал 1 · отчёт 125', ...extra });
const cash = () => ({ date: '2026-10-17', register: 'Касса', shiftNo: '1', cashier: 'Тест', author: 'Тест', accountant: '', opening: '0', zCash: '30000', otherIn: '0', retained: '0', claimed: '', received: '', zBasisConfirmed: true, payments: [] });
test('acquiring compares net report against net Z without adding it to cash', () => {
  const r = reconcile({ ...cash(), nonCash: { card: card() } });
  assert.equal(r.nonCash.card.zNet, 4800000); assert.equal(r.nonCash.card.reportNet, 4790000);
  assert.equal(r.nonCash.card.difference, -10000); assert.equal(r.expected, 3000000);
});
test('SBP and cards are separate; one can match while the other differs', () => {
  const r = reconcileNonCash({ card: card(), sbp: card({ zSales: '10000', zReturns: '0', reportSales: '10000', reportReturns: '0', reportRef: 'СБП 125' }) });
  assert.equal(r.card.difference, -10000); assert.equal(r.sbp.difference, 0);
});
test('missing report is unknown, not a zero or discrepancy', () => {
  const r = reconcileNonCash({ card: { zSales: '100', zReturns: '0' } });
  assert.equal(r.card.zNet, 10000); assert.equal(r.card.reportNet, null); assert.equal(r.card.difference, null);
  assert.equal(r.sbp.zNet, null); assert.equal(r.sbp.reportNet, null);
  const zeros = reconcileNonCash({ card: card({ zSales: '0', zReturns: '0', reportSales: '0', reportReturns: '0' }) });
  assert.equal(zeros.card.difference, 0);
});
test('sales, returns and report reference must be supplied on a comparable basis', () => {
  for (const raw of [ { card: { zSales: '100' } }, { card: { reportSales: '100', reportRef: '125' } }, { card: card({ reportRef: '' }) }, { card: card({ zReturns: '1.001' }) }, { card: card({ fee: '100' }) }, { cash: {} }, [] ]) assert.throws(() => reconcileNonCash(raw));
});
test('a report without Z can be saved as unknown discrepancy', () => {
  const r = reconcileNonCash({ card: { reportSales: '100', reportReturns: '0', reportRef: '125' } });
  assert.equal(r.card.reportNet, 10000); assert.equal(r.card.zNet, null); assert.equal(r.card.difference, null);
});
test('refunds from older sales may produce a valid negative period', () => {
  const r = reconcileNonCash({ card: card({ zSales: '0', zReturns: '100', reportSales: '0', reportReturns: '100' }) });
  assert.equal(r.card.zNet, -10000); assert.equal(r.card.difference, 0);
});
test('kopecks remain exact at upper bounds', () => {
  const r = reconcileNonCash({ card: card({ zSales: '999999999.99', zReturns: '0.01', reportSales: '999999999.98', reportReturns: '0.01' }) });
  assert.equal(r.card.difference, -1);
});
test('cash-only history and archives remain compatible after upgrading', () => {
  const original = reconcile(cash()); assert.equal(Object.hasOwn(original, 'nonCash'), false);
  const store = openStore(':memory:'), target = openStore(':memory:');
  try {
    const first = store.save({ requestId: randomUUID(), expectedVersion: 0, input: cash() });
    const second = store.save({ requestId: randomUUID(), expectedVersion: 1, id: first.id, reason: 'Добавлены отчёты терминала', input: { ...cash(), nonCash: { card: card() } } });
    const archive = store.archive(); target.restoreArchive(archive);
    assert.deepEqual(target.history(first.id), store.history(first.id));
    assert.equal(Object.hasOwn(target.history(first.id)[1].result, 'nonCash'), false);
    assert.equal(second.result.nonCash.card.difference, -10000);
    assert.equal(target.get(first.id).result.expected, first.result.expected);
  } finally { store.close(); target.close(); }
});
