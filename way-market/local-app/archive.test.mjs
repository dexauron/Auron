import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from './store.mjs';
import { checksum, validateArchive } from './archive.mjs';
import { restoreToNewFile } from './restore.mjs';
import { createApp } from './server.mjs';

const input = () => ({ date: '2026-10-17', register: 'Касса', shiftNo: '1', cashier: 'Тест', author: 'Тест', accountant: '', opening: '0', zCash: '10000', otherIn: '0', retained: '0', claimed: '', received: '', zBasisConfirmed: true, payments: [] });
const payload = () => ({ requestId: randomUUID(), expectedVersion: 0, input: input() });
function fixture() {
  const store = openStore(':memory:'); const p = payload(); const first = store.save(p);
  const next = { requestId: randomUUID(), id: first.id, expectedVersion: 1, input: { ...input(), received: '10000', accountant: 'Тестовый бухгалтер' }, reason: 'Пересчитано' };
  store.save(next);
  return { store, p, next };
}
const resign = archive => { archive.sha256 = checksum(archive.payload); return archive; };

test('archive contains all revisions and restores request idempotency', () => {
  const { store, p, next } = fixture(), restored = openStore(':memory:');
  try {
    const archive = store.archive();
    assert.equal(validateArchive(archive).revisions, 2);
    assert.equal(restored.restoreArchive(archive).shifts, 1);
    assert.deepEqual(restored.list(), store.list());
    assert.equal(restored.save(p).version, 1); assert.equal(restored.save(next).version, 2);
    assert.equal(restored.history(store.list()[0].id).length, 2);
    assert.throws(() => restored.restoreArchive(archive), /пустую/);
    assert.equal(restored.list()[0].version, 2);
  } finally { store.close(); restored.close(); }
});
test('empty backup is valid and includes all shifts beyond screen limit', () => {
  const store = openStore(':memory:');
  try {
    assert.equal(validateArchive(store.archive()).shifts, 0);
    for (let i = 0; i < 105; i++) store.save({ ...payload(), input: { ...input(), shiftNo: String(i) } });
    assert.equal(store.list().length, 100);
    assert.equal(validateArchive(store.archive()).shifts, 105);
  } finally { store.close(); }
});
test('damaged archive and unsupported versions are rejected', () => {
  const { store } = fixture();
  try {
    const archive = store.archive(); archive.payload.revisions[0].reason = 'Повреждение';
    assert.throws(() => validateArchive(archive), /контрольная сумма/);
    archive.payload.version = 99; resign(archive);
    assert.throws(() => validateArchive(archive), /формат/);
    assert.throws(() => validateArchive({}), /структура/);
  } finally { store.close(); }
});
test('recalculated totals, formula versions and source amounts are independently validated', () => {
  const { store } = fixture();
  try {
    for (const edit of [
      a => { const r = JSON.parse(a.payload.revisions[0].result); r.expected++; a.payload.revisions[0].result = JSON.stringify(r); },
      a => { const r = JSON.parse(a.payload.revisions[0].result); r.formulaVersion = 'future'; a.payload.revisions[0].result = JSON.stringify(r); },
      a => { a.payload.revisions[0].input = '{}'; }
    ]) {
      const a = store.archive(); edit(a); resign(a); assert.throws(() => validateArchive(a));
    }
  } finally { store.close(); }
});
test('missing revision, orphan request, duplicate and incompatible shift IDs are rejected', () => {
  const { store } = fixture();
  try {
    for (const edit of [
      a => { a.payload.revisions.shift(); a.payload.requests = a.payload.requests.filter(r => r.version === 2); },
      a => { a.payload.requests[0].id = randomUUID(); },
      a => { a.payload.requests[0].payload_hash = '0'.repeat(64); },
      a => { a.payload.revisions[1] = structuredClone(a.payload.revisions[0]); },
      a => { a.payload.requests[1] = structuredClone(a.payload.requests[0]); },
      a => { a.payload.revisions[1].id = randomUUID(); }
    ]) {
      const a = store.archive(); edit(a); resign(a); assert.throws(() => validateArchive(a));
    }
  } finally { store.close(); }
});
test('archive order and JSON property order do not change meaning', () => {
  const { store } = fixture(), restored = openStore(':memory:');
  try {
    const a = store.archive(); a.payload.revisions.reverse(); a.payload.requests.reverse();
    a.payload.revisions = a.payload.revisions.map(r => Object.fromEntries(Object.entries(r).reverse())); resign(a);
    restored.restoreArchive(a); assert.deepEqual(restored.list(), store.list());
  } finally { store.close(); restored.close(); }
});
test('invalid restore does not insert any records', () => {
  const { store } = fixture(), restored = openStore(':memory:');
  try {
    const a = store.archive(); a.payload.requests[1].payload_hash = 'bad'; resign(a);
    assert.throws(() => restored.restoreArchive(a));
    assert.equal(restored.list().length, 0);
    restored.restoreArchive(store.archive()); assert.equal(restored.list().length, 1);
  } finally { store.close(); restored.close(); }
});
test('offline restore publishes a new verified DB, refuses overwrite and cleans staging files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'way-archive-')); const { store } = fixture();
  const source = join(dir, 'archive.json'), target = join(dir, 'restored.sqlite');
  try {
    await writeFile(source, JSON.stringify(store.archive()));
    const restoredInfo = await restoreToNewFile(source, target); assert.equal(restoredInfo.revisions, 2);
    const restored = openStore(target);
    try { assert.deepEqual(restored.list(), store.list()); } finally { restored.close(); }
    const originalBytes = await readFile(target);
    await assert.rejects(restoreToNewFile(source, target), { code: 'EEXIST' });
    assert.deepEqual(await readFile(target), originalBytes);
    assert.equal((await readdir(dir)).filter(n => n.startsWith('.way-restore-')).length, 0);
    await writeFile(source, '{bad'); await assert.rejects(restoreToNewFile(source, join(dir, 'bad.sqlite')), /JSON/);
    assert.equal((await readdir(dir)).includes('bad.sqlite'), false);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('HTTP download requires token; checking an archive never changes active data', async () => {
  const { store } = fixture(), server = createApp(store);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { token } = await (await fetch(base + '/api/session')).json();
    const post = (path, body, auth = token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': auth }, body: JSON.stringify(body) });
    assert.equal((await post('/api/archive/download', {}, '')).status, 403);
    const download = await post('/api/archive/download', {});
    assert.match(download.headers.get('content-disposition'), /attachment; filename="way-market-test-/);
    const archive = await download.json();
    assert.equal(validateArchive(archive).revisions, 2);
    const check = await post('/api/archive/check', archive);
    assert.equal(check.status, 200); assert.equal((await check.json()).shifts, 1);
    archive.sha256 = '0'.repeat(64);
    assert.equal((await post('/api/archive/check', archive)).status, 400);
    assert.equal(store.list().length, 1); assert.equal(store.list()[0].version, 2);
  } finally { await new Promise(r => server.close(r)); store.close(); }
});
