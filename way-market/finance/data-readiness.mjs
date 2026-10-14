// Way Market. Data availability gate for management KPIs, not a tax ledger.
// Importer/accountant must verify completeness and deduplication before marking
// a source as 'verified'. A recorded zero is different from missing evidence.

export const DATA_FIELDS = Object.freeze({
  sales: { label: 'Продажи за период', action: 'Загрузите продажи из 1С с суммой после скидок и подтверждённым периодом; для дневной динамики потребуется дата продажи, для среднего чека — проверенное количество чеков за тот же период.' },
  returns: { label: 'Возвраты покупателей', action: 'Загрузите возвраты за период либо подтвердите, что их не было.' },
  receipts: { label: 'Количество чеков', action: 'Загрузите число завершённых чеков из 1С или Z-отчётов за тот же магазин и период либо внесите проверенный итог; укажите правило отмен и возвратов. Номера каждого чека не обязательны.' },
  soldCost: { label: 'Себестоимость проданного', action: 'Загрузите себестоимость реализованных единиц из 1С на той же налоговой основе и за тот же период.' },
  returnedCost: { label: 'Себестоимость возвратов', action: 'Загрузите себестоимость возвращённых товаров либо подтвердите отсутствие возвратов.' },
  operatingExpenses: { label: 'Расходы на продажи и управление', action: 'Внесите признанные расходы периода по категориям или подтвердите отсутствие каждой категории; проверьте, что списания не учтены дважды.' },
  otherIncome: { label: 'Прочие доходы', action: 'Внесите прочие признанные доходы либо подтвердите их отсутствие.' },
  otherExpenses: { label: 'Прочие расходы', action: 'Внесите прочие признанные расходы либо подтвердите их отсутствие.' },
  taxExpense: { label: 'Налоговый расход', action: 'Укажите применяемый режим и признанный налоговый расход периода или подтвердите отсутствие с бухгалтером.' },
  openingCash: { label: 'Сверенный начальный остаток денег', action: 'Введите и подтвердите начальный остаток отдельно для каждого денежного счёта.' },
  cashMovements: { label: 'Подтверждённые движения денег', action: 'Загрузите или внесите все движения по счёту, включая переводы, выплаты и возвраты, без дублей.' },
  openingStock: { label: 'Стоимость начальных запасов', action: 'Загрузите оценку запасов на начало периода по утверждённому методу.' },
  closingStock: { label: 'Стоимость конечных запасов', action: 'Загрузите оценку запасов на конец периода по тому же методу.' }
});

export const METRIC_REQUIREMENTS = Object.freeze({
  net_sales: ['sales', 'returns'],
  average_receipt: ['sales', 'returns', 'receipts'],
  gross_profit: ['sales', 'returns', 'soldCost', 'returnedCost'],
  average_markup: ['sales', 'returns', 'soldCost', 'returnedCost'],
  gross_margin: ['sales', 'returns', 'soldCost', 'returnedCost'],
  profit_from_sales: ['sales', 'returns', 'soldCost', 'returnedCost', 'operatingExpenses'],
  net_profit: ['sales', 'returns', 'soldCost', 'returnedCost', 'operatingExpenses', 'otherIncome', 'otherExpenses', 'taxExpense'],
  net_sales_return: ['sales', 'returns', 'soldCost', 'returnedCost', 'operatingExpenses', 'otherIncome', 'otherExpenses', 'taxExpense'],
  cash_by_account: ['openingCash', 'cashMovements'],
  stock_turnover: ['soldCost', 'returnedCost', 'openingStock', 'closingStock']
});

// evidence[field] = { status:'verified', periodStart, periodEnd, scopeId,
// source, coverageComplete:true }. `status:'unverified'` means present but
// still requires review. A verified 0 is allowed; a missing value is not 0.
export function assessMetric(metricId, evidence, { periodStart, periodEnd, scopeId } = {}) {
  const requirements = METRIC_REQUIREMENTS[metricId];
  if (!requirements) throw new RangeError(`Unknown metric: ${metricId}`);
  if (!periodStart || !periodEnd || !scopeId || periodStart > periodEnd) {
    throw new TypeError('An explicit valid period and scopeId are required');
  }
  if (!evidence || typeof evidence !== 'object') throw new TypeError('evidence is required');
  const needed = requirements.flatMap(field => {
    const record = evidence[field];
    const aligned = record?.periodStart === periodStart && record?.periodEnd === periodEnd && record?.scopeId === scopeId;
    if (record?.status === 'verified' && record.coverageComplete === true && record.source && aligned) return [];
    return [{ field, label: DATA_FIELDS[field].label, action: DATA_FIELDS[field].action,
      reason: !record ? 'missing' : !aligned ? 'wrong_scope_or_period' : 'unverified_or_incomplete' }];
  });
  return { metricId, status: needed.length ? 'needs_data' : 'ready', needed };
}

// One task per missing field across selected metrics. Keeps the UI from asking
// eight times for the same 1C import; missing data never becomes a false zero.
export function collectDataRequests(metricIds, evidence, context) {
  if (!Array.isArray(metricIds)) throw new TypeError('metricIds must be an array');
  const results = metricIds.map(id => assessMetric(id, evidence, context));
  const missing = new Map();
  for (const result of results) for (const item of result.needed) {
    if (!missing.has(item.field)) missing.set(item.field, { ...item, requiredFor: [] });
    missing.get(item.field).requiredFor.push(result.metricId);
  }
  return { metrics: results, requests: [...missing.values()] };
}
