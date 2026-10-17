import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { reconcile, InputError } from './domain.mjs';

export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const UUID = /^[a-f0-9-]{36}$/;
const REQUEST = /^[a-zA-Z0-9-]{16,80}$/;
export const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const shiftKey = result => JSON.stringify([result.date, result.register.toLowerCase(), result.shiftNo.toLowerCase()]);
export const requestHash = (input, version, id, reason) => checksum({ input, expectedVersion: version - 1, id: version === 1 ? null : id, reason });
function fail(message) { throw new InputError(`Архив: ${message}`); }
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function createArchive(revisions, requests) {
  const payload = { format: 'way-market-test-archive', version: 1,
    createdAt: new Date().toISOString(), revisions: revisions.map(r => ({ ...r })), requests: requests.map(r => ({ ...r })) };
  const result = { payload, sha256: checksum(payload) };
  validateArchive(result);
  return result;
}
export function validateArchive(archive) {
  if (!exactKeys(archive, ['payload', 'sha256'])) fail('неизвестная структура');
  const p = archive.payload;
  if (!exactKeys(p, ['format', 'version', 'createdAt', 'revisions', 'requests']) ||
      p.format !== 'way-market-test-archive' || p.version !== 1 || !timestamp(p.createdAt)) fail('неподдерживаемый формат или версия');
  if (!Array.isArray(p.revisions) || !Array.isArray(p.requests) || p.revisions.length > 10000 || p.requests.length !== p.revisions.length) fail('неверное число записей');
  let encoded;
  try { encoded = JSON.stringify(p); } catch { fail('не удалось прочитать структуру'); }
  if (Buffer.byteLength(encoded) > MAX_ARCHIVE_BYTES - 256) fail('превышен размер 16 МиБ');
  if (typeof archive.sha256 !== 'string' || archive.sha256 !== checksum(p)) fail('контрольная сумма не совпадает; файл изменён или повреждён');
  const revisions = new Map(), keys = new Map(), groups = new Map();
  for (const row of p.revisions) {
    if (!exactKeys(row, ['id', 'version', 'shift_key', 'created_at', 'input', 'result', 'reason']) ||
        typeof row.id !== 'string' || !UUID.test(row.id) || !Number.isSafeInteger(row.version) || row.version < 1 || !timestamp(row.created_at) ||
        typeof row.input !== 'string' || typeof row.result !== 'string' || typeof row.reason !== 'string' || row.reason.length > 500 || (row.version > 1 && !row.reason.trim())) fail('повреждена запись версии');
    let input, stored, calculated;
    try { input = JSON.parse(row.input); stored = JSON.parse(row.result); calculated = reconcile(input); }
    catch { fail('неверные исходные данные версии'); }
    if (!isDeepStrictEqual(stored, calculated) || row.shift_key !== shiftKey(calculated)) fail('сохранённый расчёт не соответствует исходным данным или версии формулы');
    const identity = `${row.id}/${row.version}`;
    if (revisions.has(identity)) fail('повтор версии');
    if (keys.has(row.shift_key) && keys.get(row.shift_key) !== row.id) fail('одна смена имеет разные идентификаторы');
    keys.set(row.shift_key, row.id); revisions.set(identity, row);
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.version - b.version);
    for (let i = 0; i < rows.length; i++) if (rows[i].version !== i + 1 || rows[i].shift_key !== rows[0].shift_key) fail('пропуск версии или изменение идентичности смены');
  }
  const requestIds = new Set(), targets = new Set();
  for (const r of p.requests) {
    if (!exactKeys(r, ['request_id', 'payload_hash', 'id', 'version']) || typeof r.request_id !== 'string' || !REQUEST.test(r.request_id) || !Number.isSafeInteger(r.version)) fail('неверный запрос сохранения');
    const identity = `${r.id}/${r.version}`, row = revisions.get(identity);
    if (!row || requestIds.has(r.request_id) || targets.has(identity)) fail('повтор запроса или нарушена связь с версией');
    if (r.payload_hash !== requestHash(JSON.parse(row.input), row.version, row.id, row.reason)) fail('запрос не соответствует снимку версии');
    requestIds.add(r.request_id); targets.add(identity);
  }
  return { shifts: groups.size, revisions: revisions.size, requests: requestIds.size, createdAt: p.createdAt, sha256: archive.sha256 };
}
