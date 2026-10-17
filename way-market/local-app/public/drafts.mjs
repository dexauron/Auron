export const LEGACY_DRAFT_KEY = 'way-market:excel-draft';
export const DRAFT_PREFIX = 'way-market:excel-draft:v2:';
export const DRAFT_SESSION_KEY = 'way-market:excel-editor';
const uuidPattern = /^[a-f0-9-]{36}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// A duplicated tab inherits sessionStorage. An exclusive lifetime lock makes it
// choose a new editor ID instead of writing another tab's recovery copy.
export async function draftEditor({session, locks, uuid = () => crypto.randomUUID()}) {
  let owner;
  try { owner = session.getItem(DRAFT_SESSION_KEY); } catch {}
  if (!uuidPattern.test(owner ?? '') || !locks) owner = uuid();
  if (locks) {
    const acquire = id => new Promise(resolve => {
      locks.request(`way-market:editor:${id}`, {ifAvailable:true}, lock => {
        resolve(Boolean(lock));
        if (lock) return new Promise(() => {}); // Browser releases on page exit.
      }).catch(() => resolve(false));
    });
    if (!await acquire(owner)) {
      owner = uuid();
      if (!await acquire(owner)) owner = uuid();
    }
  }
  try { session.setItem(DRAFT_SESSION_KEY, owner); } catch {}
  return owner;
}

function parseDraft(encoded, key) {
  const data = JSON.parse(encoded);
  if (!object(data) || !object(data.values) || !object(data.meta) || !object(data.settings) ||
      typeof data.identity !== 'string' || !data.identity || data.identity.length > 50 ||
      !Number.isFinite(data.at)) throw new Error('Повреждённый черновик');
  if (key !== LEGACY_DRAFT_KEY && (data.format !== 2 || !uuidPattern.test(data.owner ?? '') || !uuidPattern.test(data.draftId ?? '') ||
      !uuidPattern.test(data.revision ?? '') || key !== `${DRAFT_PREFIX}${data.owner}:${data.draftId}`)) {
    throw new Error('Неверная версия черновика');
  }
  return {key, encoded, data};
}

export function draftRepository({storage, owner, uuid = () => crypto.randomUUID()}) {
  if (!uuidPattern.test(owner)) throw new Error('Неверный редактор черновика');
  const keyFor = draftId => `${DRAFT_PREFIX}${owner}:${draftId}`;
  return {
    owner,
    keyFor,
    write(data) {
      const key = keyFor(data.draftId);
      const encoded = JSON.stringify({...data, format:2, owner, revision:uuid()});
      const entry = parseDraft(encoded, key);
      storage.setItem(key, encoded); // Failures must reach the user interface.
      return entry;
    },
    list() {
      const entries = [], invalid = [];
      const keys = Array.from({length:storage.length}, (_, i) => storage.key(i));
      for (const key of keys) {
        if (key !== LEGACY_DRAFT_KEY && !key?.startsWith(DRAFT_PREFIX)) continue;
        const encoded = storage.getItem(key);
        if (encoded === null) continue;
        try { entries.push(parseDraft(encoded, key)); } catch { invalid.push(key); }
      }
      return {entries:entries.sort((a,b) => b.data.at-a.data.at), invalid};
    },
    read(entry) {
      const encoded = storage.getItem(entry.key);
      if (encoded === null) throw new Error('Черновик уже удалён. Обновите список.');
      if (encoded !== entry.encoded) throw new Error('Черновик изменился в другой вкладке. Обновите список и выберите его заново.');
      return parseDraft(encoded, entry.key);
    },
    removeOwn(draftId) {
      storage.removeItem(keyFor(draftId));
    },
    remove(entry) {
      this.read(entry); // Do not delete a newer snapshot through a stale button.
      storage.removeItem(entry.key);
    }
  };
}

export async function deleteRecoveredDraft(repository, entry, locks) {
  if (entry.key === LEGACY_DRAFT_KEY || entry.data.owner === repository.owner) {
    repository.remove(entry);
    return;
  }
  if (!locks) throw new Error('Закройте остальные вкладки. Удаление чужого черновика недоступно в этом браузере; восстановление доступно.');
  await locks.request(`way-market:editor:${entry.data.owner}`, {ifAvailable:true}, lock => {
    if (!lock) throw new Error('Этот черновик открыт в другой вкладке. Закройте её перед удалением.');
    repository.remove(entry);
  });
}
