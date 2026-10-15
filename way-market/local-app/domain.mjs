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
  const cashPaid = payments.reduce((s, p) => s + (p.confirmed && p.source === 'cash' ? BigInt(p.amount) : 0n), 0n);
  const expected = BigInt(amounts.opening) + BigInt(amounts.zCash) + BigInt(amounts.otherIn) - BigInt(amounts.retained) - cashPaid;
  const safe = n => {
    if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new InputError('Сумма вне допустимого диапазона');
    return Number(n);
  };
  return {
    date, register, shiftNo, cashier, author, accountant, amounts, claimed, received, payments,
    formulaVersion: FORMULA_VERSION, cashPaid: safe(cashPaid), expected: safe(expected),
    claimedDifference: claimed === null ? null : safe(BigInt(claimed) - expected),
    receivedDifference: received === null ? null : safe(BigInt(received) - expected),
    transferDifference: claimed === null || received === null ? null : received - claimed,
    warnings: expected < 0 ? ['Ожидаемая передача отрицательная: проверьте исходные суммы и выплаты.'] : []
  };
}
