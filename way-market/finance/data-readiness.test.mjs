import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessMetric, collectDataRequests } from './data-readiness.mjs';

const context = { periodStart: '2026-10-01', periodEnd: '2026-10-31', scopeId: 'store-1' };
const verified = (source = '1c-export') => ({ status: 'verified', source, coverageComplete: true, ...context });

test('missing cost blocks profit and margin, and prompts are merged', () => {
  const r = collectDataRequests(['gross_profit', 'gross_margin'], {
    sales: verified(), returns: verified()
  }, context);
  assert.deepEqual(r.metrics.map(m => m.status), ['needs_data', 'needs_data']);
  assert.deepEqual(r.requests.map(x => [x.field, x.requiredFor]), [
    ['soldCost', ['gross_profit', 'gross_margin']],
    ['returnedCost', ['gross_profit', 'gross_margin']]
  ]);
});

test('explicitly verified absence of returns counts as data, not unknown zero', () => {
  const r = assessMetric('net_sales', { sales: verified(), returns: verified('accountant: no returns') }, context);
  assert.equal(r.status, 'ready');
});

test('net profit demands expense and tax coverage, including dates and scope', () => {
  const e = Object.fromEntries(['sales', 'returns', 'soldCost', 'returnedCost', 'operatingExpenses', 'otherIncome', 'otherExpenses', 'taxExpense'].map(k => [k, verified()]));
  assert.equal(assessMetric('net_profit', e, context).status, 'ready');
  e.taxExpense = { ...verified(), scopeId: 'other-store' };
  assert.equal(assessMetric('net_profit', e, context).needed[0].reason, 'wrong_scope_or_period');
  e.taxExpense = { ...verified(), coverageComplete: false };
  assert.equal(assessMetric('net_profit', e, context).needed[0].reason, 'unverified_or_incomplete');
});

test('cash needs opening balance, not a supplier invoice or reported profit', () => {
  const r = assessMetric('cash_by_account', { cashMovements: verified() }, context);
  assert.deepEqual(r.needed.map(x => x.field), ['openingCash']);
  assert.throws(() => assessMetric('unknown', {}, context), RangeError);
});

test('average receipt accepts verified aggregate count without individual receipt IDs', () => {
  const evidence = { sales: verified(), returns: verified('accountant: no returns'), receipts: { ...verified('Z reports'), count: 42 } };
  assert.equal(assessMetric('average_receipt', evidence, context).status, 'ready');
  evidence.receipts.count = undefined;
  assert.deepEqual(assessMetric('average_receipt', evidence, context).needed.map(x => x.field), ['receipts']);
  evidence.receipts.count = -1;
  assert.equal(assessMetric('average_receipt', evidence, context).status, 'needs_data');
});
