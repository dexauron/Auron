import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesRows, previewSalesImport } from './one-c-sales.mjs';

const rows = [
  [], ['Продажи'], [], ['', '', 'Период: 01.09.2026 - 30.09.2026'], [],
  ['Номенклатура', 'Количество', 'Сумма продажи', 'Себестоимость продажи без НДС', 'Прибыль'],
  ['Класс ABC'], ['Товар А', 2, 130, 100, 30], ['Товар Б', 1, 50, 40, 10],
  ['Итого', 3, 180, 140, 40]
];
const opts = { scopeId: 'test-store', asOfDate: '2026-10-14', taxBasisConfirmation: {
  sales:'excluding_vat', cost:'excluding_vat', approvedBy:'synthetic-accountant', source:'synthetic-fixture-only' } };
const sha = 'a'.repeat(64);

test('validated gross sales use sold cost and exclude footer double counting', () => {
  const result = parseSalesRows(rows, opts);
  assert.equal(result.status, 'validated');
  assert.equal(result.lineCount, 2);
  assert.deepEqual(result.totals, { salesKopecks: 18_000, costKopecks: 14_000, grossProfitKopecks: 4_000 });
  assert.deepEqual(previewSalesImport(result, sha), {
    comparison: 'new', canApply: true, snapshotKey: result.snapshotKey, checksumSha256: sha,
    status: 'validated', issues: [], totals: result.totals, lineCount: 2,
    taxBasisConfirmation: opts.taxBasisConfirmation
  });
});

test('same original file is duplicate, changed file is revision of same snapshot', () => {
  const result = parseSalesRows(rows, opts);
  const previous = { snapshotKey: result.snapshotKey, checksumSha256: sha };
  assert.deepEqual([previewSalesImport(result, sha, previous).comparison,
    previewSalesImport(result, 'b'.repeat(64), previous).comparison], ['duplicate', 'revision']);
  assert.equal(previewSalesImport(result, sha, previous).canApply, false);
});

test('missing cost and partial future period block confirmed gross profit', () => {
  const copy = rows.map(r => [...r]); copy[7][3] = '';
  const r = parseSalesRows(copy, { ...opts, asOfDate: '2026-09-14' });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.totals.grossProfitKopecks, null);
  assert.deepEqual(r.issues.map(x => x.reason), ['missing_or_invalid', 'total_does_not_reconcile', 'period_not_closed']);
  assert.equal(previewSalesImport(r, sha).canApply, false);
});

test('complete rows in an ongoing month may be staged as provisional snapshot', () => {
  const copy = rows.map(r => [...r]); copy[3][2] = 'Период: 01.10.2026 - 31.10.2026';
  const r = parseSalesRows(copy, opts);
  assert.equal(r.status, 'provisional');
  assert.equal(r.totals.grossProfitKopecks, 4_000);
  assert.deepEqual(r.issues.map(x => x.reason), ['period_not_closed']);
  assert.equal(previewSalesImport(r, sha).canApply, true);
});

test('wrong report, malformed monetary value and manipulated footer are rejected', () => {
  assert.throws(() => parseSalesRows([['Прайс-лист']], opts), /supported 1C Sales/);
  const copy = rows.map(r => [...r]); copy[8][2] = '50.001'; copy[9][2] = 999;
  const r = parseSalesRows(copy, opts);
  assert.equal(r.status, 'needs_review');
  assert.ok(r.issues.some(x => x.reason === 'missing_or_invalid'));
  assert.ok(r.issues.some(x => x.reason === 'total_does_not_reconcile'));
  assert.throws(() => previewSalesImport(r, 'not-sha'), /SHA-256/);
});

test('matching source totals do not confirm an unknown or mixed VAT basis', () => {
  for (const confirmation of [null, {...opts.taxBasisConfirmation, sales:'including_vat'}, {...opts.taxBasisConfirmation, approvedBy:''}]) {
    const r = parseSalesRows(rows, {...opts, taxBasisConfirmation:confirmation});
    assert.equal(r.status, 'needs_review');
    assert.equal(r.totals.grossProfitKopecks, null);
    assert.equal(previewSalesImport(r, sha).canApply, false);
    assert.ok(r.issues.some(x=>x.reason==='tax_basis_not_confirmed'));
  }
});

test('unnamed rows with values require review instead of disappearing', () => {
  const copy=rows.map(r=>[...r]); copy.splice(7,0,['',1,0,0,0]);
  const r=parseSalesRows(copy,opts);
  assert.equal(r.status,'needs_review');
  assert.ok(r.issues.some(x=>x.reason==='missing_product_name'));
});
