import { InputError } from './domain.mjs';
export const CATALOG_KINDS = ['group', 'profile', 'alias'];
export const catalogId = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
export const catalogNorm = s => String(s ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[.,](?=\d)/g, '.').replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().replace(/\s+/g, ' ');
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const text = (v, max, blank = false) => typeof v === 'string' && (blank || v.trim().length > 0) && v.length <= max && !/[\x00-\x1f]/.test(v);
const integer = (v, min = 0, max = 999999999) => Number.isSafeInteger(v) && v >= min && v <= max;
const optionalId = v => v === null || catalogId(v);
const bad = message => { throw new InputError(message ?? 'Проверьте карточку каталога и связи'); };
export function defaultProductProfile(barcode = '') { return { groupId: null, article: '', cashCode: '', brand: '', unit: 'шт', weighted: false, barcodes: barcode ? [{ code: barcode, packageId: null }] : [], packages: [], availability: 'unknown', published: false, description: '', sizeKind: 'none', sizeValue: 0, fat: null }; }
export function validateCatalogDocument(kind, d) {
  if (kind === 'group') {
    if (!exact(d, ['name', 'parentId', 'active']) || !text(d.name, 100) || d.name !== d.name.trim() || !optionalId(d.parentId) || typeof d.active !== 'boolean') bad();
  } else if (kind === 'profile') {
    if (!exact(d, Object.keys(defaultProductProfile())) || !optionalId(d.groupId) || !text(d.article, 60, true) || !text(d.cashCode, 40, true) || !text(d.brand, 100, true) || !['шт', 'кг', 'л', 'м'].includes(d.unit) || typeof d.weighted !== 'boolean' || !['unknown', 'available', 'unavailable'].includes(d.availability) || typeof d.published !== 'boolean' || !text(d.description, 1000, true) || !['none', 'mass', 'volume'].includes(d.sizeKind) || !integer(d.sizeValue) || (d.sizeKind === 'none' ? d.sizeValue !== 0 : d.sizeValue < 1) || (d.fat !== null && !integer(d.fat, 0, 10000))) bad();
    if (d.weighted && d.unit !== 'кг') bad('Весовой товар должен иметь базовую единицу кг');
    if (!Array.isArray(d.packages) || d.packages.length > 20 || !Array.isArray(d.barcodes) || d.barcodes.length > 20) bad();
    const packages = new Set(), labels = new Set(), codes = new Set();
    for (const p of d.packages) { const key = catalogNorm(p?.label); if (!exact(p, ['id', 'label', 'quantity']) || !catalogId(p.id) || packages.has(p.id) || !text(p.label, 50) || labels.has(key) || !integer(p.quantity, 1)) bad(); packages.add(p.id); labels.add(key); }
    for (const b of d.barcodes) { if (!exact(b, ['code', 'packageId']) || typeof b.code !== 'string' || !/^\d{1,32}$/.test(b.code) || codes.has(b.code) || !optionalId(b.packageId) || (b.packageId !== null && !packages.has(b.packageId))) bad('Проверьте штрихкоды и их упаковки'); codes.add(b.code); }
  } else if (kind === 'alias') {
    if (!exact(d, ['supplierId', 'sourceName', 'productId', 'packageId', 'active']) || !catalogId(d.supplierId) || !text(d.sourceName, 300) || !catalogNorm(d.sourceName) || !catalogId(d.productId) || !optionalId(d.packageId) || typeof d.active !== 'boolean') bad();
  } else bad();
  return d;
}
export function catalogState(rows, products, suppliers) {
  const docs = rows.map(r => ({ id: r.id, version: r.version, kind: r.kind, actorId: r.actor_id, at: r.at_ms, reason: r.reason, data: validateCatalogDocument(r.kind, JSON.parse(r.data)) }));
  const groups = docs.filter(d => d.kind === 'group'), profiles = new Map(docs.filter(d => d.kind === 'profile').map(d => [d.id, d])), aliases = docs.filter(d => d.kind === 'alias');
  const groupMap = new Map(groups.map(g => [g.id, g])), productMap = new Map(products.map(p => [p.id, p])), siblings = new Set(), barcodes = new Map(), cashCodes = new Set(), aliasKeys = new Set(), warnings = [];
  for (const g of groups) {
    const key = JSON.stringify([g.data.parentId, catalogNorm(g.data.name)]); if (siblings.has(key)) bad('Такая группа уже существует'); siblings.add(key);
    let cur = g, seen = new Set(); while (cur) { if (seen.has(cur.id) || seen.size >= 8) bad('Цикл или слишком глубокая вложенность групп'); seen.add(cur.id); if (cur.data.parentId === null) break; const parent = groupMap.get(cur.data.parentId); if (!parent || (g.data.active && !parent.data.active)) bad('Родительская группа недоступна'); cur = parent; }
  }
  for (const p of profiles.values()) if (!productMap.has(p.id) || p.version !== productMap.get(p.id).version) bad('Версия карточки не соответствует товару');
  const enriched = products.map(p => {
    const profile = profiles.get(p.id)?.data ?? defaultProductProfile(p.barcode);
    const group = profile.groupId === null ? null : groupMap.get(profile.groupId);
    if (profile.groupId !== null && (!group || (p.active && !group.data.active))) bad('Товар связан с недоступной группой');
    if ((profile.barcodes[0]?.code ?? '') !== p.barcode) bad('Основной штрихкод не соответствует карточке');
    for (const b of profile.barcodes) { if (barcodes.has(b.code) && barcodes.get(b.code) !== p.id) { if (profiles.has(p.id) || profiles.has(barcodes.get(b.code))) bad('Штрихкод уже связан с другим товаром'); warnings.push(`Старые товары имеют общий штрихкод ${b.code}; требуется проверка`); } barcodes.set(b.code, p.id); }
    if (p.active && profile.cashCode) { const key = catalogNorm(profile.cashCode); if (cashCodes.has(key)) bad('Код кассы уже используется'); cashCodes.add(key); }
    return { ...p, profile };
  });
  for (const a of aliases) {
    const p = productMap.get(a.data.productId), profile = profiles.get(a.data.productId)?.data;
    if (!p || !suppliers.some(s => s.id === a.data.supplierId) || (a.data.active && a.data.packageId !== null && !profile?.packages.some(p => p.id === a.data.packageId))) bad('Сопоставление ссылается на недоступный товар или упаковку');
    if (a.data.active) { const key = JSON.stringify([a.data.supplierId, catalogNorm(a.data.sourceName)]); if (aliasKeys.has(key)) bad('Название этого поставщика уже сопоставлено'); aliasKeys.add(key); }
  }
  return { groups, products: enriched, aliases, warnings: [...new Set(warnings)] };
}
export function publicCatalogView(state) {
  const products = state.products.filter(p => p.active && p.profile.published).map(p => ({ id: p.id, name: p.name, price: p.price, groupId: p.profile.groupId, brand: p.profile.brand, unit: p.profile.unit, availability: p.profile.availability, description: p.profile.description, sizeKind: p.profile.sizeKind, sizeValue: p.profile.sizeValue, fat: p.profile.fat }));
  const needed = new Set(products.map(p => p.groupId).filter(Boolean)), groups = new Map(state.groups.map(g => [g.id, g]));
  for (const id of [...needed]) { let g = groups.get(id); while (g?.data.parentId) { needed.add(g.data.parentId); g = groups.get(g.data.parentId); } }
  return { products, groups: state.groups.filter(g => needed.has(g.id)).map(g => ({ id: g.id, name: g.data.name, parentId: g.data.parentId })) };
}
