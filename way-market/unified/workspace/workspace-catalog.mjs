import { randomUUID } from 'node:crypto';
import { InputError } from './domain.mjs';
import { catalogState, defaultProductProfile, publicCatalogView, validateCatalogDocument, catalogId } from './catalog-data.mjs';
import { createCatalogSearch, nameTraits } from './catalog-search.mjs';
export const latestCatalog = db => db.prepare('SELECT d.* FROM workspace_catalog d JOIN (SELECT id,MAX(version) v FROM workspace_catalog GROUP BY id) m ON d.id=m.id AND d.version=m.v').all();
const suppliers = db => db.prepare("SELECT id,version,data FROM workspace_procurement WHERE kind='supplier' AND (id,version) IN (SELECT id,MAX(version) FROM workspace_procurement GROUP BY id)").all();
export const workspaceCatalogState = db => catalogState(latestCatalog(db), db.prepare('SELECT * FROM workspace_products ORDER BY name,id').all(), suppliers(db));
export function workspacePublicCatalog(db) {
  const rows = latestCatalog(db).filter(r => r.kind !== 'alias'), published = rows.filter(r => r.kind === 'profile' && JSON.parse(r.data).published), ids = new Set(published.map(r => r.id));
  const products = db.prepare('SELECT * FROM workspace_products WHERE active=1 ORDER BY name,id').all().filter(p => ids.has(p.id)), activeIds = new Set(products.map(p => p.id));
  return publicCatalogView(catalogState(rows.filter(r => r.kind === 'group' || activeIds.has(r.id)), products, []));
}
export function saveProductProfile(db, actor, audit, at, product, oldProduct, payload) {
  const old = db.prepare("SELECT * FROM workspace_catalog WHERE id=? AND kind='profile' ORDER BY version DESC LIMIT 1").get(product.id);
  if (payload.profile !== undefined && (!payload.profile || typeof payload.profile !== 'object' || Array.isArray(payload.profile))) throw new InputError('Неверная структура карточки');
  let data = payload.profile ? structuredClone(payload.profile) : old ? JSON.parse(old.data) : defaultProductProfile(product.barcode);
  if (!payload.profile && old && product.barcode !== oldProduct.barcode) data.barcodes = [...(product.barcode ? [{ code: product.barcode, packageId: null }] : []), ...data.barcodes.filter(b => b.code !== oldProduct.barcode && b.code !== product.barcode)];
  for (const key of ['article', 'cashCode', 'brand']) if (typeof data[key] === 'string') data[key] = data[key].trim();
  if (Array.isArray(data.packages)) for (const p of data.packages) if (typeof p?.label === 'string') p.label = p.label.trim();
  validateCatalogDocument('profile', data);
  const traits = nameTraits(product.name);
  if (data.sizeKind !== 'none' && traits.sizes.some(x => x.kind !== data.sizeKind || x.value !== data.sizeValue * 1000) || data.fat !== null && traits.fats.some(x => x !== data.fat)) throw new InputError('Фасовка или жирность карточки противоречит названию товара');
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if ((payload.profile && oldProduct && !reason) || reason.length > 500 || /[\x00-\x1f]/.test(reason)) throw new InputError('Укажите причину изменения карточки');
  const row = { id: product.id, version: product.version, kind: 'profile', actor_id: actor.id, at_ms: at, data: JSON.stringify(data), reason };
  catalogState([...latestCatalog(db).filter(r => r.id !== row.id), row], db.prepare('SELECT * FROM workspace_products').all(), suppliers(db));
  db.prepare('INSERT INTO workspace_catalog VALUES (?,?,?,?,?,?,?)').run(row.id, row.version, row.kind, actor.id, at, row.data, reason);
  audit('catalog.changed', row.id, { version: row.version, kind: 'profile', before: old ? JSON.parse(old.data) : null, after: data, reason });
}
export function catalogMethods(command, request, Conflict) {
  return {
    catalog(token, { all = false } = {}) { return command(token, all ? 'catalog.manage' : 'catalog.read', () => ({}), db => { const s = workspaceCatalogState(db); return { groups: s.groups.map(g => ({ id: g.id, version: g.version, data: g.data })), products: s.products.filter(p => all || p.active), warnings: s.warnings }; }); },
    catalogHistory(token, id) { return command(token, 'catalog.manage', () => ({}), db => { const core = new Map(db.prepare("SELECT detail FROM account_events WHERE subject_id=? AND kind='product.changed'").all(id).map(e => { const d = JSON.parse(e.detail); return [d.after.version, d.after]; })); return db.prepare("SELECT * FROM workspace_catalog WHERE id=? AND kind IN ('group','profile') ORDER BY version").all(id).map(r => ({ ...r, data: JSON.parse(r.data), ...(r.kind === 'profile' ? { core: core.get(r.version) } : {}) })); }); },
    catalogAliases(token) { return command(token, 'catalog.match', () => ({}), db => { const s = workspaceCatalogState(db), vendors = suppliers(db); return s.aliases.map(a => ({ ...a, productVersion: s.products.find(p => p.id === a.data.productId).version, supplierVersion: vendors.find(v => v.id === a.data.supplierId).version })); }); },
    catalogSuggest(token, p) { return command(token, 'catalog.match', () => ({}), db => {
      if (!p || typeof p.sourceName !== 'string') throw new InputError('Введите исходное наименование');
      const supplier = suppliers(db).find(s => s.id === p.supplierId); if (!supplier || !JSON.parse(supplier.data).active) throw new InputError('Выберите действующего поставщика');
      const state = workspaceCatalogState(db), matches = createCatalogSearch(state.products, state.groups)(p.sourceName, { mode: 'match', supplierId: supplier.id, aliases: state.aliases, barcode: p.barcode ?? '', limit: 10 });
      return { supplierVersion: supplier.version, sourceName: p.sourceName, matches, note: 'Баллы — сходство по правилам, не вероятность. Подтвердите товар и единицу вручную.' };
    }); },
    catalogSave(token, p) {
      if (!p || !['group', 'alias'].includes(p.kind)) throw new InputError('Неизвестная команда каталога');
      return command(token, p.kind === 'alias' ? 'catalog.match' : 'catalog.manage', () => ({}), (db, actor, audit, at) => request(db, p.requestId, { actorId: actor.id, kind: 'catalog', payload: p }, () => {
        if (p.id != null && !catalogId(p.id)) throw new InputError('Неверный идентификатор');
        const old = p.id ? db.prepare('SELECT * FROM workspace_catalog WHERE id=? ORDER BY version DESC LIMIT 1').get(p.id) : null;
        if (!Number.isSafeInteger(p.expectedVersion) || p.expectedVersion !== (old?.version ?? 0) || p.id && !old) throw new Conflict('Каталог изменён. Обновите данные');
        if (old && old.kind !== p.kind) throw new InputError('Тип записи нельзя изменить');
        const reason = typeof p.reason === 'string' ? p.reason.trim() : '';
        if (reason.length > 500 || /[\x00-\x1f]/.test(reason) || old && !reason) throw new InputError('Укажите причину изменения');
        let data;
        if (p.kind === 'group') data = { name: typeof p.name === 'string' ? p.name.trim() : p.name, parentId: p.parentId, active: p.active };
        else {
          if (p.confirmed !== true) throw new InputError('Подтвердите товар и упаковку после проверки');
          const product = db.prepare('SELECT * FROM workspace_products WHERE id=?').get(typeof p.productId === 'string' ? p.productId : '');
          const supplier = suppliers(db).find(s => s.id === p.supplierId);
          if (!product || product.version !== p.productVersion || !supplier || supplier.version !== p.supplierVersion) throw new Conflict('Товар или поставщик изменён. Повторите сопоставление');
          if (p.active && (!product.active || !JSON.parse(supplier.data).active)) throw new InputError('Товар или поставщик отключён');
          data = { supplierId: supplier.id, sourceName: p.sourceName, productId: product.id, packageId: p.packageId, active: p.active };
        }
        validateCatalogDocument(p.kind, data);
        const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
        const row = { id, version, kind: p.kind, actor_id: actor.id, at_ms: at, data: JSON.stringify(data), reason };
        catalogState([...latestCatalog(db).filter(r => r.id !== id), row], db.prepare('SELECT * FROM workspace_products').all(), suppliers(db));
        db.prepare('INSERT INTO workspace_catalog VALUES (?,?,?,?,?,?,?)').run(id, version, p.kind, actor.id, at, row.data, reason);
        audit('catalog.changed', id, { version, kind: p.kind, before: old ? JSON.parse(old.data) : null, after: data, reason });
        return { id, version };
      }));
    }
  };
}
