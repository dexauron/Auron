const currency = new Intl.NumberFormat('ru-RU', {style:'currency', currency:'RUB'});
export const differenceClass = value => value == null || value === 0 ? '' : value > 0 ? 'positive' : 'negative';
export function differenceText(value, unknown = '—') {
  if (value == null) return unknown;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${currency.format(Math.abs(value) / 100)}`;
}
export function showDifference(node, value, unknown = '—') {
  node.textContent = differenceText(value, unknown);
  node.classList.remove('positive', 'negative');
  const color = differenceClass(value);
  if (color) node.classList.add(color);
  return node;
}
