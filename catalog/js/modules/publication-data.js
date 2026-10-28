// Допустимый состав выдачи. Объекты из импортов нельзя копировать в витрину целиком.
const PUBLIC_TEXT = ['id', 'name', 'code', 'category', 'group_id', 'unit', 'description'];
const STAFF_PRODUCT = [...PUBLIC_TEXT, 'article', 'department', 'note', 'created_at', 'updated_at', 'stock_at',
  'arrival_at', 'stock_state', 'retail_price', 'is_weighted', 'stock', 'stock_qty', 'sold_qty', 'period_from', 'period_to',
  'supplier_ids', 'photos', 'barcodes', 'barcode_units', 'pack_units', 'reviews'];
const STAFF_ARRAYS = ['groups', 'suppliers', 'prices', 'sales', 'competitors', 'compPrices', 'orders'];
const STAFF_MAPS = ['contacts', 'unitCoef', 'retailHist', 'orderRules'];
const cloneData = (x) => JSON.parse(JSON.stringify(x));
const publicNameOrder = new Intl.Collator('ru').compare;
function textValue(x) { return typeof x === 'string' ? x : (typeof x === 'number' && Number.isSafeInteger(x) ? String(x) : null); }
function photoLink(value) {
  const s = typeof value === 'string' ? value : (value && typeof value.url === 'string' ? value.url : '');
  if (!s || /[\u0000-\u001f\\]/.test(s)) return null;
  if (/^(https?:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(s)) return s;
  return /^(?:\.?\.?\/)?[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s]*)?$/i.test(s) ? s : null;
}
export function availability(p, perDay) {
  const q = p.stock != null ? Number(p.stock) : (p.stock_qty != null ? Number(p.stock_qty) : null);
  if (q == null || !Number.isFinite(q)) return ['in', 'low', 'out'].includes(p.stock_state) ? p.stock_state : null;
  if (q <= 0) return 'out';
  return (perDay > 0 ? q / perDay < 2 : q <= 3) ? 'low' : 'in';
}
export function publicProducts(products) {
  return products.map((p) => {
    const o = {};
    for (const k of PUBLIC_TEXT) { const v = textValue(p[k]); if (v != null) o[k] = v; }
    if (typeof p.retail_price === 'number' && Number.isFinite(p.retail_price)) o.retail_price = p.retail_price;
    if (typeof p.is_weighted === 'boolean') o.is_weighted = p.is_weighted;
    o.barcodes = [...new Set((Array.isArray(p.barcodes) ? p.barcodes : []).map(textValue).filter(Boolean))];
    o.photos = (Array.isArray(p.photos) ? p.photos : []).map(photoLink).filter(Boolean);
    for (const k of ['arrival_at', 'created_at']) if (typeof p[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p[k])) o[k] = p[k].slice(0, 10);
    const reviews = (Array.isArray(p.reviews) ? p.reviews : []).slice(-5).filter((r) => r && Number.isFinite(r.r) && r.r >= 1 && r.r <= 5)
      .map((r) => ({ n: typeof r.n === 'string' ? r.n.slice(0,40) : '', r: r.r, t: typeof r.t === 'string' ? r.t.slice(0,200) : '', d: typeof r.d === 'string' ? r.d.slice(0,10) : '' }));
    if (reviews.length) o.reviews = reviews;
    const st = availability(p, null); if (st) o.stock_state = st;
    return o;
  }).sort((a,b) => publicNameOrder(String(a.name), String(b.name)));
}
export function publicGroups(groups) {
  return groups.map((g) => ({ id: textValue(g.id), name: typeof g.name === 'string' ? g.name : '', sort_order: Number.isFinite(g.sort_order) ? g.sort_order : 0 }));
}
export function staffSnapshot(snapshot) {
  const out = { v: snapshot.v, savedAt: snapshot.savedAt, products: snapshot.products.map((p) => {
    const item = {};
    for (const k of STAFF_PRODUCT) if (p[k] != null) item[k] = cloneData(p[k]);
    return item;
  }) };
  for (const k of STAFF_ARRAYS) out[k] = cloneData(Array.isArray(snapshot[k]) ? snapshot[k] : []);
  for (const k of STAFF_MAPS) out[k] = cloneData(snapshot[k] || {});
  return out;
}
