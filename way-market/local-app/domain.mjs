// Shared browser/server rules. Money is parsed as decimal text, never parseFloat.
export const FORMULA_VERSION = 'cash-net-v1';
export class InputError extends Error {}
const LIMIT = 99999999999n; // 999,999,999.99 RUB per input
export function money(text, label = 'Сумма') {
  if (typeof text !== 'string') throw new InputError(`${label}: введите сумму`);
  const value = text.trim().replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value)) {
    throw new InputError(`${label}: нужны рубли и не более двух знаков копеек`);
  }
  const [rub, kop = ''] = value.split('.');
  const result = BigInt(rub) * 100n + BigInt(kop.padEnd(2, '0'));
  if (result > LIMIT) throw new InputError(`${label}: превышен допустимый размер`);
  return Number(result);
}
function text(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) {
    throw new InputError(`${label}: заполните поле (до ${max} символов)`);
  }
  return value.trim();
}
function optionalMoney(value, label) {
  return value === '' || value == null ? null : money(value, label);
}
export const NONCASH_FORMULA_VERSION = 'noncash-gross-returns-v1';
function signedMoney(value, label) {
  if (typeof value !== 'string') throw new InputError(`${label}: введите сумму`);
  const v = value.trim();
  return v.startsWith('-') ? -money(v.slice(1), label) : money(v, label);
}
export function reconcileAggregateNonCash(raw) {
  const allowed = ['mode', 'zMode', 'zSales', 'zReturns', 'zNet', 'reportMode', 'reportSales', 'reportReturns', 'reportNet', 'reportRef', 'periodConfirmed'];
  if (!raw || raw.mode !== 'aggregate' || Object.keys(raw).some(k => !allowed.includes(k)) || typeof raw.periodConfirmed !== 'boolean') throw new InputError('Неверная структура общей безналичной сверки');
  const result = {};
  for (const prefix of ['z', 'report']) {
    const mode = raw[`${prefix}Mode`];
    if (!['gross', 'net'].includes(mode)) throw new InputError('Выберите основу безналичного отчёта');
    const label = prefix === 'z' ? 'Касса: безналичные' : 'Терминалы: безналичные';
    const present = v => v != null && v !== '';
    if (mode === 'net') {
      if (present(raw[`${prefix}Sales`]) || present(raw[`${prefix}Returns`])) throw new InputError(`${label}: нельзя одновременно вводить итог и продажи с возвратами`);
      result[`${prefix}Net`] = present(raw[`${prefix}Net`]) ? signedMoney(raw[`${prefix}Net`], label) : null;
    } else {
      if (present(raw[`${prefix}Net`])) throw new InputError(`${label}: выбрана основа продажи минус возвраты`);
      const sales = optionalMoney(raw[`${prefix}Sales`], label), returns = optionalMoney(raw[`${prefix}Returns`], label);
      if ((sales === null) !== (returns === null)) throw new InputError(`${label}: нужны продажи и возвраты; неизвестный возврат не равен нулю`);
      result[`${prefix}Net`] = sales === null ? null : sales - returns;
    }
  }
  const reportRef = result.reportNet === null ? '' : text(raw.reportRef, 'Источник и период отчёта терминалов', 200);
  return { mode: 'aggregate', ...result, reportRef, periodConfirmed: raw.periodConfirmed,
    difference: result.zNet === null || result.reportNet === null || !raw.periodConfirmed ? null : result.reportNet - result.zNet,
    formulaVersion: 'noncash-aggregate-v1' };
}
export function reconcileNonCash(raw) {
  if (raw?.mode === 'aggregate') return reconcileAggregateNonCash(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['card', 'sbp'].includes(k))) throw new InputError('Неверная структура безналичной сверки');
  return Object.fromEntries(['card', 'sbp'].map(channel => {
    const p = raw[channel] ?? {};
    const label = channel === 'card' ? 'Эквайринг' : 'СБП';
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['zSales', 'zReturns', 'reportSales', 'reportReturns', 'reportRef'].includes(k))) throw new InputError(`${label}: неверные поля`);
    const values = Object.fromEntries(['zSales', 'zReturns', 'reportSales', 'reportReturns'].map(k => [k, optionalMoney(p[k], label)]));
    for (const [a, b, source] of [['zSales', 'zReturns', 'Z'], ['reportSales', 'reportReturns', 'отчёту банка/терминала']]) {
      if ((values[a] === null) !== (values[b] === null)) throw new InputError(`${label}: укажите продажи и возвраты по ${source}; если возвратов не было, введите 0`);
    }
    const reportRef = values.reportSales === null ? '' : text(p.reportRef, `${label}: терминалы / номер отчёта`, 200);
    const zNet = values.zSales === null ? null : values.zSales - values.zReturns;
    const reportNet = values.reportSales === null ? null : values.reportSales - values.reportReturns;
    return [channel, { ...values, reportRef, zNet, reportNet,
      difference: zNet === null || reportNet === null ? null : reportNet - zNet,
      formulaVersion: NONCASH_FORMULA_VERSION }];
  }));
}
export function reconcile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Нужны данные смены');
  const date = text(raw.date, 'Дата', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new InputError('Укажите существующую дату');
  }
  const register = text(raw.register, 'Касса', 50);
  const shiftNo = text(raw.shiftNo, 'Номер смены', 50);
  const cashier = text(raw.cashier, 'Кассир');
  const author = text(raw.author, 'Кто вносит данные');
  if (raw.zBasisConfirmed !== true) throw new InputError('Подтвердите: наличные по Z уже за вычетом возвратов');
  const labels = {
    opening: 'Остаток на начало', zCash: 'Наличные по Z', otherIn: 'Прочие поступления',
    retained: 'Оставлено в кассе'
  };
  const amounts = Object.fromEntries(Object.entries(labels).map(([k, label]) => [k, money(raw[k], label)]));
  const claimed = optionalMoney(raw.claimed, 'Заявлено кассиром');
  const received = optionalMoney(raw.received, 'Пересчитано бухгалтером');
  const accountant = received === null ? '' : text(raw.accountant, 'Бухгалтер');
  if (!Array.isArray(raw.payments) || raw.payments.length > 100) throw new InputError('Допускается до 100 выплат');
  const payments = raw.payments.map((p, i) => {
    if (!p || !['cash', 'card', 'sbp'].includes(p.source) || typeof p.confirmed !== 'boolean') {
      throw new InputError(`Выплата ${i + 1}: проверьте источник и статус`);
    }
    return {
      recipient: text(p.recipient, `Выплата ${i + 1}: получатель`),
      document: text(p.document, `Выплата ${i + 1}: документ`),
      amount: money(p.amount, `Выплата ${i + 1}`), source: p.source, confirmed: p.confirmed
    };
  });
  let cashPaid = payments.reduce((s, p) => s + (p.confirmed && p.source === 'cash' ? BigInt(p.amount) : 0n), 0n);
  let cashSetup;
  if (raw.cashSetup !== undefined) {
    const s = raw.cashSetup;
    const keys = ['additionalCash', 'independentReports', 'paymentMode', 'suppliers', 'payroll', 'other', 'previousTransfers', 'factBasisConfirmed'];
    if (!s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).some(k => !keys.includes(k)) || !['totals', 'details'].includes(s.paymentMode)) throw new InputError('Неверные настройки сверки наличных');
    if (typeof s.independentReports !== 'boolean' || s.factBasisConfirmed !== true) throw new InputError('Подтвердите фактическую основу движений денег; это не подтверждение разрешения');
    const additionalCash = money(s.additionalCash, 'Наличные второго отчёта');
    if (additionalCash !== 0 && !s.independentReports) throw new InputError('Подтвердите: наличные двух отчётов не пересекаются');
    const grouped = Object.fromEntries(['suppliers', 'payroll', 'other'].map(k => [k, money(s[k], 'Общие выплаты')]));
    if (s.paymentMode === 'totals' && payments.length) throw new InputError('Выберите общие суммы или подробные выплаты; вместе они не учитываются');
    if (s.paymentMode === 'details' && Object.values(grouped).some(v => v !== 0)) throw new InputError('В подробном режиме общие суммы должны быть 0');
    if (s.paymentMode === 'totals') cashPaid = Object.values(grouped).reduce((sum, v) => sum + BigInt(v), 0n);
    cashSetup = { additionalCash, independentReports: s.independentReports, paymentMode: s.paymentMode, ...grouped,
      previousTransfers: money(s.previousTransfers, 'Предыдущие передачи'), factBasisConfirmed: true };
  }
  const expected = BigInt(amounts.opening) + BigInt(amounts.zCash) + BigInt(amounts.otherIn) - BigInt(amounts.retained) - cashPaid
    + BigInt(cashSetup?.additionalCash ?? 0) - BigInt(cashSetup?.previousTransfers ?? 0);
  const safe = n => {
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new InputError('Сумма вне допустимого диапазона');
    return Number(n);
  };
  return {
    date, register, shiftNo, cashier, author, accountant, amounts, claimed, received, payments,
    formulaVersion: cashSetup ? 'cash-multi-source-v2' : FORMULA_VERSION, cashPaid: safe(cashPaid), expected: safe(expected),
    ...(cashSetup ? { cashSetup } : {}),
    claimedDifference: claimed === null ? null : safe(BigInt(claimed) - expected),
    receivedDifference: received === null ? null : safe(BigInt(received) - expected),
    transferDifference: claimed === null || received === null ? null : received - claimed,
    warnings: expected < 0 ? ['Ожидаемая передача отрицательная: проверьте исходные суммы и выплаты.'] : [],
    // Historical cash-only snapshots keep their exact original result shape.
    ...(raw.nonCash === undefined ? {} : { nonCash: reconcileNonCash(raw.nonCash) })
  };
}
