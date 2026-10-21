import { InputError } from './domain.mjs';
export const FINANCE_KINDS = ['account', 'obligation', 'plan', 'movement', 'reversal', 'bank_line'];
export const FINANCE_LIMIT = 99999999999;
export const financeId = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
export const financeDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const bad = (message = 'Проверьте финансовый документ, суммы и связи') => { throw new InputError(message); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max, blank = false) => typeof v === 'string' && v === v.trim() && (blank || v.length > 0) && v.length <= max && !/[\x00-\x1f]/.test(v);
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min && v <= FINANCE_LIMIT;
const optionalId = v => v === null || financeId(v);
export function validateFinanceDocument(kind, d) {
  if (kind === 'account') {
    if (!exact(d, ['name', 'type', 'openingDate', 'openingBalance', 'active']) || !text(d.name, 150) || !['cash', 'bank'].includes(d.type) || !financeDate(d.openingDate) || !integer(d.openingBalance) || typeof d.active !== 'boolean') bad();
  } else if (kind === 'obligation') {
    if (!exact(d, ['direction', 'party', 'supplierId', 'receiptId', 'amount', 'date', 'dueDate', 'basis', 'status']) || !['payable', 'receivable'].includes(d.direction) || !text(d.party, 150) || !optionalId(d.supplierId) || !optionalId(d.receiptId) || !integer(d.amount, 1) || !financeDate(d.date) || !financeDate(d.dueDate) || d.dueDate < d.date || !text(d.basis, 500) || !['open', 'cancelled'].includes(d.status) || (d.receiptId !== null && (d.direction !== 'payable' || d.supplierId === null))) bad();
  } else if (kind === 'plan') {
    if (!exact(d, ['obligationId', 'accountId', 'amount', 'date', 'status', 'note']) || !financeId(d.obligationId) || !financeId(d.accountId) || !integer(d.amount, 1) || !financeDate(d.date) || !['scheduled', 'cancelled'].includes(d.status) || !text(d.note, 500)) bad();
  } else if (kind === 'movement') {
    if (!exact(d, ['type', 'accountId', 'toAccountId', 'obligationId', 'planId', 'cashId', 'cashVersion', 'amount', 'date', 'purpose', 'evidence', 'reference']) || !['inflow', 'outflow', 'transfer', 'settlement', 'cash_handover'].includes(d.type) || !financeId(d.accountId) || !optionalId(d.toAccountId) || !optionalId(d.obligationId) || !optionalId(d.planId) || !optionalId(d.cashId) || !integer(d.amount, 1) || !financeDate(d.date) || !text(d.purpose, 500) || !text(d.evidence, 300) || !text(d.reference, 100, true)) bad();
    if ((d.type === 'transfer') !== (d.toAccountId !== null) || (d.type === 'settlement') !== (d.obligationId !== null) || (d.planId !== null && d.type !== 'settlement') || (d.type === 'cash_handover') !== (d.cashId !== null) || (d.cashId === null ? d.cashVersion !== null : !integer(d.cashVersion, 1))) bad();
  } else if (kind === 'bank_line') {
    if (!exact(d, ['accountId', 'reference', 'date', 'direction', 'amount', 'movementId', 'note', 'status']) || !financeId(d.accountId) || !text(d.reference, 100) || !financeDate(d.date) || !['in', 'out'].includes(d.direction) || !integer(d.amount, 1) || !optionalId(d.movementId) || !text(d.note, 500, true) || !['active', 'cancelled'].includes(d.status)) bad();
  } else if (kind === 'reversal') {
    if (!exact(d, ['movementId', 'date', 'explanation']) || !financeId(d.movementId) || !financeDate(d.date) || !text(d.explanation, 500)) bad();
  } else bad();
  return d;
}
const bounded = n => { if (n < -BigInt(FINANCE_LIMIT) || n > BigInt(FINANCE_LIMIT)) bad('Превышен допустимый размер итоговой суммы'); return Number(n); };
export function financeState(rows, procurement, cashRows) {
  const docs = rows.map(r => ({ id: r.id, version: r.version, kind: r.kind, actorId: r.actor_id, at: r.at_ms, reason: r.reason, data: validateFinanceDocument(r.kind, JSON.parse(r.data)) }));
  const byId = new Map(docs.map(d => [d.id, d]));
  if (byId.size !== docs.length) bad();
  const get = (id, kind) => { const d = byId.get(id); if (d?.kind !== kind) bad(); return d; };
  const accounts = docs.filter(d => d.kind === 'account').map(d => ({ ...d, balance: d.data.openingBalance }));
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  const balances = new Map(accounts.map(a => [a.id, BigInt(a.balance)]));
  const obligations = docs.filter(d => d.kind === 'obligation').map(d => ({ ...d, paid: 0, remaining: d.data.amount, planned: 0 }));
  const obligationMap = new Map(obligations.map(o => [o.id, o]));
  const plans = docs.filter(d => d.kind === 'plan').map(d => ({ ...d, paid: 0, remaining: d.data.amount }));
  const planMap = new Map(plans.map(p => [p.id, p]));
  const reversals = docs.filter(d => d.kind === 'reversal'), reversed = new Map();
  for (const r of reversals) {
    const m = get(r.data.movementId, 'movement');
    if (reversed.has(m.id) || r.data.date < m.data.date) bad(); reversed.set(m.id, r);
  }
  const receiptLinks = new Set();
  for (const o of obligations) {
    if (o.data.supplierId !== null && !procurement.suppliers.some(s => s.id === o.data.supplierId)) bad();
    if (o.data.receiptId !== null) {
      const receipt = procurement.receipts.find(r => r.id === o.data.receiptId), order = receipt && procurement.orders.find(d => d.id === receipt.data.orderId);
      if (!receipt || !order || order.data.supplierId !== o.data.supplierId || receipt.total !== o.data.amount || receipt.data.date !== o.data.date) bad();
      if (o.data.status === 'open') { if (receiptLinks.has(receipt.id)) bad('Обязательство по накладной уже подтверждено'); receiptLinks.add(receipt.id); }
    }
  }
  for (const p of plans) {
    const o = get(p.data.obligationId, 'obligation'), a = get(p.data.accountId, 'account');
    if (p.data.date < o.data.date || p.data.date < a.data.openingDate || (p.data.status === 'scheduled' && o.data.status === 'cancelled')) bad();
  }
  const activeCash = new Set(), activeReferences = new Set();
  const movements = docs.filter(d => d.kind === 'movement').map(m => {
    const d = m.data, a = get(d.accountId, 'account');
    if (d.date < a.data.openingDate) bad();
    let sign = d.type === 'outflow' || d.type === 'transfer' ? -1 : 1;
    if (d.type === 'transfer') { const to = get(d.toAccountId, 'account'); if (d.toAccountId === d.accountId || d.date < to.data.openingDate) bad('Для перевода нужны два разных счёта'); }
    if (d.type === 'settlement') {
      const o = get(d.obligationId, 'obligation'); if (d.date < o.data.date) bad(); sign = o.data.direction === 'payable' ? -1 : 1;
      if (d.planId !== null) { const p = get(d.planId, 'plan'); if (p.data.obligationId !== o.id || p.data.accountId !== a.id) bad(); }
    }
    if (d.type === 'cash_handover') {
      const c = cashRows.find(c => c.id === d.cashId && c.version === d.cashVersion);
      if (!c || c.status !== 'accepted' || JSON.parse(c.result).received !== d.amount || a.data.type !== 'cash' || d.date < JSON.parse(c.input).date) bad('Сдача кассы не соответствует движению денег');
      if (!reversed.has(m.id)) { if (activeCash.has(c.id)) bad('Сдача кассы уже отражена в деньгах'); activeCash.add(c.id); }
    }
    // Posted entries remain in the dated journal. A correction is an inverse entry,
    // never deletion and never a claim that money was physically returned.
    const effects = [{ accountId: a.id, delta: sign * d.amount }];
    if (d.type === 'transfer') effects.push({ accountId: d.toAccountId, delta: d.amount });
    for (const e of effects) balances.set(e.accountId, balances.get(e.accountId) + BigInt(e.delta));
    const reversal = reversed.get(m.id);
    if (!reversal && d.reference) { const key = JSON.stringify([a.id, d.reference.toLocaleLowerCase('ru')]); if (activeReferences.has(key)) bad('Номер операции уже отражён на этом счёте'); activeReferences.add(key); }
    if (reversal) for (const e of effects) balances.set(e.accountId, balances.get(e.accountId) - BigInt(e.delta));
    else if (d.obligationId !== null) {
      const o = obligationMap.get(d.obligationId); o.paid = bounded(BigInt(o.paid) + BigInt(d.amount));
      if (d.planId !== null) { const p = planMap.get(d.planId); p.paid = bounded(BigInt(p.paid) + BigInt(d.amount)); }
    }
    return { ...m, effects, reversedBy: reversal?.id ?? null };
  });
  for (const p of plans) {
    p.remaining = p.data.amount - p.paid;
    if (p.remaining < 0) bad('Сумма исполнения превышает назначение');
    if (p.data.status === 'scheduled') { const o = obligationMap.get(p.data.obligationId); o.planned = bounded(BigInt(o.planned) + BigInt(p.remaining)); }
  }
  for (const o of obligations) {
    o.remaining = o.data.amount - o.paid;
    if (o.remaining < 0 || (o.data.status === 'cancelled' && o.paid > 0)) bad('Оплата превышает долг или долг отменён');
    o.overplanned = o.data.status === 'open' && o.planned > o.remaining;
  }
  for (const a of accounts) { a.balance = bounded(balances.get(a.id)); a.negative = a.balance < 0; }
  const bankReferences = new Set(), bankMatches = new Set();
  const bankLines = docs.filter(d => d.kind === 'bank_line').map(line => {
    const d = line.data, a = get(d.accountId, 'account'), key = JSON.stringify([a.id, d.reference.toLocaleLowerCase('ru')]);
    if (a.data.type !== 'bank' || d.date < a.data.openingDate || (d.status === 'active' && bankReferences.has(key))) bad('Повтор строки выписки или неверный банковский счёт'); if (d.status === 'active') bankReferences.add(key);
    if (d.status === 'cancelled') { if (d.movementId !== null) get(d.movementId, 'movement'); return { ...line, status: 'cancelled', difference: null }; }
    let status = 'unmatched', difference = null;
    if (d.movementId !== null) {
      const m = movements.find(m => m.id === d.movementId), effect = m?.effects.find(e => e.accountId === a.id), matchKey = `${a.id}:${d.movementId}`;
      if (!effect || bankMatches.has(matchKey)) bad('Движение не относится к счёту или уже сопоставлено со строкой выписки'); bankMatches.add(matchKey);
      difference = bounded(BigInt(d.direction === 'in' ? d.amount : -d.amount) - BigInt(effect.delta));
      status = m.reversedBy ? 'needs_review' : difference !== 0 ? 'amount_difference' : m.data.date !== d.date ? 'date_difference' : 'matched';
    }
    return { ...line, status, difference };
  });
  const unconfirmedReceipts = procurement.receipts.filter(r => r.total > 0 && !receiptLinks.has(r.id));
  const latestCash = new Map(); for (const c of cashRows) if (!latestCash.has(c.id) || latestCash.get(c.id).version < c.version) latestCash.set(c.id, c);
  for (const m of movements.filter(m => m.data.type === 'cash_handover' && !m.reversedBy)) {
    const latest = latestCash.get(m.data.cashId); if (latest.status !== 'accepted' || JSON.parse(latest.result).received !== m.data.amount) bad('Сдача изменена после отражения в деньгах');
  }
  const cashToPost = [...latestCash.values()].filter(c => c.status === 'accepted' && JSON.parse(c.result).received > 0 && !activeCash.has(c.id)).map(c => ({ id: c.id, version: c.version, date: JSON.parse(c.input).date, register: JSON.parse(c.input).register, shiftNo: JSON.parse(c.input).shiftNo, amount: JSON.parse(c.result).received }));
  return { accounts, obligations, plans, movements, reversals, bankLines, unconfirmedReceipts, cashToPost };
}
export function financeReport(state, start, end) {
  if (!financeDate(start) || !financeDate(end) || start > end) bad('Выберите корректный период отчёта');
  const movementMap = new Map(state.movements.map(m => [m.id, m]));
  const entries = state.movements.map(m => ({ id: m.id, date: m.data.date, type: m.data.type, effects: m.effects, correction: false }));
  for (const r of state.reversals) entries.push({ id: r.id, date: r.data.date, type: movementMap.get(r.data.movementId).data.type, effects: movementMap.get(r.data.movementId).effects.map(e => ({ ...e, delta: -e.delta })), correction: true });
  const accounts = state.accounts.map(a => {
    let opening = a.data.openingDate <= start ? BigInt(a.data.openingBalance) : 0n;
    let incoming = 0n, outgoing = 0n, introduced = a.data.openingDate > start && a.data.openingDate <= end ? BigInt(a.data.openingBalance) : 0n;
    for (const e of entries) for (const effect of e.effects.filter(x => x.accountId === a.id)) {
      const n = BigInt(effect.delta);
      if (e.date < start) opening += n;
      else if (e.date <= end) { if (n >= 0n) incoming += n; else outgoing -= n; }
    }
    return { id: a.id, name: a.data.name, opening: bounded(opening), introduced: bounded(introduced), incoming: bounded(incoming), outgoing: bounded(outgoing), closing: bounded(opening + introduced + incoming - outgoing) };
  });
  return { start, end, accounts, entries: entries.filter(e => e.date >= start && e.date <= end), note: 'Движение денег; не отчёт о выручке, расходах или прибыли. Переводы отражены на обоих счетах.' };
}
