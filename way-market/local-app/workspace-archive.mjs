import { financeState, validateFinanceDocument, FINANCE_KINDS } from './finance-data.mjs';
import { procurementState, validateProcurementDocument, PROCUREMENT_KINDS } from './procurement-data.mjs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { reconcileExcel } from './worksheet.mjs';
import { validateDraftFields, validDraftSlot } from './workspace-drafts.mjs';

export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_ROWS = 100000;
export const ARCHIVE_TABLES = {
  account_users: ['id', 'login', 'name', 'role', 'active', 'version', 'salt', 'verifier'],
  account_events: ['sequence', 'at_ms', 'actor_id', 'kind', 'subject_id', 'detail'],
  workspace_cash: ['id', 'version', 'shift_key', 'cashier_id', 'actor_id', 'status', 'at_ms', 'input', 'result', 'reason'],
  workspace_requests: ['id', 'digest', 'result'],
  workspace_tasks: ['id', 'version', 'creator_id', 'assignee_id', 'title', 'status', 'related_cash', 'at_ms'],
  workspace_products: ['id', 'version', 'name', 'barcode', 'price', 'active'],
  workspace_finance: ['id', 'version', 'kind', 'actor_id', 'at_ms', 'data', 'reason'],
  workspace_procurement: ['id', 'version', 'kind', 'actor_id', 'at_ms', 'data', 'reason'],
  workspace_drafts: ['id', 'user_id', 'slot', 'version', 'base_version', 'fields', 'at_ms', 'request_id', 'request_digest']
};
const hash = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const fail = () => { throw new Error('Архив не прошёл проверку структуры, связей или расчётов'); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const clean = (v, max, blank = false) => typeof v === 'string' && (blank || v.trim().length > 0) && v.length <= max && !/[\x00-\x1f]/.test(v);
const json = (v, max = MAX_WORKSPACE_BYTES) => { if (typeof v !== 'string' || v.length > max) fail(); try { return JSON.parse(v); } catch { fail(); } };
export function makeWorkspaceArchive(tables, createdAt = new Date().toISOString()) {
  const payload = { format: 'way-market-workspace', version: 4, createdAt, tables };
  const archive = { ...payload, digest: hash(payload) };
  validateWorkspaceArchive(archive);
  return archive;
}
export function validateWorkspaceArchive(archive) {
  if (!exact(archive, ['format', 'version', 'createdAt', 'tables', 'digest']) || archive.format !== 'way-market-workspace' || ![1, 2, 3, 4].includes(archive.version) || typeof archive.createdAt !== 'string' || !Number.isFinite(Date.parse(archive.createdAt)) || new Date(archive.createdAt).toISOString() !== archive.createdAt || !exact(archive.tables, Object.keys(ARCHIVE_TABLES).filter(t => (archive.version >= 2 || t !== 'workspace_drafts') && (archive.version >= 3 || t !== 'workspace_procurement') && (archive.version >= 4 || t !== 'workspace_finance')))) fail();
  const { digest, ...payload } = archive;
  if (typeof digest !== 'string' || digest !== hash(payload) || Buffer.byteLength(JSON.stringify(archive)) > MAX_WORKSPACE_BYTES) fail();
  let count = 0;
  for (const [table, columns] of Object.entries(ARCHIVE_TABLES)) {
    if ((table === 'workspace_drafts' && archive.version === 1) || (table === 'workspace_procurement' && archive.version < 3) || (table === 'workspace_finance' && archive.version < 4)) continue;
    const rows = archive.tables[table]; if (!Array.isArray(rows)) fail(); count += rows.length;
    if (count > MAX_WORKSPACE_ROWS || rows.some(r => !exact(r, columns))) fail();
  }
  const t = archive.tables, users = new Map(), logins = new Set();
  for (const u of t.account_users) {
    if (!id(u.id) || users.has(u.id) || !/^[a-z0-9._-]{3,64}$/.test(u.login) || logins.has(u.login) || !clean(u.name, 100) || !['owner', 'administrator', 'accountant', 'cashier', 'employee', 'representative'].includes(u.role) || ![0, 1].includes(u.active) || !integer(u.version, 1) || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{128}$/.test(u.verifier)) fail();
    users.set(u.id, u); logins.add(u.login);
  }
  if (![...users.values()].some(u => u.role === 'owner' && u.active)) fail();
  const events = new Set();
  for (const e of t.account_events) {
    if (!integer(e.sequence, 1) || events.has(e.sequence) || !integer(e.at_ms) || (e.actor_id !== null && !users.has(e.actor_id)) || !clean(e.kind, 100) || (e.subject_id !== null && !clean(e.subject_id, 200))) fail();
    const detail = json(e.detail, 65536); if (!detail || typeof detail !== 'object' || Array.isArray(detail)) fail(); events.add(e.sequence);
  }
  const cash = new Map(), physical = new Map();
  for (const c of t.workspace_cash) {
    if (!id(c.id) || !integer(c.version, 1) || !users.has(c.cashier_id) || !users.has(c.actor_id) || !integer(c.at_ms) || !['submitted', 'accepted'].includes(c.status) || !clean(c.reason, 500, c.version === 1)) fail();
    const input = json(c.input), result = json(c.result); let computed;
    try { computed = reconcileExcel(input); } catch { fail(); }
    if (!isDeepStrictEqual(computed, result) || (c.status === 'accepted' ? result.received === null : result.received !== null)) fail();
    const key = JSON.stringify([result.date, result.register.toLowerCase(), result.shiftNo.toLowerCase()]);
    if (c.shift_key !== key || (physical.has(key) && physical.get(key) !== c.id)) fail();
    physical.set(key, c.id);
    const versions = cash.get(c.id) ?? new Map(); if (versions.has(c.version)) fail(); versions.set(c.version, c); cash.set(c.id, versions);
  }
  for (const versions of cash.values()) {
    const first = versions.get(1); if (!first) fail();
    for (let n = 1; n <= versions.size; n++) { const row = versions.get(n); if (!row || row.shift_key !== first.shift_key || row.cashier_id !== first.cashier_id) fail(); }
  }
  const tasks = new Map(), products = new Map();
  for (const r of t.workspace_tasks) {
    if (!id(r.id) || tasks.has(r.id) || !integer(r.version, 1) || !users.has(r.creator_id) || !users.has(r.assignee_id) || !clean(r.title, 200) || !['open', 'done'].includes(r.status) || !integer(r.at_ms) || (r.related_cash !== null && !cash.has(r.related_cash))) fail(); tasks.set(r.id, r);
  }
  for (const p of t.workspace_products) {
    if (!id(p.id) || products.has(p.id) || !integer(p.version, 1) || !clean(p.name, 150) || typeof p.barcode !== 'string' || !/^\d{0,32}$/.test(p.barcode) || !integer(p.price) || p.price > 99999999999 || ![0, 1].includes(p.active)) fail(); products.set(p.id, p);
  }
  const procurement = new Map();
  for (const r of t.workspace_procurement ?? []) {
    if (!id(r.id) || !integer(r.version, 1) || !PROCUREMENT_KINDS.includes(r.kind) || !users.has(r.actor_id) || !integer(r.at_ms) || !clean(r.reason, 500, r.version === 1)) fail();
    const data = json(r.data, 65536); try { validateProcurementDocument(r.kind, data); } catch { fail(); }
    const versions = procurement.get(r.id) ?? new Map(); if (versions.has(r.version)) fail(); versions.set(r.version, r); procurement.set(r.id, versions);
  }
  for (const versions of procurement.values()) {
    const first = versions.get(1); if (!first || (first.kind === 'receipt' && versions.size !== 1)) fail();
    for (let n = 1; n <= versions.size; n++) {
      const r = versions.get(n); if (!r || r.kind !== first.kind) fail();
      const eventsForVersion = t.account_events.filter(e => e.kind === 'procurement.changed' && e.subject_id === r.id && JSON.parse(e.detail).version === n);
      if (eventsForVersion.length !== 1) fail();
      const e = eventsForVersion[0], d = JSON.parse(e.detail);
      if (e.actor_id !== r.actor_id || e.at_ms < r.at_ms || d.kind !== r.kind || d.reason !== r.reason || !isDeepStrictEqual(d.after, JSON.parse(r.data)) || !isDeepStrictEqual(d.before, n === 1 ? null : JSON.parse(versions.get(n - 1).data))) fail();
    }
  }
  let procurementTotals;
  try { procurementTotals = procurementState([...procurement.values()].map(v => v.get(v.size)), t.workspace_products); } catch { fail(); }
  const finance = new Map(), financialAudit = new Map();
  for (const e of t.account_events.filter(e => e.kind === 'finance.changed')) {
    const d = JSON.parse(e.detail), key = `${e.subject_id}:${d.version}`;
    if (financialAudit.has(key)) fail(); financialAudit.set(key, e);
  }
  for (const r of t.workspace_finance ?? []) {
    if (!id(r.id) || !integer(r.version, 1) || !FINANCE_KINDS.includes(r.kind) || !users.has(r.actor_id) || !integer(r.at_ms) || !clean(r.reason, 500, r.version === 1 && r.kind !== 'reversal')) fail();
    const data = json(r.data, 65536); try { validateFinanceDocument(r.kind, data); } catch { fail(); }
    const versions = finance.get(r.id) ?? new Map(); if (versions.has(r.version)) fail(); versions.set(r.version, r); finance.set(r.id, versions);
  }
  for (const versions of finance.values()) {
    const first = versions.get(1); if (!first || (['movement', 'reversal'].includes(first.kind) && versions.size !== 1)) fail();
    for (let n = 1; n <= versions.size; n++) {
      const r = versions.get(n); if (!r || r.kind !== first.kind) fail();
      const e = financialAudit.get(`${r.id}:${n}`); if (!e) fail(); const d = JSON.parse(e.detail);
      if (e.actor_id !== r.actor_id || e.at_ms < r.at_ms || d.kind !== r.kind || d.reason !== r.reason || !isDeepStrictEqual(d.after, JSON.parse(r.data)) || !isDeepStrictEqual(d.before, n === 1 ? null : JSON.parse(versions.get(n - 1).data))) fail();
    }
  }
  for (const e of financialAudit.values()) { const d = JSON.parse(e.detail); if (!finance.get(e.subject_id)?.has(d.version)) fail(); }
  let financialTotals;
  try { financialTotals = financeState([...finance.values()].map(v => v.get(v.size)), procurementTotals, t.workspace_cash); } catch { fail(); }
  const requests = new Set();
  for (const r of t.workspace_requests) {
    if (!id(r.id) || requests.has(r.id) || !/^[a-f0-9]{64}$/.test(r.digest)) fail(); requests.add(r.id);
    const out = json(r.result, 1000);
    if (!exact(out, ['id', 'version']) || !id(out.id) || !integer(out.version, 1) || !(cash.get(out.id)?.has(out.version) || tasks.get(out.id)?.version >= out.version || products.get(out.id)?.version >= out.version || procurement.get(out.id)?.has(out.version) || finance.get(out.id)?.has(out.version))) fail();
  }
  // Every business revision must retain its original retry record and audit.
  const targets = new Set(t.workspace_requests.map(r => { const out = JSON.parse(r.result); return `${out.id}:${out.version}`; }));
  const audit = new Set(t.account_events.filter(e => ['cash.submitted', 'cash.accepted', 'task.changed', 'product.changed'].includes(e.kind)).map(e => { const d = JSON.parse(e.detail); return `${e.kind}:${e.subject_id}:${d.version ?? d.after?.version}`; }));
  for (const row of t.workspace_cash) if (!targets.has(`${row.id}:${row.version}`) || !audit.has(`cash.${row.status}:${row.id}:${row.version}`)) fail();
  for (const row of t.workspace_tasks) if (!targets.has(`${row.id}:${row.version}`) || !audit.has(`task.changed:${row.id}:${row.version}`)) fail();
  for (const row of t.workspace_products) if (!targets.has(`${row.id}:${row.version}`) || !audit.has(`product.changed:${row.id}:${row.version}`)) fail();
  for (const versions of procurement.values()) for (const r of versions.values()) if (!targets.has(`${r.id}:${r.version}`)) fail();
  for (const versions of finance.values()) for (const r of versions.values()) if (!targets.has(`${r.id}:${r.version}`)) fail();
  const draftIds = new Set(), draftSlots = new Set(); let drafts = 0;
  for (const d of t.workspace_drafts ?? []) {
    const user = users.get(d.user_id), key = `${d.user_id}:${d.slot}`;
    if (!id(d.id) || draftIds.has(d.id) || !user || !validDraftSlot(d.slot) || draftSlots.has(key) || !integer(d.version, 1) || !integer(d.base_version) || !integer(d.at_ms) || (d.request_id === null ? d.request_digest !== null : !id(d.request_id) || !/^[a-f0-9]{64}$/.test(d.request_digest))) fail();
    draftIds.add(d.id); draftSlots.add(key);
    if (d.fields !== null) {
      const fields = json(d.fields, 32768); try { validateDraftFields(fields); } catch { fail(); }
      if (!user.active || !['owner', 'accountant', 'cashier'].includes(user.role)) fail();
      if (user.role === 'cashier' && (fields.received || (fields.cashierId && fields.cashierId !== user.id))) fail();
      if (d.slot === 'new') { if (d.base_version !== 0) fail(); }
      else if (!cash.get(d.slot)?.has(d.base_version) || (user.role === 'cashier' && cash.get(d.slot).get(d.base_version).cashier_id !== user.id)) fail();
      drafts++;
    }
  }
  return { users: users.size, cash: cash.size, cashVersions: t.workspace_cash.length, tasks: tasks.size, products: products.size, drafts, suppliers: procurementTotals.suppliers.length, budgets: procurementTotals.budgets.length, orders: procurementTotals.orders.length, receipts: procurementTotals.receipts.length, reviews: procurementTotals.reviews.length, moneyAccounts: financialTotals.accounts.length, obligations: financialTotals.obligations.length, paymentPlans: financialTotals.plans.length, moneyMovements: financialTotals.movements.length, moneyCorrections: financialTotals.reversals.length, bankLines: financialTotals.bankLines.length, events: events.size, createdAt: archive.createdAt };
}
