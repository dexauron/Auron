import { Worker } from 'node:worker_threads';
import { constants } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, lstat, link, unlink, rm, copyFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { InputError } from './domain.mjs';
import { openWorkspace } from './workspace-store.mjs';
import { MAX_WORKSPACE_BYTES } from './workspace-archive.mjs';
import { AccessError } from './access.mjs';
import { setTimeout as pause } from 'node:timers/promises';

const pattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.wmbackup$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function backupWorker(data) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backup-worker.mjs', import.meta.url), { workerData: data, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } });
    let settled = false;
    const timer = setTimeout(() => { worker.terminate(); reject(new InputError('Проверка копии превысила допустимое время')); }, 120000); timer.unref();
    worker.once('message', result => { settled = true; clearTimeout(timer); result.error ? reject(new InputError(result.error)) : resolve(result); });
    worker.once('error', error => { clearTimeout(timer); reject(new Error('Не удалось выполнить обработку резервной копии')); });
    worker.once('exit', code => { clearTimeout(timer); if (!settled) reject(new Error('Обработка резервной копии прервана')); });
  });
}
export function createBackupService(workspace, { directory, restoreDirectory, intervalUnitMs = 60000, linkFile = link } = {}) {
  if (!isAbsolute(directory ?? '') || !isAbsolute(restoreDirectory ?? '')) throw new Error('Папки резервирования должны быть абсолютными');
  const accounts = workspace.accounts;
  let busy = false, closing = false, lastError = '', lastSuccess = null, schedule = null, timer = null;
  const unpublished = new Set();
  const allowed = token => accounts.authorize(token, 'backup.manage');
  const currentProof = proof => accounts.backupActor(proof);
  const errorText = e => e instanceof InputError || e instanceof AccessError ? e.message : ({ ENOSPC: 'Недостаточно свободного места для резервной копии', EACCES: 'Нет доступа к папке резервирования', EPERM: 'Операция с папкой резервирования запрещена системой', ENOENT: 'Папка или файл резервной копии недоступны', ENOTDIR: 'Выбранный путь не является папкой резервирования' }[e.code] ?? 'Операция резервирования завершилась ошибкой. Проверьте состояние сервера и повторите проверку');
  async function exclusive(run, proof) {
    if (closing) throw new InputError('Сервер останавливается');
    if (busy) throw new InputError('Уже выполняется операция с резервной копией');
    busy = true;
    try { const result = await run(); lastError = ''; return result; }
    catch (error) { lastError = errorText(error); if (proof) { try { accounts.backupEvent(proof, 'failed', { reason: lastError }); } catch {} } throw error; }
    finally { busy = false; }
  }
  async function bytesFor(id) {
    if (typeof id !== 'string' || !pattern.test(id)) throw new InputError('Неверное имя резервной копии');
    if (unpublished.has(id)) throw new InputError('Создание этой копии ещё не завершено');
    const path = join(directory, id), info = await lstat(path, { bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_WORKSPACE_BYTES + 100 || info.size < 64) throw new InputError('Неверный файл резервной копии');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const actual = await file.stat({ bigint: true });
      if (!actual.isFile() || actual.dev !== info.dev || actual.ino !== info.ino || actual.size !== info.size) throw new InputError('Файл изменён во время чтения');
      const bytes = Buffer.alloc(Number(actual.size)); let offset = 0;
      while (offset < bytes.length) { const out = await file.read(bytes, offset, bytes.length - offset, offset); if (!out.bytesRead) throw new InputError('Неполный файл резервной копии'); offset += out.bytesRead; }
      const magic = Buffer.from('WAYMARKET-BACKUP-1\n');
      if (!bytes.subarray(0, magic.length).equals(magic)) throw new InputError('Неверный формат резервной копии');
      return bytes;
    } finally { await file.close(); }
  }
  async function create(proof, password) {
    return exclusive(async () => {
      currentProof(proof); const snapshot = accounts.workspaceSnapshot(proof, { withMetadata: true });
      const result = await backupWorker({ operation: 'encrypt', password, ...snapshot });
      currentProof(proof);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const id = `${randomUUID()}.wmbackup`, temp = join(directory, `.creating-${randomUUID()}`), final = join(directory, id);
      let published = false;
      unpublished.add(id);
      try {
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(result.bytes); await file.sync(); } finally { await file.close(); }
        // Verify actual disk bytes, cryptography and business data before publish.
        await backupWorker({ operation: 'decrypt', password, bytes: await readFile(temp) });
        currentProof(proof);
        try { await linkFile(temp, final); published = true; }
        catch (error) {
          if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'EINVAL'].includes(error.code)) throw error;
          // FAT/exFAT and some shares cannot create hard links. Never overwrite
          // an existing generation; keep this file hidden until verified.
          try { await copyFile(temp, final, constants.COPYFILE_EXCL); published = true; }
          catch (copyError) { if (copyError.code !== 'EEXIST') await unlink(final).catch(() => {}); throw copyError; }
          const copied = await open(final, 'r+'); try { await copied.sync(); } finally { await copied.close(); }
          if (digest(await readFile(final)) !== digest(result.bytes)) throw new InputError('Копия на носителе отличается от проверенного файла');
        }
        const metadata = { id, at: new Date().toISOString(), bytes: result.bytes.length, digest: digest(result.bytes), stats: result.stats };
        accounts.backupEvent(proof, 'completed', metadata); lastSuccess = metadata;
        return metadata;
      } catch (error) { if (published) await unlink(final).catch(() => {}); throw error; }
      finally { unpublished.delete(id); await unlink(temp).catch(() => {}); }
    }, proof);
  }
  async function confirmation(token, currentPassword) { allowed(token); await accounts.confirmPassword(token, currentPassword); allowed(token); }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; schedule = null; }
  return {
    health(proof) {
      const saved = accounts.backupState(proof), latest = saved.lastOperation;
      return { lastError: lastError || (latest?.kind === 'backup.failed' ? latest.detail.reason : ''), hasSuccessfulCopy: Boolean(lastSuccess || saved.lastSuccess), scheduleNeedsUnlock: !schedule && saved.lastSchedule === 'backup.schedule-enabled' };
    },
    async status(token) {
      allowed(token);
      let files = [];
      try { files = await readdir(directory); } catch (e) { if (e.code !== 'ENOENT') lastError = errorText(e); }
      const list = [];
      for (const id of files.filter(f => pattern.test(f) && !unpublished.has(f))) { const s = await lstat(join(directory, id)); if (s.isFile() && !s.isSymbolicLink()) list.push({ id, bytes: s.size, at: s.mtime.toISOString() }); }
      allowed(token);
      const saved = accounts.backupState(token), latestSuccess = lastSuccess ?? saved.lastSuccess;
      const lastSchedule = saved.lastSchedule, lastOperation = saved.lastOperation;
      return { busy, lastError: lastError || (lastOperation?.kind === 'backup.failed' ? lastOperation.detail.reason : ''), lastSuccess: latestSuccess, lastSuccessPresent: Boolean(latestSuccess && list.some(f => f.id === latestSuccess.id)), scheduleNeedsUnlock: !schedule && lastSchedule === 'backup.schedule-enabled', directory, restoreDirectory, schedule: schedule ? { minutes: schedule.minutes, nextAt: schedule.nextAt, ownerId: schedule.proof.id } : null, files: list.sort((a, b) => b.at.localeCompare(a.at)), automaticKeyPersisted: false };
    },
    async create(token, { password, passwordAgain, currentPassword }) { allowed(token); if (password !== passwordAgain) throw new InputError('Пароли резервной копии не совпадают'); await confirmation(token, currentPassword); return create(token, password); },
    async download(token, { id, currentPassword }) { await confirmation(token, currentPassword); const bytes = await bytesFor(id); allowed(token); accounts.backupEvent(token, 'downloaded', { id }); return bytes; },
    async verify(token, { id, password, currentPassword }) {
      await confirmation(token, currentPassword);
      return exclusive(async () => { const result = await backupWorker({ operation: 'decrypt', password, bytes: await bytesFor(id) }); allowed(token); accounts.backupEvent(token, 'verified', { id, stats: result.stats }); return result.stats; }, token);
    },
    async restore(token, { id, password, currentPassword }) {
      await confirmation(token, currentPassword);
      return exclusive(async () => {
        const { archive, stats } = await backupWorker({ operation: 'decrypt', password, bytes: await bytesFor(id) });
        const actor = allowed(token);
        await mkdir(restoreDirectory, { recursive: true, mode: 0o700 });
        const folder = await mkdtemp(join(restoreDirectory, 'copy-')), path = join(folder, 'workspace-test.sqlite');
        let restored;
        try {
          restored = openWorkspace(path); restored.accounts.restoreWorkspace(archive, actor.id); restored.accounts.checkpoint();
          const restoredOwner = archive.tables.account_users.find(u => u.active && u.role === 'owner');
          const check = await backupWorker({ operation: 'check-restore', archive, tables: restored.accounts.workspaceSnapshot({ id: restoredOwner.id, version: restoredOwner.version }) });
          for (const key of ['users', 'cash', 'cashVersions', 'tasks', 'products']) if (check.stats[key] !== stats[key]) throw new Error('Проверка восстановления не совпала');
          restored.accounts.checkpoint(); restored.close(); restored = null;
          allowed(token); accounts.backupEvent(token, 'restore-checked', { id, path, stats });
          return { path, stats, switched: false, sessionsRestored: false };
        } catch (error) { restored?.close(); await rm(folder, { recursive: true, force: true }); throw error; }
      }, token);
    },
    async configure(token, { password, passwordAgain, currentPassword, minutes }) {
      allowed(token); if (password !== passwordAgain) throw new InputError('Пароли резервной копии не совпадают');
      await confirmation(token, currentPassword);
      if (!Number.isSafeInteger(minutes) || minutes < 10 || minutes > 1440) throw new InputError('Период резервирования: 10–1440 минут');
      // First copy must succeed before replacing the old schedule/key.
      const first = await create(token, password), actor = allowed(token);
      if (closing) throw new InputError('Сервер останавливается');
      stopTimer(); schedule = { minutes, password, proof: { id: actor.id, version: actor.version }, nextAt: new Date(Date.now() + minutes * intervalUnitMs).toISOString() };
      timer = setInterval(async () => {
        if (!schedule || busy) return;
        const active = schedule;
        try { currentProof(active.proof); await create(active.proof, active.password); }
        catch (error) { lastError = errorText(error); if (error.name === 'AccessError') stopTimer(); }
        if (schedule === active) active.nextAt = new Date(Date.now() + minutes * intervalUnitMs).toISOString();
      }, minutes * intervalUnitMs); timer.unref();
      accounts.backupEvent(token, 'schedule-enabled', { minutes, keyPersistence: 'memory-only' });
      return { first, minutes, keyPersistence: 'memory-only' };
    },
    async disable(token, { currentPassword }) { await confirmation(token, currentPassword); stopTimer(); accounts.backupEvent(token, 'schedule-disabled'); return { disabled: true }; },
    async close() { closing = true; stopTimer(); while (busy) await pause(20); }
  };
}
