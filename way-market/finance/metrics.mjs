// Way Market: pure KPI calculations. All amounts are non-negative integer kopecks.
// Callers must supply recognised sales and the cost of goods actually sold,
// never cash movements or the total of supplier payments.

function amount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be non-negative integer kopecks`);
  }
  return value;
}

function exactSum(values, name) {
  const value = values.reduce((sum, n) => sum + BigInt(n), 0n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds safe integer range`);
  }
  return Number(value);
}

export function markupPercent(costKopecks, sellingPriceKopecks) {
  const cost = amount(costKopecks, 'costKopecks');
  const price = amount(sellingPriceKopecks, 'sellingPriceKopecks');
  return cost === 0 ? null : ((price - cost) / cost) * 100;
}

export function grossMarginPercent(costKopecks, sellingPriceKopecks) {
  const cost = amount(costKopecks, 'costKopecks');
  const price = amount(sellingPriceKopecks, 'sellingPriceKopecks');
  return price === 0 ? null : ((price - cost) / price) * 100;
}

// targetBasisPoints: 3000 means 30.00%. Round UP to one kopeck so the
// realised margin is never lower than the requested target.
export function priceForTargetMargin(costKopecks, targetBasisPoints) {
  const cost = amount(costKopecks, 'costKopecks');
  if (cost === 0) throw new RangeError('a positive cost is required for a target margin price');
  if (!Number.isInteger(targetBasisPoints) || targetBasisPoints < 0 || targetBasisPoints >= 10000) {
    throw new RangeError('targetBasisPoints must be between 0 and 9999');
  }
  const numerator = BigInt(cost) * 10000n;
  const denominator = BigInt(10000 - targetBasisPoints);
  const price = (numerator + denominator - 1n) / denominator;
  if (price > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('price exceeds safe integer range');
  return Number(price);
}

// Gross sales, returns and discounts are separate inputs. If the source has
// already supplied net revenue, pass zero returns/discounts to avoid duplicates.
export function calculatePeriodProfit(input) {
  const fields = [
    'salesRevenueKopecks', 'salesReturnsKopecks', 'discountsKopecks',
    'costOfGoodsSoldKopecks', 'returnedGoodsCostKopecks',
    'operatingExpensesKopecks', 'otherIncomeKopecks',
    'otherExpensesKopecks', 'taxExpenseKopecks'
  ];
  if (!input || typeof input !== 'object') throw new TypeError('input is required');
  const v = Object.fromEntries(fields.map(k => [k, amount(input[k], k)]));
  const netSales = exactSum([v.salesRevenueKopecks, -v.salesReturnsKopecks, -v.discountsKopecks], 'netSales');
  const cogs = exactSum([v.costOfGoodsSoldKopecks, -v.returnedGoodsCostKopecks], 'costOfGoodsSold');
  // Returns from older sales may exceed current-period sales. Do not erase a
  // valid negative period by treating it as an invalid input.
  const grossProfit = exactSum([netSales, -cogs], 'grossProfit');
  const profitFromSales = exactSum([grossProfit, -v.operatingExpensesKopecks], 'profitFromSales');
  const netProfit = exactSum([grossProfit, -v.operatingExpensesKopecks, v.otherIncomeKopecks, -v.otherExpensesKopecks, -v.taxExpenseKopecks], 'netProfit');
  return {
    netSalesKopecks: netSales,
    costOfGoodsSoldKopecks: cogs,
    grossProfitKopecks: grossProfit,
    // Ratio of totals, never the unweighted mean of SKU percentages.
    averageMarkupPercent: cogs <= 0 ? null : (grossProfit / cogs) * 100,
    grossMarginPercent: netSales <= 0 ? null : (grossProfit / netSales) * 100,
    profitFromSalesKopecks: profitFromSales,
    salesProfitabilityPercent: netSales <= 0 ? null : (profitFromSales / netSales) * 100,
    netProfitKopecks: netProfit,
    netProfitMarginPercent: netSales <= 0 ? null : (netProfit / netSales) * 100
  };
}
