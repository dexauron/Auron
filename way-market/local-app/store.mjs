import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { reconcile, InputError, validateCatalog, defaultCatalog } from './domain.mjs';
import { createArchive, validateArchive } from './archive.mjs';

export class ConflictError extends Error {}
export function openStore(filename, { requireSchema1 = false } = {}) {
  const db = new DatabaseSync(filename);
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if ((requireSchema1 && schemaVersion !== 1) || (schemaVersion !== 0 && schemaVersion !== 1)) { db.close(); throw new Error('Неподдерживаемая версия базы'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS revisions (
      id TEXT NOT NULL, version INTEGER NOT NULL, shift_key TEXT NOT NULL,
      created_at TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL,
      reason TEXT NOT NULL, PRIMARY KEY(id,version), UNIQUE(shift_key,version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS requests (
      request_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL,
      id TEXT NOT NULL, version INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS catalog_revisions (
      version INTEGER PRIMARY KEY, created_at TEXT NOT NULL, author TEXT NOT NULL,
      reason TEXT NOT NULL, data TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, payload_hash TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version=1;`);
  const unpack = row => row ? ({ id: row.id, version: row.version, createdAt: row.created_at,
    input: JSON.parse(row.input), result: JSON.parse(row.result), reason: row.reason }) : null;
  const get = id => unpack(db.prepare('SELECT * FROM revisions WHERE id=? ORDER BY version DESC LIMIT 1').get(id));
  const unpackCatalog = row => row ? ({version:row.version,createdAt:row.created_at,author:row.author,reason:row.reason,data:JSON.parse(row.data)}) : {version:0,createdAt:null,author:'',reason:'Начальные категории',data:defaultCatalog()};
  const catalog = () => unpackCatalog(db.prepare('SELECT * FROM catalog_revisions ORDER BY version DESC LIMIT 1').get());
  return {
    get,
    catalog,
    catalogHistory: () => db.prepare('SELECT * FROM catalog_revisions ORDER BY version DESC').all().map(unpackCatalog),
    saveCatalog(payload) {
      if(!payload || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion<0 || typeof payload.requestId!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) throw new InputError('Неверная версия / запрос справочника');
      const data=validateCatalog(payload.data);
      for(const [key,max] of [['author',100],['reason',500]]) if(typeof payload[key]!=='string' || !payload[key].trim() || payload[key].length>max || /[\x00-\x1f]/.test(payload[key])) throw new InputError('Укажите автора и причину изменения справочника');
      const author=payload.author.trim(), reason=payload.reason.trim();
      const hash=createHash('sha256').update(JSON.stringify({data,expectedVersion:payload.expectedVersion,author,reason})).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        const repeat=db.prepare('SELECT * FROM catalog_revisions WHERE request_id=?').get(payload.requestId);
        if(repeat) {if(repeat.payload_hash!==hash) throw new ConflictError('Запрос справочника уже использован');db.exec('COMMIT');return unpackCatalog(repeat);}
        const previous=catalog();
        if(previous.data.worksheet && !data.worksheet) throw new InputError('Настройки кассового листа нельзя удалять при изменении категорий');
        if(previous.version!==payload.expectedVersion) throw new ConflictError('Справочник изменён. Откройте актуальную версию');
        for(const key of ['categories','recipients']) if(previous.data[key].some(old=>!data[key].some(item=>item.id===old.id))) throw new InputError('Не удаляйте использованные категории/получателей: отключите их');
        db.prepare('INSERT INTO catalog_revisions VALUES (?,?,?,?,?,?,?)').run(payload.expectedVersion+1,new Date().toISOString(),author,reason,JSON.stringify(data),payload.requestId,hash);
        const result=catalog(); db.exec('COMMIT');return result;
      } catch(e) {db.exec('ROLLBACK');throw e;}
    },
    list: () => db.prepare(`SELECT r.* FROM revisions r JOIN
      (SELECT id, MAX(version) v FROM revisions GROUP BY id) m ON r.id=m.id AND r.version=m.v
      ORDER BY r.created_at DESC, r.id LIMIT 100`).all().map(unpack),
    history: id => db.prepare('SELECT * FROM revisions WHERE id=? ORDER BY version DESC').all(id).map(unpack),
    archive() {
      // A single read transaction makes revisions and retry records one snapshot.
      db.exec('BEGIN');
      try {
        const result = createArchive(
          db.prepare('SELECT * FROM revisions ORDER BY id, version').all(),
          db.prepare('SELECT * FROM requests ORDER BY request_id').all(),
          db.prepare('SELECT * FROM catalog_revisions ORDER BY version').all()
        );
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    restoreArchive(archive) {
      const stats = validateArchive(archive);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT COUNT(*) n FROM revisions').get().n || db.prepare('SELECT COUNT(*) n FROM requests').get().n || db.prepare('SELECT COUNT(*) n FROM catalog_revisions').get().n) {
          throw new ConflictError('Восстановление разрешено только в пустую отдельную базу');
        }
        const insertRevision = db.prepare('INSERT INTO revisions (id,version,shift_key,created_at,input,result,reason) VALUES (?,?,?,?,?,?,?)');
        const insertRequest = db.prepare('INSERT INTO requests (request_id,payload_hash,id,version) VALUES (?,?,?,?)');
        for (const r of archive.payload.revisions) insertRevision.run(r.id, r.version, r.shift_key, r.created_at, r.input, r.result, r.reason);
        for (const r of archive.payload.requests) insertRequest.run(r.request_id, r.payload_hash, r.id, r.version);
        const insertCatalog=db.prepare('INSERT INTO catalog_revisions VALUES (?,?,?,?,?,?,?)');
        for(const r of archive.payload.catalogRevisions ?? []) insertCatalog.run(r.version,r.created_at,r.author,r.reason,r.data,r.request_id,r.payload_hash);
        db.exec('COMMIT'); return stats;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    save(payload) {
      if (!payload || typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) throw new InputError('Нужен идентификатор запроса');
      const { input, expectedVersion, id } = payload;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || (id != null && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)))) throw new InputError('Неверная версия записи');
      if ((!id && expectedVersion !== 0) || (id && expectedVersion === 0)) throw new InputError('Неверная версия записи');
      const result = reconcile(input);
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
      if (reason.length > 500 || (id && !reason)) throw new InputError('Для новой версии укажите причину изменения (до 500 символов)');
      const hash = createHash('sha256').update(JSON.stringify({ input, expectedVersion, id: id ?? null, reason })).digest('hex');
      const shiftKey = JSON.stringify([result.date, result.register.toLowerCase(), result.shiftNo.toLowerCase()]);
      db.exec('BEGIN IMMEDIATE');
      try {
        const repeat = db.prepare('SELECT * FROM requests WHERE request_id=?').get(payload.requestId);
        if (repeat) {
          if (repeat.payload_hash !== hash) throw new ConflictError('Этот идентификатор уже использован для других данных');
          const saved = unpack(db.prepare('SELECT * FROM revisions WHERE id=? AND version=?').get(repeat.id, repeat.version));
          db.exec('COMMIT');
          return saved;
        }
        const previous = id ? get(id) : null;
        if (id && (!previous || previous.version !== expectedVersion)) throw new ConflictError('Запись уже изменена. Откройте актуальную версию из истории');
        if (previous && JSON.stringify([previous.result.date, previous.result.register.toLowerCase(), previous.result.shiftNo.toLowerCase()]) !== shiftKey) throw new InputError('Дату, кассу и номер сохранённой смены менять нельзя');
        if(result.categoryResult) for(const entry of input.categoryEntries) {
          const same = c => c && c.id===entry.category.id && c.name===entry.category.name && c.kind===entry.category.kind;
          const historical=previous?.input.categoryEntries?.some(old=>old.id===entry.id && same(old.category));
          if(!historical && !catalog().data.categories.some(c=>c.active && same(c))) throw new ConflictError('Категория изменена или отключена. Обновите справочник и выберите категорию заново');
        }
        if (!id && db.prepare('SELECT id FROM revisions WHERE shift_key=? LIMIT 1').get(shiftKey)) throw new ConflictError('Эта смена уже есть. Откройте её из истории');
        const recordId = id ?? randomUUID();
        const version = expectedVersion + 1;
        db.prepare('INSERT INTO revisions (id,version,shift_key,created_at,input,result,reason) VALUES (?,?,?,?,?,?,?)').run(recordId, version, shiftKey,
          new Date().toISOString(), JSON.stringify(input), JSON.stringify(result), reason);
        db.prepare('INSERT INTO requests VALUES (?,?,?,?)').run(payload.requestId, hash, recordId, version);
        const saved = get(recordId);
        db.exec('COMMIT');
        return saved;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close()
  };
}
