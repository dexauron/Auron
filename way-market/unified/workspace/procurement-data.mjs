import { InputError } from './domain.mjs';
export const PROCUREMENT_KINDS = ['supplier', 'budget', 'order', 'receipt', 'review'];
export const MAX_PROCUREMENT_MONEY = 99999999999;
const bad = () => { throw new InputError('Проверьте документ закупки, суммы и связи'); };
export const procurementId = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const integer = (v, min = 0, max = MAX_PROCUREMENT_MONEY) => Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max, blank = false) => typeof v === 'string' && v === v.trim() && (blank || v.length > 0) && v.length <= max && !/[\x00-\x1f]/.test(v);
const exact = (v, keys) => v && !Array.isArray(v) && typeof v === 'object' && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function quantity(v) {
  if (typeof v !== 'string' || !/^\d{1,6}([.,]\d{1,3})?$/.test(v.trim())) throw new InputError('Количество: до трёх знаков после запятой');
  const [whole, part = ''] = v.trim().replace(',', '.').split('.');
  const n = Number(whole) * 1000 + Number(part.padEnd(3, '0'));
  if (!integer(n, 1, 999999999)) throw new InputError('Укажите положительное количество');
  return n;
}
export function lineAmount(q, price) {
  if (!integer(q, 0, 999999999) || !integer(price)) bad();
  const amount = (BigInt(q) * BigInt(price) + 500n) / 1000n;
  if (amount > BigInt(MAX_PROCUREMENT_MONEY)) bad();
  return Number(amount);
}
const sum = values => { const n = values.reduce((a, b) => a + BigInt(b), 0n); if (n > BigInt(MAX_PROCUREMENT_MONEY)) bad(); return Number(n); };
export function validateProcurementDocument(kind, d) {
  if (kind === 'supplier') {
    if (!exact(d, ['name', 'contact', 'terms', 'active']) || !text(d.name, 150) || !text(d.contact, 200, true) || !text(d.terms, 500, true) || typeof d.active !== 'boolean') bad();
  } else if (kind === 'budget') {
    if (!exact(d, ['name', 'scope', 'start', 'end', 'amount']) || !text(d.name, 150) || !text(d.scope, 150) || !date(d.start) || !date(d.end) || d.end < d.start || !integer(d.amount)) bad();
  } else if (kind === 'order') {
    if (!exact(d, ['supplierId', 'budgetId', 'date', 'lines', 'status']) || !procurementId(d.supplierId) || !procurementId(d.budgetId) || !date(d.date) || !['open', 'closed'].includes(d.status) || !Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 50) bad();
    const ids = new Set();
    for (const l of d.lines) {
      if (!exact(l, ['id', 'productId', 'name', 'unit', 'quantity', 'price']) || !procurementId(l.id) || ids.has(l.id) || !procurementId(l.productId) || !text(l.name, 150) || !text(l.unit, 20) || !integer(l.quantity, 1, 999999999) || !integer(l.price)) bad(); ids.add(l.id); lineAmount(l.quantity, l.price);
    }
    sum(d.lines.map(l => lineAmount(l.quantity, l.price)));
  } else if (kind === 'receipt') {
    if (!exact(d, ['orderId', 'orderVersion', 'number', 'date', 'lines', 'final', 'note']) || !procurementId(d.orderId) || !integer(d.orderVersion, 1) || !text(d.number, 100) || !date(d.date) || !Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 50 || typeof d.final !== 'boolean' || !text(d.note, 500, true)) bad();
    const ids = new Set();
    for (const l of d.lines) { if (!exact(l, ['lineId', 'quantity', 'price']) || !procurementId(l.lineId) || ids.has(l.lineId) || !integer(l.quantity, 1, 999999999) || !integer(l.price)) bad(); ids.add(l.lineId); lineAmount(l.quantity, l.price); }
    sum(d.lines.map(l => lineAmount(l.quantity, l.price)));
  } else if (kind === 'review') {
    if (!exact(d, ['receiptId', 'state', 'explanation']) || !procurementId(d.receiptId) || !['open', 'resolved'].includes(d.state) || !text(d.explanation, 500)) bad();
  } else bad();
  return d;
}
export function procurementState(rows, products) {
  const docs = rows.map(r => ({ id: r.id, version: r.version, kind: r.kind, actorId: r.actor_id, at: r.at_ms, reason: r.reason, data: validateProcurementDocument(r.kind, JSON.parse(r.data)) }));
  const byId = new Map(docs.map(d => [d.id, d]));
  const get = (id, kind) => { const d = byId.get(id); if (d?.kind !== kind) bad(); return d; };
  const productIds = new Set(products.map(p => p.id));
  const budgets = docs.filter(d => d.kind === 'budget').map(b => ({ ...b, used: 0, reserved: 0 }));
  const totals = new Map(budgets.map(b => [b.id, b]));
  const receipts = docs.filter(d => d.kind === 'receipt').map(r => ({ ...r, total: sum(r.data.lines.map(l => lineAmount(l.quantity, l.price))) }));
  const invoiceKeys = new Set(), reviewKeys = new Set();
  const orders = docs.filter(d => d.kind === 'order').map(o => {
    get(o.data.supplierId, 'supplier'); const budget = get(o.data.budgetId, 'budget');
    if (o.data.date < budget.data.start || o.data.date > budget.data.end) bad();
    const incoming = receipts.filter(r => r.data.orderId === o.id).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const received = new Map(); let finalCount = 0;
    for (const r of incoming) {
      // Every receipt retains its order's budget, even when received after the period.
      const key = JSON.stringify([o.data.supplierId, r.data.number.toLocaleLowerCase('ru')]);
      if (invoiceKeys.has(key) || r.data.date < o.data.date || r.data.orderVersion > o.version) bad(); invoiceKeys.add(key);
      if (r.data.final) finalCount++;
      for (const l of r.data.lines) { if (!o.data.lines.some(x => x.id === l.lineId)) bad(); received.set(l.lineId, (received.get(l.lineId) ?? 0) + l.quantity); }
    }
    if (finalCount > 1) bad();
    const closed = o.data.status === 'closed' || finalCount > 0;
    const lines = o.data.lines.map(l => {
      if (!productIds.has(l.productId)) bad(); const q = received.get(l.id) ?? 0; if (q > l.quantity) bad();
      return { ...l, received: q, remaining: l.quantity - q, reserved: closed ? 0 : lineAmount(l.quantity, l.price) - lineAmount(q, l.price) };
    });
    const used = sum(incoming.map(r => r.total)), reserved = sum(lines.map(l => l.reserved));
    totals.get(budget.id).used = sum([totals.get(budget.id).used, used]); totals.get(budget.id).reserved = sum([totals.get(budget.id).reserved, reserved]);
    return { ...o, closed, lines, used, reserved, total: sum(lines.map(l => lineAmount(l.quantity, l.price))), receiptIds: incoming.map(r => r.id) };
  });
  for (const r of receipts) {
    const o = orders.find(o => o.id === r.data.orderId); if (!o) bad();
    r.discrepancies = r.data.lines.filter(l => o.data.lines.find(x => x.id === l.lineId).price !== l.price).map(l => ({ kind: 'price', lineId: l.lineId }));
    if (r.data.final) r.discrepancies.push(...o.lines.filter(l => l.remaining > 0).map(l => ({ kind: 'shortage', lineId: l.id, quantity: l.remaining })));
    if (r.data.note) r.discrepancies.push({ kind: 'note', note: r.data.note });
  }
  for (const d of docs.filter(d => d.kind === 'review')) { const r = get(d.data.receiptId, 'receipt'); if (reviewKeys.has(r.id) || !receipts.find(x => x.id === r.id).discrepancies.length) bad(); reviewKeys.add(r.id); }
  for (const b of budgets) { b.available = b.data.amount - b.used - b.reserved; if (b.available < 0) throw new InputError('Недостаточно лимита. Измените заказ или согласуйте увеличение бюджета'); }
  return { suppliers: docs.filter(d => d.kind === 'supplier'), budgets, orders, receipts, reviews: docs.filter(d => d.kind === 'review') };
}
