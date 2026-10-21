import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openWorkspace, emptySheet } from './workspace-store.mjs';
import { createWorkspaceServer } from './workspace-server.mjs';
import { validateWorkspaceArchive } from './workspace-archive.mjs';
import { backupWorker } from './workspace-backups.mjs';

const password = 'Длинная испытательная фраза 123';
let w, dir, filename, owner, cashier, other, accountant, admin, employee, representative;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'way-private-drafts-')); filename = join(dir, 'workspace.sqlite'); w = openWorkspace(filename);
  await w.accounts.bootstrapOwner({ login: 'owner', name: 'Владелец', password }); owner = await w.accounts.login({ login: 'owner', password });
  const sessions = [];
  for (const role of ['cashier', 'cashier', 'accountant', 'administrator', 'employee', 'representative']) {
    const login = `user-${sessions.length}`; await w.accounts.createUser(owner.token, { login, name: login, role, password }); sessions.push(await w.accounts.login({ login, password }));
  }
  [cashier, other, accountant, admin, employee, representative] = sessions;
});
after(async () => { w.close(); await rm(dir, { recursive: true, force: true }); });
const fields = user => ({ date: '', shiftNo: '', cashReport: '12,', suppliers: '', cashierId: user.user.id });
function draft(user, extras = {}) {
  const slot = extras.slot ?? 'new';
  return { slot, expectedVersion: w.draftGet(user.token, slot).version, baseVersion: 0, fields: fields(user), requestId: randomUUID(), ...extras };
}
function sheet() {
  const input = emptySheet(); input.date = '2026-10-19'; input.shiftNo = randomUUID();
  for (const row of input.worksheet.settings.rows) input.worksheet.values[row.id] = row.enabled && row.id !== 'received' ? '0' : '';
  input.worksheet.values.cashReport = '1000'; return input;
}
const submit = (input = sheet(), extras = {}) => ({ requestId: randomUUID(), expectedVersion: 0, accept: false, input, ...extras });

test('incomplete raw values survive reopening the database without creating a cash revision', () => {
  const p = draft(cashier); w.draftSave(cashier.token, p);
  assert.equal(w.cashList(cashier.token).length, 0);
  w.close(); w = openWorkspace(filename);
  assert.deepEqual(w.draftGet(cashier.token, 'new').fields, p.fields);
  assert.equal(w.draftList(cashier.token).length, 1);
  const history = w.accounts.securityHistory(owner.token);
  assert.equal(history.some(e => e.kind === 'cash-draft.saved'), true);
  // Numeric event metadata may end in 12 followed by a JSON comma. Verify the
  // permitted audit payload, rather than searching serialized timestamps.
  assert.deepEqual(history.filter(e => e.kind.startsWith('cash-draft.')).map(e => e.detail), [{ slot: 'new', version: 1 }]);
});
test('draft ownership comes from session, including owner views; noncash roles are denied', () => {
  assert.equal(w.draftGet(owner.token, 'new').fields, null);
  assert.equal(w.draftGet(other.token, 'new').fields, null);
  const p = draft(other); p.userId = cashier.user.id; w.draftSave(other.token, p);
  assert.equal(w.draftList(cashier.token).length, 1); assert.equal(w.draftList(other.token).length, 1);
  for (const user of [admin, employee, representative]) {
    assert.throws(() => w.draftList(user.token));
    assert.throws(() => w.draftGet(user.token, 'new'));
    assert.throws(() => w.draftSave(user.token, p));
  }
  assert.throws(() => w.draftList(''));
});
test('cashier cannot stash accountant receipt, another cashier identity or another shift', () => {
  assert.throws(() => w.draftSave(cashier.token, draft(cashier, { fields: { ...fields(cashier), received: '123' } })));
  assert.throws(() => w.draftSave(cashier.token, draft(cashier, { fields: fields(other) })));
  const saved = w.cashSave(other.token, submit());
  assert.throws(() => w.draftGet(cashier.token, saved.id));
  assert.throws(() => w.draftSave(cashier.token, { ...draft(cashier), slot: saved.id, baseVersion: 1 }));
});
test('retries are idempotent and other tabs cannot overwrite or delete a newer draft', () => {
  const p = draft(cashier), result = w.draftSave(cashier.token, p);
  assert.deepEqual(w.draftSave(cashier.token, p), result);
  assert.throws(() => w.draftSave(cashier.token, { ...p, fields: { ...p.fields, cashReport: '999' } }), /уже использована/);
  const connection = openWorkspace(filename);
  try {
    assert.throws(() => connection.draftSave(cashier.token, { ...p, requestId: randomUUID() }), /другой вкладке/);
    assert.throws(() => connection.draftSave(cashier.token, { ...p, requestId: randomUUID(), fields: null }), /другой вкладке/);
    assert.deepEqual(connection.draftGet(cashier.token, 'new').fields, p.fields);
  } finally { connection.close(); }
});
test('deletion retains a version tombstone so an old tab cannot resurrect or overwrite input', () => {
  const p = draft(cashier), previous = p.expectedVersion;
  const deleted = w.draftSave(cashier.token, { ...p, fields: null });
  assert.equal(w.draftGet(cashier.token, 'new').fields, null); assert.equal(w.draftList(cashier.token).length, 0);
  const recreated = w.draftSave(cashier.token, draft(cashier)); assert.equal(recreated.version, deleted.version + 1);
  assert.throws(() => w.draftSave(cashier.token, { ...draft(cashier), expectedVersion: previous }), /другой вкладке/);
});
test('cash submission and draft consumption commit atomically; a lost reply can be retried', () => {
  const savedDraft = w.draftSave(cashier.token, draft(cashier));
  const invalid = submit(); invalid.input.date = '';
  assert.throws(() => w.cashSave(cashier.token, { ...invalid, draft: { slot: 'new', version: savedDraft.version } }));
  assert.ok(w.draftGet(cashier.token, 'new').fields);
  const p = submit(sheet(), { draft: { slot: 'new', version: savedDraft.version } });
  const result = w.cashSave(cashier.token, p);
  assert.equal(w.draftGet(cashier.token, 'new').fields, null);
  assert.deepEqual(w.cashSave(cashier.token, p), result);
  const count = w.cashList(cashier.token).length;
  w.draftSave(cashier.token, draft(cashier));
  assert.throws(() => w.cashSave(cashier.token, submit(sheet(), { draft: { slot: 'new', version: savedDraft.version } })), /Черновик изменён/);
  assert.equal(w.cashList(cashier.token).length, count); assert.ok(w.draftGet(cashier.token, 'new').fields);
});
test('newer business revisions are flagged; accepting cash does not authorize cashier draft corrections', () => {
  const p = submit(), saved = w.cashSave(cashier.token, p);
  w.draftSave(cashier.token, draft(cashier, { slot: saved.id, baseVersion: 1 }));
  const acceptedInput = structuredClone(p.input); acceptedInput.worksheet.values.received = '1000';
  w.cashSave(accountant.token, { ...submit(acceptedInput), id: saved.id, expectedVersion: 1, reason: 'Пересчёт', accept: true });
  assert.equal(w.draftGet(cashier.token, saved.id).outdated, true);
  assert.throws(() => w.draftSave(cashier.token, draft(cashier, { slot: saved.id, baseVersion: 1 })), /Сдача уже изменена/);
  assert.throws(() => w.draftSave(cashier.token, draft(cashier, { slot: saved.id, baseVersion: 2 })));
});
test('changing role clears private drafts and revokes old sessions in the same transaction', async () => {
  await w.accounts.createUser(owner.token, { login: 'demotion', name: 'Бухгалтер', role: 'accountant', password });
  const user = await w.accounts.login({ login: 'demotion', password });
  w.draftSave(user.token, draft(user, { fields: { received: '321.09' } }));
  w.accounts.updateUser(owner.token, { id: user.user.id, expectedVersion: 1, name: user.user.name, active: true, role: 'cashier', reason: 'Смена должности' });
  assert.throws(() => w.draftGet(user.token, 'new'));
  const next = await w.accounts.login({ login: 'demotion', password });
  assert.equal(w.draftGet(next.token, 'new').fields, null);
});
test('draft schema rejects nested, nonstring, credential and oversized payloads', () => {
  for (const invalid of [{ cashReport: 12 }, { cashReport: {} }, { password: 'secret' }, { reason: 'x'.repeat(501) }, { reason: 'line\nbreak' }, [], {}]) {
    assert.throws(() => w.draftSave(cashier.token, draft(cashier, { fields: invalid })));
  }
  assert.throws(() => w.draftSave(cashier.token, draft(cashier, { expectedVersion: 0.5 })));
  assert.throws(() => w.draftGet(cashier.token, '../workspace.sqlite'));
});
function resign(archive) { const { digest, ...payload } = archive; archive.digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex'); return archive; }
test('encrypted version 2 backup restores private raw drafts and validates their user and cash links', async () => {
  const encrypted = await backupWorker({ operation: 'encrypt', password, tables: w.accounts.workspaceSnapshot(owner.token) });
  const { archive } = await backupWorker({ operation: 'decrypt', password, bytes: encrypted.bytes });
  assert.equal(archive.version, 5); assert.ok(validateWorkspaceArchive(archive).drafts > 0);
  const restored = openWorkspace(':memory:');
  try {
    restored.accounts.restoreWorkspace(archive, owner.user.id);
    const login = await restored.accounts.login({ login: 'user-0', password });
    assert.deepEqual(restored.draftGet(login.token, 'new').fields, w.draftGet(cashier.token, 'new').fields);
    await backupWorker({ operation: 'check-restore', archive, tables: restored.accounts.workspaceSnapshot({ id: owner.user.id, version: owner.user.version }) });
  } finally { restored.close(); }
  for (const mutate of [a => { a.tables.workspace_drafts[0].user_id = randomUUID(); }, a => { a.tables.workspace_drafts.push(a.tables.workspace_drafts[0]); }, a => { const row = a.tables.workspace_drafts.find(r => r.fields); row.fields = '{"password":"secret"}'; }]) {
    const invalid = structuredClone(archive); mutate(invalid); assert.throws(() => validateWorkspaceArchive(resign(invalid)));
  }
});
test('version 1 backups remain restorable and are compared with an empty draft table', async () => {
  const encrypted = await backupWorker({ operation: 'encrypt', password, tables: w.accounts.workspaceSnapshot(owner.token) });
  const { archive } = await backupWorker({ operation: 'decrypt', password, bytes: encrypted.bytes });
  archive.version = 1; delete archive.tables.workspace_drafts; delete archive.tables.workspace_procurement; delete archive.tables.workspace_finance; delete archive.tables.workspace_catalog; archive.tables.account_events = archive.tables.account_events.filter(e => e.kind !== 'catalog.changed'); resign(archive); validateWorkspaceArchive(archive);
  const restored = openWorkspace(':memory:');
  try {
    restored.accounts.restoreWorkspace(archive, owner.user.id);
    const login = await restored.accounts.login({ login: 'owner', password }); assert.deepEqual(restored.draftList(login.token), []);
    await backupWorker({ operation: 'check-restore', archive, tables: restored.accounts.workspaceSnapshot({ id: owner.user.id, version: owner.user.version }) });
  } finally { restored.close(); }
});
test('HTTP draft routes require session, role and CSRF and return conflict without leaking other drafts', async t => {
  const { server } = createWorkspaceServer(w); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, csrf = (await (await fetch(base + '/api/session')).json()).csrf;
  assert.equal((await fetch(base + '/api/cash-drafts')).status, 401);
  assert.equal((await fetch(base + '/api/cash-drafts', { headers: { Cookie: `way_workspace=${employee.token}` } })).status, 403);
  const p = draft(cashier), headers = { Cookie: `way_workspace=${cashier.token}`, 'Content-Type': 'application/json', 'X-Way-Token': csrf };
  assert.equal((await fetch(base + '/api/cash-drafts', { method: 'POST', headers: { ...headers, 'X-Way-Token': '' }, body: JSON.stringify(p) })).status, 403);
  assert.equal((await fetch(base + '/api/cash-drafts', { method: 'POST', headers: { ...headers, 'X-Way-Account': other.user.id }, body: JSON.stringify(p) })).status, 403);
  const saved = await fetch(base + '/api/cash-drafts', { method: 'POST', headers, body: JSON.stringify(p) }); assert.equal(saved.status, 200);
  assert.equal((await fetch(base + '/api/cash-drafts', { method: 'POST', headers, body: JSON.stringify({ ...p, requestId: randomUUID() }) })).status, 409);
  const read = await fetch(base + '/api/cash-drafts/new', { headers }); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.deepEqual((await read.json()).fields, p.fields);
});
