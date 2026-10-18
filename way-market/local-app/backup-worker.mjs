import { parentPort, workerData } from 'node:worker_threads';
import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { makeWorkspaceArchive, validateWorkspaceArchive, MAX_WORKSPACE_BYTES, ARCHIVE_TABLES } from './workspace-archive.mjs';

const magic = Buffer.from('WAYMARKET-BACKUP-1\n');
const kdf = promisify(scrypt), cost = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
export const BACKUP_OVERHEAD = magic.length + 16 + 12 + 16;
async function run({ operation, password, tables, bytes, archive: source, createdAt }) {
  if (operation === 'check-restore') {
    validateWorkspaceArchive(source);
    const restored = makeWorkspaceArchive(tables), stats = validateWorkspaceArchive(restored);
    for (const table of Object.keys(ARCHIVE_TABLES)) {
      const expected = source.tables[table], actual = table === 'account_events' ? tables[table].slice(0, expected.length) : tables[table];
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Восстановленные записи отличаются от исходной копии');
    }
    return { stats };
  }
  if (typeof password !== 'string' || [...password].length < 15 || [...password].length > 128 || /[\x00-\x1f]/.test(password)) throw new Error('Пароль резервной копии: 15–128 символов');
  if (operation === 'encrypt') {
    const archive = makeWorkspaceArchive(tables, createdAt), stats = validateWorkspaceArchive(archive);
    const salt = randomBytes(16), iv = randomBytes(12), prefix = Buffer.concat([magic, salt, iv]);
    const key = await kdf(password, salt, 32, cost);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(prefix);
      const encrypted = Buffer.concat([prefix, cipher.update(JSON.stringify(archive), 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return { bytes: encrypted, stats };
    } finally { key.fill(0); }
  }
  if (operation !== 'decrypt') throw new Error('Неизвестное действие');
  const input = Buffer.from(bytes);
  if (input.length < BACKUP_OVERHEAD || input.length > MAX_WORKSPACE_BYTES + BACKUP_OVERHEAD || !input.subarray(0, magic.length).equals(magic)) throw new Error('Неверный формат или размер резервной копии');
  const salt = input.subarray(magic.length, magic.length + 16), iv = input.subarray(magic.length + 16, magic.length + 28), prefix = input.subarray(0, magic.length + 28);
  const key = await kdf(password, salt, 32, cost);
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(prefix); decipher.setAuthTag(input.subarray(-16));
    plaintext = Buffer.concat([decipher.update(input.subarray(prefix.length, -16)), decipher.final()]);
  } catch { throw new Error('Неверный пароль или повреждена резервная копия'); }
  finally { key.fill(0); }
  try { let archive; try { archive = JSON.parse(plaintext.toString('utf8')); } catch { throw new Error('Некорректное содержимое резервной копии'); } return { archive, stats: validateWorkspaceArchive(archive) }; }
  finally { plaintext.fill(0); }
}
if (parentPort) {
  try { const result = await run(workerData); if (result.bytes) { const bytes = Uint8Array.from(result.bytes); parentPort.postMessage({ ...result, bytes }, [bytes.buffer]); } else parentPort.postMessage(result); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
