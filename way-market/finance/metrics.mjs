// Way Market: pure KPI calculations. All amounts are non-negative integer kopecks.
// Callers must supply recognised sales and the cost of goods actually sold,
// never cash movements or the total of supplier payments.

function amount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be non-negative integer kopecks`);
  }
  return value;
}

function safe(value, name) {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} exceeds safe integer range`);
  return value;
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
  const netSales = safe(v.salesRevenueKopecks - v.salesReturnsKopecks - v.discountsKopecks, 'netSales');
  const cogs = safe(v.costOfGoodsSoldKopecks - v.returnedGoodsCostKopecks, 'costOfGoodsSold');
  if (netSales < 0 || cogs < 0) throw new RangeError('returns exceed sales or returned cost exceeds cost of goods sold');
  const grossProfit = safe(netSales - cogs, 'grossProfit');
  const netProfit = safe(grossProfit - v.operatingExpensesKopecks + v.otherIncomeKopecks - v.otherExpensesKopecks - v.taxExpenseKopecks, 'netProfit');
  return {
    netSalesKopecks: netSales,
    costOfGoodsSoldKopecks: cogs,
    grossProfitKopecks: grossProfit,
    grossMarginPercent: netSales === 0 ? null : (grossProfit / netSales) * 100,
    netProfitKopecks: netProfit,
    netProfitMarginPercent: netSales === 0 ? null : (netProfit / netSales) * 100
  };
}
