import { stat, readFile, mkdtemp, link, unlink, rmdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { openStore } from './store.mjs';
import { MAX_ARCHIVE_BYTES, validateArchive } from './archive.mjs';

// Restores only to a NEW file. Hard-link publication fails atomically if the
// target exists. No source DB or active DB is modified. No arbitrary SQL import.
export async function restoreToNewFile(source, destination) {
  const sourcePath = resolve(source), target = resolve(destination);
  if (sourcePath === target) throw new Error('Исходный архив и новая база должны иметь разные пути');
  if (!(await stat(sourcePath)).isFile() || (await stat(sourcePath)).size > MAX_ARCHIVE_BYTES) throw new Error('Нужен файл архива не более 16 МиБ');
  const bytes = await readFile(sourcePath);
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Архив слишком большой');
  let archive;
  try { archive = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Архив не является JSON'); }
  const stats = validateArchive(archive);
  const tempDir = await mkdtemp(join(dirname(target), '.way-restore-'));
  const tempFile = join(tempDir, 'verified.sqlite');
  let store;
  try {
    store = openStore(tempFile);
    store.restoreArchive(archive);
    const restored = store.archive();
    const ordered = (rows, key) => [...rows].sort((a,b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    if (!isDeepStrictEqual(ordered(restored.payload.revisions, r => `${r.id}/${r.version}`), ordered(archive.payload.revisions, r => `${r.id}/${r.version}`))) throw new Error('Не совпали восстановленные версии');
    if (!isDeepStrictEqual(ordered(restored.payload.requests, r => r.request_id), ordered(archive.payload.requests, r => r.request_id))) throw new Error('Не совпали восстановленные запросы');
    if (!isDeepStrictEqual(ordered(restored.payload.catalogRevisions ?? [],r=>r.version),ordered(archive.payload.catalogRevisions ?? [],r=>r.version))) throw new Error('Не совпал восстановленный справочник');
    store.close(); store = null;
    await link(tempFile, target);
    return { ...stats, destination: target };
  } finally {
    if (store) store.close();
    // Only known scratch files in the unique directory created above.
    for (const name of ['verified.sqlite', 'verified.sqlite-wal', 'verified.sqlite-shm']) {
      await unlink(join(tempDir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    await rmdir(tempDir);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    console.error('Использование: node restore.mjs "архив.json" "НОВАЯ-база.sqlite"');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await restoreToNewFile(process.argv[2], process.argv[3]), null, 2)); }
    catch (e) { console.error('Восстановление не выполнено: ' + e.message); process.exitCode = 1; }
  }
}
