// Isolated recovery checks: never connects to a production database or service.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {openStore} from '../local-app/store.mjs';
import {createApp} from '../local-app/server.mjs';
const require=createRequire(process.env.PLAYWRIGHT_FROM??import.meta.url);
const {chromium}=require('playwright');
const prefix='way-market:excel-draft:v2:',sessionKey='way-market:excel-editor';
const launch=()=>chromium.launch({headless:true,...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),...(process.env.WAY_BROWSER_SINGLE_PROCESS?{args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']}:{})});
const cases=[];
async function scenario(name,run){
 const store=openStore(':memory:'),server=createApp(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await launch(),errors=[],ctx=await browser.newContext({viewport:{width:1440,height:1000}}),base=`http://127.0.0.1:${server.address().port}`;
 const open=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.waitForLoadState('networkidle');return p;};
 try{await run({ctx,open,store,base});assert.deepEqual(errors,[]);cases.push(name);console.log('✓ '+name);}
 finally{await browser.close();await new Promise(r=>server.close(r));store.close();}
}
const snapshots=p=>p.evaluate(prefix=>Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>({key:k,...JSON.parse(localStorage.getItem(k))})),prefix);
const dialogRow=(p,name)=>p.locator('#drafts-list .draft-row').filter({hasText:name});
async function showDrafts(p){await p.locator('#draft-recovery button').click();}
async function save(p){await p.locator('#save').click();await p.waitForFunction(()=>document.querySelector('#save').textContent==='Сохранено');}

await scenario('Saving one tab preserves another tab, including recovery after reload',async({open})=>{
 const a=await open(),b=await open();await a.locator('#example').click();await b.locator('#example').click();await b.locator('[name=cashier]').fill('Вкладка Б');await b.locator('[name=cashReport]').fill('44000');await save(a);
 assert.equal((await snapshots(b)).filter(d=>d.meta.cashier==='Вкладка Б').length,1);
 b.on('dialog',d=>d.accept());await b.reload();await b.waitForLoadState('networkidle');await showDrafts(b);await dialogRow(b,'Вкладка Б').getByRole('button',{name:'Восстановить'}).click();assert.equal((await b.locator('[name=cashReport]').inputValue()).replaceAll('\u00a0',''),'44000');
});
await scenario('A duplicated tab gets a different editor; deleting an active foreign draft is refused',async({open,ctx})=>{
 const a=await open();await a.locator('[name=cashier]').fill('Исходная вкладка');await a.locator('[name=cashReport]').fill('111');const owner=await a.evaluate(k=>sessionStorage.getItem(k),sessionKey);
 await ctx.addInitScript(({key,owner})=>sessionStorage.setItem(key,owner),{key:sessionKey,owner});const b=await open();assert.notEqual(await b.evaluate(k=>sessionStorage.getItem(k),sessionKey),owner);await b.locator('[name=cashReport]').fill('222');
 await showDrafts(b);b.on('dialog',d=>d.accept());await dialogRow(b,'Исходная вкладка').getByRole('button',{name:'Удалить'}).click();await b.waitForFunction(()=>document.querySelector('#notice').textContent.includes('открыт в другой вкладке'));assert.equal((await snapshots(a)).filter(d=>d.meta.cashier==='Исходная вкладка').length,1);
});
await scenario('Restoring over new input asks first; cancelling retains it and accepting preserves both drafts',async({open})=>{
 const p=await open();await p.locator('#example').click();await p.locator('[name=cashier]').fill('Старый ввод');await p.locator('[name=cashReport]').fill('11100');p.on('dialog',acceptReload);function acceptReload(d){d.accept();}await p.reload();await p.waitForLoadState('networkidle');p.off('dialog',acceptReload);
 await p.locator('[name=cashier]').fill('Новый ввод');await p.locator('[name=cashReport]').fill('22200');await showDrafts(p);p.once('dialog',d=>d.dismiss());await dialogRow(p,'Старый ввод').getByRole('button',{name:'Восстановить'}).click();assert.equal((await p.locator('[name=cashReport]').inputValue()).replaceAll('\u00a0',''),'22200');
 p.once('dialog',d=>d.accept());await dialogRow(p,'Старый ввод').getByRole('button',{name:'Восстановить'}).click();assert.equal((await p.locator('[name=cashReport]').inputValue()).replaceAll('\u00a0',''),'11100');const drafts=await snapshots(p);assert.ok(drafts.some(d=>d.values.cashReport==='11100'));assert.ok(drafts.some(d=>d.values.cashReport==='22200'));
});
await scenario('Two corrections to the same saved sheet retain separate recovery slots and stale drafts are preserved',async({open})=>{
 const a=await open();await a.locator('#example').click();await save(a);const b=await open();await b.locator('[data-view=history]').click();await b.locator('.history-item').click();await a.locator('[name=received]').fill('22600');await b.locator('[name=received]').fill('22700');await b.locator('[name=cashier]').fill('Правка Б');await a.locator('[name=reason]').fill('Правка А');await save(a);assert.ok((await snapshots(b)).some(d=>d.values.received==='22700'));
 b.on('dialog',d=>d.accept());await b.reload();await b.waitForLoadState('networkidle');await showDrafts(b);await dialogRow(b,'Правка Б').getByRole('button',{name:'Восстановить'}).click();await b.waitForFunction(()=>document.querySelector('#notice').textContent.includes('уже версия 2'));assert.ok((await snapshots(b)).some(d=>d.values.received==='22700'));
});
await scenario('A storage quota error is visible, keeps the input, and does not prevent saving to the server',async({ctx,open,store})=>{
 await ctx.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(this===localStorage)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};});const p=await open();await p.setViewportSize({width:320,height:740});await p.locator('#example').click();assert.match(await p.locator('#draft-state').innerText(),/Не удалось сохранить черновик/);assert.equal(await p.locator('#draft-state').isVisible(),true);const layout=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,barBottom:document.querySelector('.actions').getBoundingClientRect().bottom,navTop:document.querySelector('.rail nav').getBoundingClientRect().top}));assert.equal(layout.overflow,0);assert.ok(layout.barBottom<=layout.navTop+1);assert.equal((await p.locator('[name=cashReport]').inputValue()).replaceAll('\u00a0',''),'34000');await save(p);assert.equal(store.list().length,1);assert.equal(await p.locator('#draft-state').isVisible(),false);
});
await scenario('A legacy draft remains recoverable and is not silently deleted after saving its copy',async({open})=>{
 const p=await open();await p.locator('#example').click();await p.locator('[name=cashier]').fill('Черновик 0.8.2');await p.evaluate(prefix=>{const k=Object.keys(localStorage).find(k=>k.startsWith(prefix));const d=JSON.parse(localStorage.getItem(k));delete d.format;delete d.owner;delete d.revision;delete d.draftId;localStorage.setItem('way-market:excel-draft',JSON.stringify(d));},prefix);p.on('dialog',d=>d.accept());await p.locator('#new').click();await showDrafts(p);await dialogRow(p,'Черновик 0.8.2').getByRole('button',{name:'Восстановить'}).click();await save(p);assert.notEqual(await p.evaluate(()=>localStorage.getItem('way-market:excel-draft')),null);await showDrafts(p);await dialogRow(p,'Черновик 0.8.2').getByRole('button',{name:'Удалить'}).click();assert.equal(await p.evaluate(()=>localStorage.getItem('way-market:excel-draft')),null);
});
console.log(`Recovery checks passed: ${cases.length}`);
