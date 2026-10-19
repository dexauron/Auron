// Private raw form snapshots. A draft is never a cash revision or an accepted sum.
import { createHash, randomUUID } from 'node:crypto';
import { InputError } from './domain.mjs';
import { AccessError } from './access.mjs';
import { EXCEL_FIELDS } from './worksheet.mjs';

export class DraftConflictError extends Error {}
const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
export const validDraftSlot = v => v === 'new' || uuid(v);
const allowed = new Set(['date', 'shiftNo', 'cashierId', 'cashBasis', 'policy-cashReturns', 'policy-bankReturns', 'ownerKind', 'receipts', 'documents', 'reason', ...EXCEL_FIELDS.map(f => f.id)]);
export function validateDraftFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.keys(fields).length || Object.keys(fields).length > 100 || Buffer.byteLength(JSON.stringify(fields)) > 32768) throw new InputError('Неверный или слишком большой черновик');
  for (const [key, value] of Object.entries(fields)) {
    if ((!allowed.has(key) && !/^custom-[a-f0-9-]{36}$/.test(key)) || typeof value !== 'string' || value.length > 500 || /[\x00-\x1f]/.test(value)) throw new InputError('Неверные поля черновика');
  }
  return fields;
}
const getRow = (db, user, slot) => db.prepare('SELECT * FROM workspace_drafts WHERE user_id=? AND slot=?').get(user, slot);
const latest = (db, slot) => slot === 'new' ? null : db.prepare('SELECT * FROM workspace_cash WHERE id=? ORDER BY version DESC LIMIT 1').get(slot);
const manages = actor => ['owner', 'accountant'].includes(actor.role);
function resource(db, actor, slot) {
  if (!validDraftSlot(slot)) throw new InputError('Неверный идентификатор черновика');
  const cash = latest(db, slot);
  if (slot !== 'new' && (!cash || (!manages(actor) && cash.cashier_id !== actor.id))) throw new AccessError();
  return cash;
}
const view = (row, slot) => ({ slot, version: row?.version ?? 0, baseVersion: row?.base_version ?? 0, fields: row?.fields ? JSON.parse(row.fields) : null, at: row?.at_ms ?? null });
export function readDraft(db, actor, slot) {
  const cash = resource(db, actor, slot), row = getRow(db, actor.id, slot);
  return { ...view(row, slot), outdated: Boolean(row?.fields && cash && cash.version !== row.base_version) };
}
export function listDrafts(db, actor) {
  return db.prepare('SELECT * FROM workspace_drafts WHERE user_id=? AND fields IS NOT NULL ORDER BY at_ms DESC,id').all(actor.id).map(row => readDraft(db, actor, row.slot));
}
export function writeDraft(db, actor, audit, at, p) {
  if (!p || !validDraftSlot(p.slot) || !uuid(p.requestId) || !Number.isSafeInteger(p.expectedVersion) || p.expectedVersion < 0 || !Number.isSafeInteger(p.baseVersion) || p.baseVersion < 0) throw new InputError('Проверьте версию черновика');
  const cash = resource(db, actor, p.slot), old = getRow(db, actor.id, p.slot);
  const digest = createHash('sha256').update(JSON.stringify({ slot: p.slot, baseVersion: p.baseVersion, expectedVersion: p.expectedVersion, fields: p.fields })).digest('hex');
  if (old?.request_id === p.requestId) {
    if (old.request_digest !== digest) throw new DraftConflictError('Команда черновика уже использована');
    return { slot: p.slot, version: old.version, at: old.at_ms, empty: old.fields === null };
  }
  if ((old?.version ?? 0) !== p.expectedVersion) throw new DraftConflictError('Черновик изменён в другой вкладке. Сохранённый ввод не перезаписан.');
  if (p.fields !== null) {
    validateDraftFields(p.fields);
    if (p.baseVersion !== (cash?.version ?? 0)) throw new DraftConflictError('Сдача уже изменена. Черновик не перезаписан.');
    if (!manages(actor) && (cash?.status === 'accepted' || (p.fields.received && p.fields.received !== '') || (p.fields.cashierId && p.fields.cashierId !== actor.id))) throw new AccessError();
    if (!old?.fields && db.prepare('SELECT COUNT(*) n FROM workspace_drafts WHERE user_id=? AND fields IS NOT NULL').get(actor.id).n >= 100) throw new InputError('Сохранено 100 черновиков. Завершите или удалите ненужный.');
  }
  const version = (old?.version ?? 0) + 1, id = old?.id ?? randomUUID();
  db.prepare('INSERT INTO workspace_drafts VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,slot) DO UPDATE SET version=excluded.version,base_version=excluded.base_version,fields=excluded.fields,at_ms=excluded.at_ms,request_id=excluded.request_id,request_digest=excluded.request_digest').run(id, actor.id, p.slot, version, p.baseVersion, p.fields === null ? null : JSON.stringify(p.fields), at, p.requestId, digest);
  audit(p.fields === null ? 'cash-draft.discarded' : 'cash-draft.saved', id, { slot: p.slot, version });
  return { slot: p.slot, version, at, empty: p.fields === null };
}
export function consumeDraft(db, actor, audit, at, p) {
  if (p.draft === undefined) return; // Older callers do not delete unrelated drafts.
  const d = p.draft, slot = p.id ?? 'new';
  if (!d || d.slot !== slot || !Number.isSafeInteger(d.version) || d.version < 1) throw new InputError('Проверьте черновик сдачи');
  const old = getRow(db, actor.id, slot);
  if (!old?.fields || old.version !== d.version || old.base_version !== p.expectedVersion) throw new DraftConflictError('Черновик изменён. Сдача не отправлена; обновите черновик.');
  db.prepare('UPDATE workspace_drafts SET fields=NULL,version=version+1,at_ms=?,request_id=NULL,request_digest=NULL WHERE id=?').run(at, old.id);
  audit('cash-draft.submitted', old.id, { slot, version: old.version + 1 });
}
