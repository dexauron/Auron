import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reconcile, reconcileCategories, validateCatalog, defaultCatalog } from './domain.mjs';
import { openStore } from './store.mjs';
import { validateArchive, checksum } from './archive.mjs';
import { restoreToNewFile } from './restore.mjs';
import { createApp } from './server.mjs';

const category=(id='owner-cash',name='Деньги владельцу',kind='cash_out')=>({id,name,kind});
const entry=(extra={})=>({id:randomUUID(),category:category(),recipient:'',amount:'1000',basis:'total',includedInCashSales:false,note:'',...extra});
const input=entries=>({date:'2026-10-17',register:'Тест',shiftNo:'ДЕМО',cashier:'Тест',author:'Тест',accountant:'',opening:'0',zCash:'10000',otherIn:'0',retained:'0',claimed:'',received:'',zBasisConfirmed:true,payments:[],cashSetup:{additionalCash:'0',independentReports:false,paymentMode:'categories',suppliers:'0',payroll:'0',other:'0',previousTransfers:'0',factBasisConfirmed:true},categoryEntries:entries});
const save=(s,i,id=null,expectedVersion=0)=>s.save({requestId:randomUUID(),input:i,id,expectedVersion,reason:id?'Исправление':' '});
const config=(s,data,extra={})=>s.saveCatalog({data,expectedVersion:s.catalog().version,requestId:randomUUID(),author:'Тест',reason:'Настройка',...extra});
test('cash to owner and unpaid receipt are distinct effects; no automatic profit expense',()=>{
  const goods=entry({category:category('owner-goods','Товар владельцу без оплаты','unpaid_goods'),amount:'2000',includedInCashSales:true});
  const r=reconcile(input([entry(),goods]));
  assert.equal(r.cashPaid,100000);assert.equal(r.categoryResult.goodsAdjustment,200000);assert.equal(r.expected,700000);assert.equal(r.formulaVersion,'cash-categories-v3');
  assert.equal(Object.hasOwn(r,'profit'),false);
  assert.equal(reconcile(input([{...goods,includedInCashSales:false}])).expected,1000000);
});
test('unpaid inclusion must be explicitly known, not inferred from category name',()=>{
  assert.throws(()=>reconcileCategories([entry({category:category('owner-goods','Товар','unpaid_goods'),includedInCashSales:null})]));
  assert.equal(reconcileCategories([entry({category:category('owner-cash','Товар','cash_out')})]).cashOut,100000);
});
test('cash-in adds once and cannot be duplicated in other receipts',()=>{
  const i=input([entry({category:category('deposit','Внесение','cash_in')})]);
  assert.equal(reconcile(i).expected,1100000);assert.throws(()=>reconcile({...i,otherIn:'1000'}),/одном месте/);
});
test('aggregate category and its detail cannot double count; details sum exactly',()=>{
  const a=entry();assert.throws(()=>reconcileCategories([a,entry({basis:'detail'})]),/смешивать/);
  assert.throws(()=>reconcileCategories([a,entry()]),/смешивать/);
  assert.equal(reconcileCategories([{...a,basis:'detail'},entry({basis:'detail',amount:'0.01'})]).cashOut,100001);
  assert.throws(()=>reconcileCategories([a,a]),/Повтор/);
});
test('legacy modes cannot silently drop category entries or double subtract old totals',()=>{
  const i=input([entry()]);assert.throws(()=>reconcile({...i,cashSetup:{...i.cashSetup,paymentMode:'totals'}}));
  assert.throws(()=>reconcile({...i,cashSetup:{...i.cashSetup,suppliers:'1'}}));
});
test('missing money is not zero; boundaries retain a kopeck and reject unknown rule',()=>{
  assert.throws(()=>reconcileCategories([entry({amount:''})]));
  assert.equal(reconcileCategories([entry({amount:'0'})]).cashOut,0);
  assert.equal(reconcileCategories([entry({amount:'999999999.99'})]).cashOut,99999999999);
  assert.throws(()=>reconcileCategories([entry({category:category('xx','Тест','invented')})]));
});
test('catalog rejects duplicate ids/names, malformed recipient and unsupported effects',()=>{
  const d=defaultCatalog();assert.throws(()=>validateCatalog({...d,categories:[...d.categories,d.categories[0]]}));
  assert.throws(()=>validateCatalog({...d,recipients:[{id:'recipient',name:' ',active:true}]}));
  assert.throws(()=>validateCatalog({...d,categories:[{...d.categories[0],kind:'arbitrary_formula'}]}));
});
test('catalog has optimistic concurrency, retry idempotency and immutable history',()=>{
  const s=openStore(':memory:');try{
    const p={data:defaultCatalog(),expectedVersion:0,requestId:randomUUID(),author:'Тест',reason:'Начало'};
    assert.equal(s.saveCatalog(p).version,1);assert.equal(s.saveCatalog(p).version,1);
    assert.throws(()=>s.saveCatalog({...p,reason:'Другой запрос'}));
    assert.throws(()=>s.saveCatalog({...p,requestId:randomUUID()}),/изменён/);
    const next=s.catalog().data;next.categories[0].name='Поставщикам переименовано';config(s,next);
    assert.equal(s.catalogHistory().length,2);assert.equal(s.catalogHistory()[1].data.categories[0].name,'Поставщикам');
    assert.throws(()=>config(s,{...next,categories:next.categories.slice(1)}),/отключите/);
  }finally{s.close();}
});
test('renaming, changing effect and deactivation never rewrite a saved shift',()=>{
  const s=openStore(':memory:');try{
    const i=input([entry()]),first=save(s,i);
    const d=s.catalog().data;const c=d.categories.find(c=>c.id==='owner-cash');c.name='Новое название';c.kind='unpaid_goods';c.active=false;config(s,d);
    assert.equal(s.get(first.id).result.cashPaid,100000);
    assert.equal(save(s,i,first.id,1).version,2);
    assert.throws(()=>save(s,{...i,shiftNo:'НОВАЯ'}),/изменена или отключена/);
  }finally{s.close();}
});
test('custom category must be saved before use; recipients remain optional',()=>{
  const s=openStore(':memory:');try{
    const i=input([entry({category:category('custom','Новая выдача')})]);assert.throws(()=>save(s,i));
    const d=s.catalog().data;d.categories.push({...i.categoryEntries[0].category,active:true});d.recipients.push({id:'person',name:'Тестовый получатель',active:true});config(s,d);
    assert.equal(save(s,i).result.categoryResult.entries[0].recipient,'');
  }finally{s.close();}
});
test('archive v2 restores catalog, history, shifts and retry records exactly',()=>{
  const s=openStore(':memory:'),t=openStore(':memory:');try{
    config(s,defaultCatalog());const d=s.catalog().data;d.categories[0].active=false;config(s,d);save(s,input([entry()]));
    const a=s.archive();assert.equal(a.payload.version,2);assert.equal(validateArchive(a).catalogVersions,2);
    t.restoreArchive(a);assert.deepEqual(t.catalogHistory(),s.catalogHistory());assert.deepEqual(t.list(),s.list());
    assert.throws(()=>t.restoreArchive(a));
    a.payload.catalogRevisions[0].data='{}';a.sha256=checksum(a.payload);assert.throws(()=>validateArchive(a));
  }finally{s.close();t.close();}
});
test('old archive remains v1; catalog-only archive is valid and restores settings',()=>{
  const s=openStore(':memory:'),t=openStore(':memory:');try{
    assert.equal(s.archive().payload.version,1);config(s,defaultCatalog());const a=s.archive();assert.equal(a.payload.revisions.length,0);
    t.restoreArchive(a);assert.equal(t.catalog().version,1);
  }finally{s.close();t.close();}
});
test('new-file restore verifies catalogs and refuses overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'wm-categories-')),s=openStore(':memory:');try{
    config(s,defaultCatalog());save(s,input([entry()]));const src=join(dir,'archive.json'),dest=join(dir,'new.sqlite');await writeFile(src,JSON.stringify(s.archive()));
    await restoreToNewFile(src,dest);const t=openStore(dest);try{assert.deepEqual(t.catalogHistory(),s.catalogHistory());}finally{t.close();}
    const before=await readFile(dest);await assert.rejects(restoreToNewFile(src,dest));assert.deepEqual(await readFile(dest),before);
  }finally{s.close();}
});
test('HTTP catalog mutation requires token, exposes history and survives archive check',async()=>{
  const s=openStore(':memory:'),server=createApp(s);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {token}=await (await fetch(base+'/api/session')).json();
    const body={data:defaultCatalog(),expectedVersion:0,requestId:randomUUID(),author:'Тест',reason:'Настройка'};
    assert.equal((await fetch(base+'/api/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,403);
    const headers={'Content-Type':'application/json','X-Way-Token':token};
    assert.equal((await fetch(base+'/api/catalog',{method:'POST',headers,body:JSON.stringify(body)})).status,200);
    assert.equal((await (await fetch(base+'/api/catalog/history')).json()).length,1);
    const archive=await (await fetch(base+'/api/archive/download',{method:'POST',headers,body:'{}'})).json();
    assert.equal((await fetch(base+'/api/archive/check',{method:'POST',headers,body:JSON.stringify(archive)})).status,200);
  }finally{await new Promise(r=>server.close(r));s.close();}
});
