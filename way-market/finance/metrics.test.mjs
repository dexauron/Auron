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
    grossProfitKopecks: 760_000, averageMarkupPercent: 760_000 / 1_140_000 * 100,
    grossMarginPercent: 40, profitFromSalesKopecks: 460_000,
    salesProfitabilityPercent: 460_000 / 1_900_000 * 100,
    netProfitKopecks: 400_000, netProfitMarginPercent: 400_000 / 1_900_000 * 100
  });
});

test('average markup uses total profit divided by total sold cost, not mean of percentages', () => {
  // SKU A: cost 1, sale 2 (100% markup); SKU B: cost 99, sale 99 (0% markup).
  const r = calculatePeriodProfit({
    salesRevenueKopecks: 10_100, salesReturnsKopecks: 0, discountsKopecks: 0,
    costOfGoodsSoldKopecks: 10_000, returnedGoodsCostKopecks: 0,
    operatingExpensesKopecks: 0, otherIncomeKopecks: 0,
    otherExpensesKopecks: 0, taxExpenseKopecks: 0
  });
  assert.equal(r.averageMarkupPercent, 1);
  assert.ok(Math.abs(r.grossMarginPercent - 100 / 10_100 * 100) < 1e-9);
});

test('unknown costs are rejected; zero denominators do not invent percentages', () => {
  assert.equal(grossMarginPercent(0, 0), null);
  assert.equal(markupPercent(0, 100), null);
  assert.throws(() => calculatePeriodProfit({salesRevenueKopecks: 0}), /salesReturnsKopecks/);
  assert.throws(() => priceForTargetMargin(100, 10000), RangeError);
  assert.throws(() => priceForTargetMargin(0, 3000), RangeError);
});

test('refunds of past sales can make the current period negative', () => {
  const result = calculatePeriodProfit({
    salesRevenueKopecks: 0, salesReturnsKopecks: 1, discountsKopecks: 0,
    costOfGoodsSoldKopecks: 0, returnedGoodsCostKopecks: 1,
    operatingExpensesKopecks: 0, otherIncomeKopecks: 0,
    otherExpensesKopecks: 0, taxExpenseKopecks: 0
  });
  assert.equal(result.netSalesKopecks, -1);
  assert.equal(result.costOfGoodsSoldKopecks, -1);
  assert.equal(result.grossProfitKopecks, 0);
  assert.equal(result.grossMarginPercent, null);
  assert.equal(result.averageMarkupPercent, null);
});

test('large offsetting amounts preserve each kopeck and reject out-of-range results', () => {
  const input = { salesRevenueKopecks: 2, salesReturnsKopecks: 0, discountsKopecks: 0,
    costOfGoodsSoldKopecks: 0, returnedGoodsCostKopecks: 0, operatingExpensesKopecks: 0,
    otherIncomeKopecks: Number.MAX_SAFE_INTEGER, otherExpensesKopecks: Number.MAX_SAFE_INTEGER, taxExpenseKopecks: 0 };
  assert.equal(calculatePeriodProfit(input).netProfitKopecks, 2);
  assert.throws(() => calculatePeriodProfit({...input, otherExpensesKopecks: 0}), RangeError);
});
