import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { money, reconcile } from './domain.mjs';
import { openStore, ConflictError } from './store.mjs';
import { createApp } from './server.mjs';

const input = (extra = {}) => ({ date: '2026-10-15', register: 'Касса 1', shiftNo: '125', cashier: 'Кассир', author: 'Автор', accountant: 'Бухгалтер', opening: '2500', zCash: '30000', otherIn: '0', retained: '0', claimed: '24900', received: '24800', zBasisConfirmed: true, payments: [{ recipient: 'Поставщик', document: 'Н-1', source: 'cash', amount: '7500', confirmed: true }], ...extra });
const payload = (extra = {}) => ({ requestId: randomUUID(), expectedVersion: 0, input: input(), ...extra });

test('decimal amounts use exact integer kopecks', () => {
  assert.equal(money('0,01'), 1); assert.equal(money('100.10'), 10010);
  assert.equal(money('999999999.99'), 99999999999);
  for (const v of ['', ' ', '1.001', '-1', '1e3', 'Infinity', '1 000', '1000000000', null, 12, [], {}]) assert.throws(() => money(v));
});
test('cash transfer keeps expected, claimed, received separate', () => {
  const r = reconcile(input());
  assert.equal(r.expected, 2500000); assert.equal(r.cashPaid, 750000);
  assert.equal(r.claimedDifference, -10000); assert.equal(r.transferDifference, -10000); assert.equal(r.receivedDifference, -20000);
});
test('only completed cash payments are deducted', () => {
  for (const source of ['card', 'sbp']) assert.equal(reconcile(input({ payments: [{ ...input().payments[0], source }] })).expected, 3250000);
  assert.equal(reconcile(input({ payments: [{ ...input().payments[0], confirmed: false }] })).expected, 3250000);
  assert.equal(reconcile(input({ payments: [] })).expected, 3250000);
});
test('missing count is not zero; explicit zero remains zero', () => {
  const r = reconcile(input({ received: '', claimed: '', accountant: '' }));
  assert.equal(r.expected, 2500000); assert.equal(r.receivedDifference, null); assert.equal(r.transferDifference, null);
  assert.equal(reconcile(input({ received: '0' })).receivedDifference, -2500000);
  assert.throws(() => reconcile(input({ opening: '' })));
});
test('rejects invalid dates, tax/cash basis, source and receiver metadata', () => {
  for (const date of ['2026-02-31', '2026-13-01', '15.10.2026']) assert.throws(() => reconcile(input({ date })));
  assert.throws(() => reconcile(input({ zBasisConfirmed: false })));
  assert.throws(() => reconcile(input({ accountant: '' })));
  assert.throws(() => reconcile(input({ payments: [null] })));
  assert.throws(() => reconcile(input({ payments: [{ ...input().payments[0], source: 'unknown' }] })));
  assert.throws(() => reconcile(input({ payments: [{ ...input().payments[0], confirmed: 'true' }] })));
});
test('negative expected remains visible with a warning', () => {
  const r = reconcile(input({ opening: '0', zCash: '1' }));
  assert.equal(r.expected, -749900); assert.equal(r.warnings.length, 1);
});
test('same request retry returns same version without double writes', () => {
  const store = openStore(':memory:');
  try { const p = payload(); const a = store.save(p); assert.deepEqual(store.save(p), a); assert.equal(store.list().length, 1); assert.equal(store.history(a.id).length, 1);
    assert.throws(() => store.save({ ...p, input: input({ received: '1' }) }), ConflictError);
  } finally { store.close(); }
});
test('duplicate shift blocked even under a new request ID', () => {
  const store = openStore(':memory:');
  try { store.save(payload()); assert.throws(() => store.save(payload()), ConflictError); assert.equal(store.list().length, 1); }
  finally { store.close(); }
});
test('corrections append snapshots and reject a stale version', () => {
  const store = openStore(':memory:');
  try {
    const a = store.save(payload());
    const p = payload({ id: a.id, expectedVersion: 1, reason: 'Исправлен пересчёт', input: input({ received: '25000' }) });
    const b = store.save(p); assert.equal(b.version, 2); assert.equal(b.result.receivedDifference, 0);
    assert.equal(store.history(a.id)[1].result.receivedDifference, -20000);
    assert.throws(() => store.save({ ...p, requestId: randomUUID() }), ConflictError);
    assert.deepEqual(store.save(p), b);
    assert.equal(store.history(a.id).length, 2);
  } finally { store.close(); }
});
test('a rejected correction leaves no partial revision or retry row', () => {
  const store = openStore(':memory:');
  try {
    const a = store.save(payload()); const p = payload({ id: a.id, expectedVersion: 1, reason: 'Правка', input: input({ date: '2026-10-16' }) });
    assert.throws(() => store.save(p)); assert.equal(store.history(a.id).length, 1);
    p.input = input({ received: '25000' }); assert.equal(store.save(p).version, 2);
    assert.throws(() => store.save(payload({ id: a.id, expectedVersion: 2, reason: '' })));
  } finally { store.close(); }
});
test('SQLite data survives closing and reopening the service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'way-test-')); const file = join(dir, 'cash.sqlite');
  let store = openStore(file);
  try { const a = store.save(payload()); store.close(); store = openStore(file); assert.deepEqual(store.get(a.id), a); }
  finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('two database connections cannot overwrite an existing revision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'way-test-')); const file = join(dir, 'cash.sqlite');
  const a = openStore(file), b = openStore(file);
  try { const r = a.save(payload()); a.save(payload({ id: r.id, expectedVersion: 1, reason: 'Правка А' }));
    assert.throws(() => b.save(payload({ id: r.id, expectedVersion: 1, reason: 'Правка Б' })), ConflictError);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('HTTP integration: local assets, origin/CSRF protection and persistent corrections', async () => {
  const store = openStore(':memory:'); const server = createApp(store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await page.text(), /Сверка смены/);
    assert.equal((await fetch(base + '/store.mjs')).status, 404);
    assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'http://evil.example' } })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(base + '/api/session', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(badHost, 403);
    const { token } = await (await fetch(base + '/api/session')).json();
    assert.equal((await fetch(base + '/api/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) })).status, 403);
    const post = body => fetch(base + '/api/shifts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Way-Token': token }, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    const p = payload(); const saved = await (await post(p)).json(); assert.equal(saved.version, 1);
    assert.deepEqual(await (await post(p)).json(), saved);
    assert.equal((await post(payload())).status, 409);
    const updated = await (await post(payload({ id: saved.id, expectedVersion: 1, reason: 'Правка', input: input({ received: '25000' }) }))).json();
    assert.equal(updated.version, 2);
    assert.equal((await (await fetch(base + `/api/shifts/${saved.id}/history`)).json()).length, 2);
    assert.equal((await (await fetch(base + '/api/shifts')).json()).length, 1);
    assert.equal((await post(payload({ input: input({ author: 'X'.repeat(70000) }) }))).status, 413);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
