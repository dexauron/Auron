// Read-only normalizer for the 1C monthly SKU sales export supplied to Way Market.
// `rows` are cells decoded by a separate local XLS/XLSX reader. This module
// never executes workbook macros, changes 1C, or writes to a database.

const COLUMNS = Object.freeze({
  product: 'Номенклатура', quantity: 'Количество', sales: 'Сумма продажи',
  cost: 'Себестоимость продажи без НДС', profit: 'Прибыль'
});

function money(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const plain = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(plain);
  if (!match) return null;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0') || '0');
  const signed = match[1] ? -cents : cents;
  return signed <= BigInt(Number.MAX_SAFE_INTEGER) && signed >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(signed) : null;
}

function isoDate(ru) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ru);
  if (!m) return null;
  const [day, month, year] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const valueAt = (row, index) => row?.[index];
const nonblank = v => v !== undefined && v !== null && String(v).trim() !== '';

export function parseSalesRows(rows, { scopeId, asOfDate } = {}) {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) throw new TypeError('rows must be an array of cell arrays');
  if (!scopeId || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate || '') || !isoDate(asOfDate.slice(8, 10)+'.'+asOfDate.slice(5, 7)+'.'+asOfDate.slice(0, 4))) {
    throw new TypeError('scopeId and a valid asOfDate are required');
  }
  const titleFound = rows.slice(0, 10).some(row => row.some(v => String(v ?? '').trim() === 'Продажи'));
  const headIndex = rows.findIndex(row => Object.values(COLUMNS).every(label => row.includes(label)));
  const periodText = rows.slice(0, 10).flat().find(v => /^Период:\s*\d{2}\.\d{2}\.\d{4}\s*-\s*\d{2}\.\d{2}\.\d{4}$/.test(String(v ?? '').trim()));
  if (!titleFound || headIndex < 0 || !periodText) throw new TypeError('Not a supported 1C Sales report');
  const m = String(periodText).match(/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/);
  const periodStart = isoDate(m[1]), periodEnd = isoDate(m[2]);
  if (!periodStart || !periodEnd || periodStart > periodEnd) throw new TypeError('Invalid report period');
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, rows[headIndex].indexOf(name)]));
  const issues = [];
  let salesKopecks = 0, costKopecks = 0, profitKopecks = 0, lineCount = 0;
  let footer = null;
  for (let i = headIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(valueAt(row, index.product) ?? '').trim();
    if (name === 'Итого') {
      if (footer) issues.push({ row: i + 1, field: 'total', reason: 'duplicate_footer' });
      footer = { row: i + 1, sales: money(valueAt(row, index.sales)), cost: money(valueAt(row, index.cost)), profit: money(valueAt(row, index.profit)) };
      continue;
    }
    if (!name) continue; // e.g. the separate ABC/XYZ heading row
    if (![index.quantity, index.sales, index.cost, index.profit].some(col => nonblank(valueAt(row, col)))) continue; // section heading
    if (footer) { issues.push({ row: i + 1, field: 'product', reason: 'row_after_footer' }); continue; }
    lineCount++;
    const sales = money(valueAt(row, index.sales)), cost = money(valueAt(row, index.cost));
    const profit = money(valueAt(row, index.profit));
    if (sales === null) issues.push({ row: i + 1, field: 'sales', reason: 'missing_or_invalid' });
    if (cost === null) issues.push({ row: i + 1, field: 'cost', reason: 'missing_or_invalid' });
    if (profit !== null && sales !== null && cost !== null && profit !== sales - cost) {
      issues.push({ row: i + 1, field: 'profit', reason: 'does_not_reconcile' });
    }
    if (sales !== null) salesKopecks += sales;
    if (cost !== null) costKopecks += cost;
    if (profit !== null) profitKopecks += profit;
    if (![salesKopecks, costKopecks, profitKopecks].every(Number.isSafeInteger)) throw new RangeError('Sum exceeds safe integer range');
  }
  if (!footer || [footer.sales, footer.cost, footer.profit].some(x => x === null)) {
    issues.push({ field: 'total', reason: 'missing_or_invalid_footer' });
  } else {
    for (const [field, sum] of [['sales', salesKopecks], ['cost', costKopecks], ['profit', profitKopecks]]) {
      if (footer[field] !== sum) issues.push({ row: footer.row, field, reason: 'total_does_not_reconcile' });
    }
    if (footer.profit !== footer.sales - footer.cost) issues.push({ row: footer.row, field: 'profit', reason: 'footer_profit_does_not_reconcile' });
  }
  if (periodEnd > asOfDate) issues.push({ field: 'period', reason: 'period_not_closed' });
  // An ongoing month may be imported as a provisional snapshot. Missing
  // amounts or a failed reconciliation still block the proposed import.
  const blocking = issues.some(x => x.reason !== 'period_not_closed');
  const status = blocking ? 'needs_review' : periodEnd > asOfDate ? 'provisional' : 'validated';
  return {
    kind: 'one_c_sales_sku_month', scopeId, periodStart, periodEnd, asOfDate,
    snapshotKey: JSON.stringify([scopeId, periodStart, periodEnd, 'one_c_sales_sku_month']),
    lineCount, totals: { salesKopecks, costKopecks, grossProfitKopecks: blocking ? null : salesKopecks - costKopecks },
    status, issues
  };
}

// This only classifies a proposed import. Persistence and review must be a
// separate explicit operation with an audit trail and a transaction.
export function previewSalesImport(report, checksumSha256, previous = null) {
  if (!report || report.kind !== 'one_c_sales_sku_month') throw new TypeError('sales report required');
  if (!/^[a-f0-9]{64}$/i.test(checksumSha256 || '')) throw new TypeError('SHA-256 of original file required');
  if (previous && previous.snapshotKey !== report.snapshotKey) throw new TypeError('Previous snapshot key differs');
  const comparison = previous ? (previous.checksumSha256 === checksumSha256.toLowerCase() ? 'duplicate' : 'revision') : 'new';
  return { comparison, canApply: ['validated', 'provisional'].includes(report.status) && comparison !== 'duplicate',
    snapshotKey: report.snapshotKey, checksumSha256: checksumSha256.toLowerCase(),
    status: report.status, issues: report.issues, totals: report.totals, lineCount: report.lineCount };
}
