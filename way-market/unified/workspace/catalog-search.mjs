import { catalogNorm } from './catalog-data.mjs';
import { InputError } from './domain.mjs';
const stop = new Set(['найди', 'найти', 'покажи', 'показать', 'мне', 'товар', 'товары', 'нужен', 'нужна', 'пожалуйста']);
const synonyms = new Map([['молока', 'молоко'], ['йогурты', 'йогурт'], ['соки', 'сок'], ['яйца', 'яйцо'], ['яиц', 'яйцо'], ['кефира', 'кефир'], ['сахара', 'сахар']]);
const word = w => synonyms.get(w) ?? w;
const tokens = s => catalogNorm(s).split(' ').filter(Boolean).map(word);
const keyboard = new Map([..."qwertyuiop[]asdfghjkl;'zxcvbnm,."].map((c, i) => [c, [...'йцукенгшщзхъфывапролджэячсмитьбю'][i]]));
const layout = s => [...s.toLocaleLowerCase('ru')].map(c => keyboard.get(c) ?? c).join('');
const translit = s => s.toLowerCase().replace(/shch|sch|zh|kh|ch|sh|yu|ya|yo|[a-z]/g, c => ({ shch: 'щ', sch: 'щ', zh: 'ж', kh: 'х', ch: 'ч', sh: 'ш', yu: 'ю', ya: 'я', yo: 'е', a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'к', y: 'ы', w: 'в', x: 'кс', q: 'к' }[c]));
const decimal = s => { const [a, b = ''] = s.replace(',', '.').split('.'); return BigInt(a) * 1000n + BigInt(b.padEnd(3, '0')); };
export function nameTraits(source) {
  const s = String(source).toLowerCase(), sizes = [], fats = [];
  for (const m of s.matchAll(/(\d{1,6}(?:[.,]\d{1,3})?)\s*(кг|kg|гр|г|g|мл|ml|литр(?:а|ов)?|л|l)(?![\p{L}])/gu)) {
    const volume = /^(мл|ml|литр|л|l)/u.test(m[2]), thousand = /^(кг|kg|литр|л|l)$/u.test(m[2]) || m[2].startsWith('литр');
    sizes.push({ kind: volume ? 'volume' : 'mass', value: Number(decimal(m[1]) * (thousand ? 1000n : 1n)) });
  }
  for (const m of s.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g)) { const n = Number(decimal(m[1]) / 10n); if (n <= 10000) fats.push(n); }
  return { sizes, fats, pack: /(?:уп(?:аковка)?\.?\s*(?:по\s*)?(\d{1,3})|(\d{1,3})\s*шт)/u.exec(s)?.slice(1).find(Boolean) ?? null };
}
function near(a, b) {
  if (a === b) return 1;
  if (a.length >= 3 && b.startsWith(a)) return 0.86;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return 0;
  // One insertion, deletion or substitution; bounded linear work per token.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++edits > 1) return 0; if (a.length >= b.length) i++; if (a.length <= b.length) j++; }
  edits += Number(i < a.length || j < b.length); return edits <= 1 ? 0.7 : 0;
}
function wordsOnly(s) { return s.replace(/\d{1,9}(?:[.,]\d{1,3})?\s*(?:%|кг|kg|гр|г|g|мл|ml|литр(?:а|ов)?|л|l)(?![\p{L}])/giu, ' '); }
export function createCatalogSearch(products, groups = [], { includeInactive = false } = {}) {
  const groupMap = new Map(groups.map(g => [g.id, g.data?.name ?? g.name]));
  const index = products.filter(p => includeInactive || p.active !== 0 && p.active !== false).map(p => {
    const profile = p.profile ?? p, traits = nameTraits(p.name);
    if (profile.sizeKind && profile.sizeKind !== 'none' && profile.sizeValue) traits.sizes = [{ kind: profile.sizeKind, value: profile.sizeValue * 1000 }];
    if (profile.fat !== null && profile.fat !== undefined) traits.fats = [profile.fat];
    return { p, profile, traits, words: tokens(wordsOnly(`${p.name} ${profile.brand ?? ''}`)), searchWords: tokens(wordsOnly(`${p.name} ${profile.brand ?? ''} ${groupMap.get(profile.groupId) ?? ''} ${profile.description ?? ''}`)) };
  });
  const codeCounts = new Map();
  for (const r of index) for (const key of [...(r.profile.barcodes ?? []).map(b => 'b:' + b.code), ...(r.profile.cashCode ? ['c:' + catalogNorm(r.profile.cashCode)] : []), ...(r.profile.article ? ['a:' + catalogNorm(r.profile.article)] : [])]) codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
  return function search(query, { mode = 'search', supplierId = null, aliases = [], barcode = '', limit = 50 } = {}) {
    if (typeof query !== 'string' || query.length > 300 || /[\x00-\x1f]/.test(query) || typeof barcode !== 'string' || !/^\d{0,32}$/.test(barcode) || !['search', 'match'].includes(mode)) throw new InputError('Проверьте поисковый запрос');
    const traits = nameTraits(query), negatives = [...query.toLocaleLowerCase('ru').matchAll(/без\s+([\p{L}]+)/gu)].map(m => word(catalogNorm(m[1]))); let text = query, maxPrice = null;
    const price = /(?:^|\s)(?:до|дешевле)\s+(\d{1,9}(?:[.,]\d{1,2})?)\s*(?:₽|руб(?:лей|ля|ль)?\.?|р\.)(?=\s|$)/iu.exec(text);
    if (price && mode === 'search') { maxPrice = Number(decimal(price[1]) / 10n); text = text.replace(price[0], ' '); }
    const available = mode === 'search' && /в\s+наличии/iu.test(text); if (available) text = text.replace(/в\s+наличии/giu, ' ');
    const variants = [text]; if (/[a-z]/i.test(text)) variants.push(layout(text), translit(text));
    const queries = variants.map(s => tokens(wordsOnly(s)).filter(t => !stop.has(t))).filter(a => a.length > 0);
    const exactCode = catalogNorm(query), out = [], savedAliases = new Map(aliases.filter(a => a.data.active && a.data.supplierId === supplierId && catalogNorm(a.data.sourceName) === catalogNorm(query)).map(a => [a.data.productId, a]));
    for (const row of index) {
      const { p, profile, traits: actual } = row;
      if (maxPrice !== null && p.price > maxPrice || available && profile.availability !== 'available') continue;
      const codes = profile.barcodes?.map(b => b.code) ?? [], codeMatch = (barcode && codes.includes(barcode)) || codes.includes(query.trim()) || (profile.cashCode && catalogNorm(profile.cashCode) === exactCode) || (profile.article && catalogNorm(profile.article) === exactCode);
      const saved = mode === 'match' ? savedAliases.get(p.id) : null;
      const words = mode === 'match' ? row.words : row.searchWords;
      let score = 0, matched = 0, count = 0;
      for (const q of queries) { const scores = q.map(t => Math.max(0, ...words.map(w => near(t, w)))), n = scores.filter(n => n > 0).length, value = scores.reduce((a, b) => a + b, 0) / q.length; if (value > score) { score = value; matched = n; count = q.length; } }
      if (!codeMatch && !saved && (queries.length && (score === 0 || (mode === 'search' ? matched !== count : matched < Math.max(1, Math.ceil(count / 2)))))) continue;
      if (!queries.length && query.trim() && !traits.sizes.length && !traits.fats.length && maxPrice === null && !available && !codeMatch && !saved) continue;
      const reasons = [], warnings = [];
      const matchingKey = barcode && codes.includes(barcode) ? 'b:' + barcode : codes.includes(query.trim()) ? 'b:' + query.trim() : profile.cashCode && catalogNorm(profile.cashCode) === exactCode ? 'c:' + exactCode : profile.article && catalogNorm(profile.article) === exactCode ? 'a:' + exactCode : '';
      if (matchingKey && codeCounts.get(matchingKey) > 1) warnings.push('Код встречается у нескольких товаров; проверьте характеристики');
      const phraseWords = tokens(`${p.name} ${profile.description ?? ''}`);
      for (const excluded of negatives) if (!phraseWords.some((w, i) => w === 'без' && phraseWords[i + 1] === excluded)) warnings.push('Отличается условие «без ' + excluded + '»');
      let rank = codeMatch ? 100 : saved ? 98 : Math.round(score * 88);
      if (codeMatch) reasons.push('Совпадает код'); else if (saved) reasons.push('Ранее подтверждено для этого поставщика'); else if (score) reasons.push('Похожее наименование');
      for (const wanted of traits.sizes) {
        if (!actual.sizes.length) warnings.push('Размер фасовки не подтверждён');
        else if (!actual.sizes.some(x => x.kind === wanted.kind && x.value === wanted.value)) warnings.push('Отличается масса или объём'); else reasons.push('Совпадает масса / объём');
      }
      for (const wanted of traits.fats) { if (!actual.fats.length) warnings.push('Жирность не подтверждена'); else if (!actual.fats.includes(wanted)) warnings.push('Отличается жирность'); else reasons.push('Совпадает жирность'); }
      const conflicts = warnings.some(w => w.startsWith('Отличается'));
      if (mode === 'search' && conflicts) continue;
      if (traits.pack) warnings.push(`Проверьте смысл фасовки ${traits.pack} шт.; пересчёт не применяется автоматически`);
      if (barcode && !codes.includes(barcode)) warnings.push('Указанный штрихкод не совпал');
      if (conflicts) rank = Math.min(rank, 39); else if (warnings.length) rank = Math.min(rank, 69);
      if (query.trim() === '') rank = 0;
      out.push({ product: p, score: rank, reasons: [...new Set(reasons)], warnings: [...new Set(warnings)], aliasId: saved?.id ?? null, packageId: saved?.data?.packageId ?? null });
    }
    out.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'ru') || a.product.id.localeCompare(b.product.id));
    return out.slice(0, Math.max(1, Math.min(100, limit)));
  };
}
