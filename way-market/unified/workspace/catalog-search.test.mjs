import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogSearch, nameTraits } from './catalog-search.mjs';
import { defaultProductProfile } from './catalog-data.mjs';
const product = (id, name, price, extras = {}) => ({ id, name, price, active: 1, profile: { ...defaultProductProfile(), ...extras } });
const products = [
 product('a', 'Молоко Простоквашино 900 мл 2,5%', 9900, { sizeKind: 'volume', sizeValue: 900, fat: 250, availability: 'available', barcodes: [{ code: '001234', packageId: null }] }),
 product('b', 'Молоко Простоквашино 1 л 3,2%', 12000, { availability: 'available' }),
 product('c', 'Молоко Домик 900 мл 2,5%', 8000, { availability: 'unknown' }),
 product('d', 'Напиток без сахара', 7000), product('e', 'Сахар без добавок', 6000), product('f', 'Напиток сладкий', 5000)
];
const search = createCatalogSearch(products);
test('literal search, decimal unit equivalence and explicit availability/price filter', () => {
 assert.deepEqual(search('покажи мне молоко 0,9 л в наличии до 100 рублей').map(x => x.product.id), ['a']);
 assert.equal(search('001234')[0].product.id, 'a');
 assert.equal(search('молока простоквашино 900мл 2.5%')[0].product.id, 'a');
 assert.equal(search('молоко 1л 2.5%').length, 0);
});
test('one typo, keyboard layout and transliteration work without broadening negative conditions', () => {
 assert.equal(search('молко простоквашино 900мл')[0].product.id, 'a');
 assert.ok(search('vjkjrj').some(x => x.product.id === 'a'));
 assert.ok(search('moloko').some(x => x.product.id === 'a'));
 assert.deepEqual(search('без сахара').map(x => x.product.id), ['d']);
});
test('matching flags size and fat conflicts, even for exact barcode or saved association', () => {
 const alias = { id: 'alias', data: { active: true, supplierId: 'supplier', sourceName: 'Молоко Простоквашино 1л 3.2%', productId: 'a', packageId: null } };
 const rows = search(alias.data.sourceName, { mode: 'match', barcode: '001234', supplierId: 'supplier', aliases: [alias] });
 const candidate = rows.find(x => x.product.id === 'a'); assert.ok(candidate.score <= 39); assert.ok(candidate.warnings.some(x => x.includes('Отличается масса'))); assert.ok(candidate.warnings.some(x => x.includes('жирность')));
 assert.equal(products[0].name, 'Молоко Простоквашино 900 мл 2,5%');
});
test('pack counts warn and never turn similarity scores into a conversion or probability', () => {
 const candidate = search('Молоко Простоквашино 900 мл уп12', { mode: 'match' }).find(x => x.product.id === 'a'); assert.ok(candidate.warnings.some(x => x.includes('12 шт.'))); assert.ok(candidate.score <= 69);
 assert.deepEqual(nameTraits('Молоко 0,9л 2,5%').sizes, [{ kind: 'volume', value: 900000 }]);
 assert.deepEqual(nameTraits('Крупа 1кг').sizes, nameTraits('Крупа 1000г').sizes);
 assert.throws(() => search('x'.repeat(301))); assert.throws(() => search('молоко', { barcode: {} }));
});

test('unmatched words return no suggestions; ambiguous legacy codes are explicitly flagged',()=>{
 assert.deepEqual(search('несуществующий товар'),[]);
 const code='123';const lookup=createCatalogSearch([product('x','Товар первый',100,{barcodes:[{code,packageId:null}]}),product('y','Товар второй',100,{barcodes:[{code,packageId:null}]})]);const rows=lookup(code);assert.equal(rows.length,2);assert.ok(rows.every(r=>r.score<=69&&r.warnings.some(w=>w.includes('нескольких товаров'))));
});
