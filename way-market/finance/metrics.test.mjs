import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markupPercent, grossMarginPercent, priceForTargetMargin, calculatePeriodProfit } from './metrics.mjs';

test('30% markup on 10,000 rubles is only 23.08% gross margin', () => {
  assert.equal(markupPercent(1_000_000, 1_300_000), 30);
  assert.ok(Math.abs(grossMarginPercent(1_000_000, 1_300_000) - 23.0769230769) < 1e-9);
  assert.equal(priceForTargetMargin(1_000_000, 3000), 1_428_572); // 14,285.72 rubles
  assert.ok(grossMarginPercent(1_000_000, 1_428_572) >= 30);
  assert.ok(grossMarginPercent(1_000_000, 1_428_571) < 30);
});

test('net profit uses sold inventory and expenses for the same period', () => {
  const result = calculatePeriodProfit({
    salesRevenueKopecks: 2_000_000, salesReturnsKopecks: 100_000, discountsKopecks: 0,
    costOfGoodsSoldKopecks: 1_200_000, returnedGoodsCostKopecks: 60_000,
    operatingExpensesKopecks: 300_000, otherIncomeKopecks: 10_000,
    otherExpensesKopecks: 20_000, taxExpenseKopecks: 50_000
  });
  assert.deepEqual(result, {
    netSalesKopecks: 1_900_000, costOfGoodsSoldKopecks: 1_140_000,
    grossProfitKopecks: 760_000, grossMarginPercent: 40,
    netProfitKopecks: 400_000, netProfitMarginPercent: 400_000 / 1_900_000 * 100
  });
});

test('unknown costs are rejected; zero denominators do not invent percentages', () => {
  assert.equal(grossMarginPercent(0, 0), null);
  assert.equal(markupPercent(0, 100), null);
  assert.throws(() => calculatePeriodProfit({salesRevenueKopecks: 0}), /salesReturnsKopecks/);
  assert.throws(() => priceForTargetMargin(100, 10000), RangeError);
  assert.throws(() => calculatePeriodProfit({
    salesRevenueKopecks: 0, salesReturnsKopecks: 1, discountsKopecks: 0,
    costOfGoodsSoldKopecks: 0, returnedGoodsCostKopecks: 0,
    operatingExpensesKopecks: 0, otherIncomeKopecks: 0,
    otherExpensesKopecks: 0, taxExpenseKopecks: 0
  }), RangeError);
});
