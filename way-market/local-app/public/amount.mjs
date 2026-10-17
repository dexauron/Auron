// Ввод сумм как в документе: «34 000,50 ₽» превращается в «34000,50» для общего разбора денег,
// а после ввода сумма показывается с разрядами. Деньги по-прежнему разбирает только money() в domain.mjs.
const SPACE = /[ \u00a0\u202f]/g;
export function normalizeAmount(text, type = 'money') {
  const value = String(text).trim().replace(/\s*(₽|руб\.?|р\.)$/i, '');
  const grouped = type === 'count' ? /^\d{1,3}([ \u00a0\u202f]\d{3})+$/ : /^\d{1,3}([ \u00a0\u202f]\d{3})+([.,]\d{1,2})?$/;
  return grouped.test(value) ? value.replace(SPACE, '') : value;
}
export function displayAmount(text, type = 'money') {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text ?? '');
  if (!match || (type === 'count' && match[2] !== undefined)) return text ?? '';
  const rub = String(Number(match[1])).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const kop = (match[2] ?? '').padEnd(2, '0');
  return type === 'count' || kop === '00' ? rub : `${rub},${kop}`;
}
