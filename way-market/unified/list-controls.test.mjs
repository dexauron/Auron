import test from 'node:test';
import assert from 'node:assert/strict';
import {selectListRows,normalizeListText} from './workspace/workspace/list-controls.mjs';

test('list filters intersect status and all search words without changing authorized source rows',()=>{
 const rows=[{status:'open',searchText:'Проверить молоко на полке'},{status:'done',searchText:'Проверить молоко'},{status:'open',searchText:'Проверить хлеб'}],before=structuredClone(rows);
 assert.deepEqual(selectListRows(rows,{status:'open',query:' МОЛОКО   проверить '}),[rows[0]]);
 assert.deepEqual(selectListRows(rows,{status:'done',query:'молоко'}),[rows[1]]);
 assert.deepEqual(selectListRows(rows,{query:'проверить'}),rows);assert.deepEqual(rows,before);
 assert.deepEqual(selectListRows(rows,{status:'submitted'}),[]);
});
test('search treats punctuation as literal text and handles zero, null, Unicode and ё',()=>{
 assert.equal(normalizeListText(null),'');assert.equal(normalizeListText(0),'0');
 const rows=[{status:'submitted',searchText:'Семён касса 0 смена ７ 2026-10-20 20.10.2026 [A]'}];
 for(const query of ['семен','0','смена 7','20.10.2026','[a]'])assert.equal(selectListRows(rows,{query}).length,1,query);
 assert.equal(selectListRows(rows,{query:'.*'}).length,0);
 assert.deepEqual(selectListRows([]),[]);assert.equal(selectListRows(rows,{query:'   '}).length,1);
});
