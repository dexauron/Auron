import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {makeWorkspaceArchive,validateWorkspaceArchive} from './workspace/workspace-archive.mjs';
import {createUnifiedData,ORG} from './unified-data.mjs';
import {createUnifiedExtension} from './unified-extension.mjs';
import {createWorkspaceServer} from './workspace/workspace-server.mjs';
import {sourceCatalog,root} from './start.mjs';
const password='Проверочная длинная фраза 2026';let w,owner,employee,data,server,base,csrf,accountA,accountB,dir,clock=Date.now();
before(async()=>{dir=await mkdtemp(join(tmpdir(),'way-unified-'));w=openWorkspace(join(dir,'test.sqlite'),{persistentSessions:true,clock:()=>clock});await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});owner=await w.accounts.login({login:'owner',password});await w.accounts.createUser(owner.token,{login:'employee',name:'Сотрудник',role:'employee',password});employee=await w.accounts.login({login:'employee',password});const source=await sourceCatalog();data=createUnifiedData(w,source.products,source.groups,{clock:()=>Date.parse('2026-10-19T12:00:00Z')});server=createWorkspaceServer(w,{persistentSessions:true,extension:createUnifiedExtension(root,data,w)}).server;await new Promise(ok=>server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+server.address().port;csrf=(await (await fetch(base+'/api/session')).json()).csrf;});
after(async()=>{server.closeAllConnections();await new Promise(ok=>server.close(ok));w.close();await rm(dir,{recursive:true,force:true});});
const write=(method,d,token=owner.token,extra={})=>data.financeWrite(token,{requestId:randomUUID(),orgId:ORG,method,data:d,...extra});
const read=(table,query='')=>data.financeRead(owner.token,table,new URLSearchParams(query));
async function http(path,session=owner,payload){return fetch(base+path,{...(payload?{method:'POST',body:JSON.stringify(payload)}:{}),headers:{...(session?{cookie:'way_workspace='+session.token}:{}),...(payload?{'Content-Type':'application/json','X-Way-Token':csrf,'X-Way-Account':session.user.id}:{})}});}
test('full source copies remain byte-identical',async()=>{const m=JSON.parse(await readFile(join(root,'PRESERVED-SOURCES.json'),'utf8'));for(const source of m.sources)for(const [path,expected]of Object.entries(source.files))assert.equal(createHash('sha256').update(await readFile(join(root,source.destination,path))).digest('hex'),expected,path);});
test('one cookie authorizes both source interfaces; finance is role-protected',async()=>{for(const path of ['/catalog/','/finance/'])assert.equal((await http(path)).status,200);assert.equal((await http('/finance/',employee)).status,403);assert.equal((await http('/catalog/',null)).status,401);assert.equal((await http('/unified/shell.js',null)).status,200);const html=await (await http('/finance/')).text();assert.match(html,/finance-adapter.js/);const cfg=await (await http('/finance/js/config.js')).text();assert.doesNotMatch(cfg,/201\.51\.6\.170/);});
test('source catalog imports once into shared data with same ids, codes and prices',()=>{assert.equal(data.seed(owner.token).imported,19299);assert.equal(data.seed(owner.token).imported,0);assert.equal(data.catalog(owner.token).products.length,19299);assert.equal(w.catalog(owner.token).products.length,19299);assert.throws(()=>data.seed(employee.token));});
test('Finance account and movement writes use Workspace ledger; retries do not duplicate',()=>{accountA=write('saveAccount',{name:'Наличные',initialBalance:'1000'}).id;accountB=write('saveAccount',{name:'Карта/Банк',initialBalance:'0'}).id;const p={requestId:randomUUID(),orgId:ORG,method:'saveTransaction',data:{accountId:accountA,type:'income',amountKopecks:125,date:'2026-10-19',comment:'Проверка'}};const r=data.financeWrite(owner.token,p);assert.equal(data.financeWrite(owner.token,p).id,r.id);assert.equal(w.finance(owner.token).accounts.find(a=>a.id===accountA).balance,100125);assert.equal(read('transactions').filter(t=>t.id===r.id).length,1);assert.throws(()=>write('saveTransaction',p.data,employee.token));});
test('transfer is atomic and reflected in both interfaces',()=>{write('saveTransfer',{fromAccountId:accountA,toAccountId:accountB,amountKopecks:10001,date:'2026-10-19'});let s=w.finance(owner.token);assert.equal(s.accounts.find(a=>a.id===accountA).balance,90124);assert.equal(s.accounts.find(a=>a.id===accountB).balance,10001);const before=s.movements.length;assert.throws(()=>write('saveTransfer',{fromAccountId:accountA,toAccountId:randomUUID(),amountKopecks:10,date:'2026-10-19'}));assert.equal(w.finance(owner.token).movements.length,before);assert.equal(read('accounts').find(a=>a.id===accountA).balance_kopecks,90124);});
test('suppliers and partial debt payments share procurement and finance; overpayment rolls back',()=>{const supplier=write('saveCounterparty',{name:'Поставщик проверки'}).id;assert.ok(w.procurement(owner.token).suppliers.some(s=>s.id===supplier));write('saveDebtEntry',{counterpartyId:supplier,type:'debt',amountKopecks:999,date:'2026-10-19'});write('saveDebtEntry',{counterpartyId:supplier,type:'payment',amountKopecks:499,accountId:accountA,date:'2026-10-19'});assert.equal(w.finance(owner.token).obligations.find(o=>o.data.supplierId===supplier).remaining,500);const before=w.finance(owner.token).movements.length;assert.throws(()=>write('saveDebtEntry',{counterpartyId:supplier,type:'payment',amountKopecks:501,accountId:accountA,date:'2026-10-19'}));assert.equal(w.finance(owner.token).movements.length,before);});
test('device preferences are isolated by account and saved in server database',()=>{const p={deviceId:'test-device',save:true,value:{theme:'dark',textSize:'large',lastModule:'catalog'}};data.preferences(owner.token,p);assert.equal(data.preferences(owner.token,{deviceId:'test-device'}).theme,'dark');assert.equal(data.preferences(employee.token,{deviceId:'test-device'}).theme,undefined);});
test('persistent login survives 60 days and another login, but explicit logout revokes it',async()=>{clock+=60*86400000;assert.equal(w.accounts.session(employee.token).id,employee.user.id);await w.accounts.login({login:'owner',password});assert.equal(w.accounts.session(employee.token).id,employee.user.id);w.accounts.logout(employee.token);assert.throws(()=>w.accounts.session(employee.token));});
test('catalog edit is visible in original projection and shared Workspace; stale edits fail',()=>{const p=data.catalog(owner.token).products[0],incoming={...p,name:p.name+' тест',retail_price:12.34};data.catalogSave(owner.token,{requestId:randomUUID(),products:[incoming]});assert.equal(w.catalog(owner.token).products.find(x=>x.id===p.id).price,1234);assert.equal(data.catalog(owner.token).products.find(x=>x.id===p.id).name,incoming.name);assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[incoming]}));});
test('failed shift creation rolls back earlier income and leaves no partial shift',()=>{const e=write('saveEmployee',{fullName:'Кассир проверки'}).id;const before=w.finance(owner.token).movements.length;assert.throws(()=>write('saveShift',{register:'Касса 1',date:'2026-10-19',employeeId:e,shiftNum:91,zCash:100,zCard:200,zSbp:300,factCash:100,factCard:200,factSbp:300,withdrawals:[]}));assert.equal(w.finance(owner.token).movements.length,before);assert.equal(read('shifts').length,0);});
test('persistent account and preferences survive database reopen without raw session tokens on disk',async()=>{const path=join(dir,'restart.sqlite');let x=openWorkspace(path,{persistentSessions:true,clock:()=>clock});await x.accounts.bootstrapOwner({login:'restart',name:'Тест',password});const s=await x.accounts.login({login:'restart',password});const u=createUnifiedData(x);u.preferences(s.token,{deviceId:'restart-device',save:true,value:{theme:'dark',textSize:'large',lastModule:'finance'}});x.close();x=openWorkspace(path,{persistentSessions:true,clock:()=>clock+500*86400000});assert.equal(x.accounts.session(s.token).id,s.user.id);assert.equal(createUnifiedData(x).preferences(s.token,{deviceId:'restart-device'}).textSize,'large');x.accounts.logout(s.token);assert.throws(()=>x.accounts.session(s.token));x.close();assert.equal((await readFile(path)).includes(Buffer.from(s.token)),false);});
test('original Finance API and compatibility adapter read the shared ledger end to end',async()=>{
 const {runInNewContext}=await import('node:vm');
 const context={console,URL,URLSearchParams,crypto:{randomUUID},navigator:{onLine:true},location:{href:base+'/finance/',origin:base,replace:()=>{},assign:()=>{}},addEventListener:()=>{},localStorage:{setItem:()=>{}},fetch:(input,options={})=>fetch(new URL(input,base),{...options,headers:{...options.headers,Cookie:'way_workspace='+owner.token}})};context.window=context;
 runInNewContext(await (await http('/finance/js/api.js')).text(),context);runInNewContext(await readFile(join(root,'unified/finance-adapter.js'),'utf8'),context);
 context.SUPABASE_URL='/integration';context.SUPABASE_ANON_KEY='';await context.AUTH.init();
 assert.equal((await context.API.getOrgs())[0].id,ORG);assert.equal((await context.API.getAccounts(ORG)).length,2);
 const home=await context.API.getHomeSummary(ORG,'month');assert.ok(Array.isArray(home.groups));const analytics=await context.API.getAnalytics(ORG,'month');assert.ok(Array.isArray(analytics.daily));const expected=w.finance(owner.token).movements.filter(m=>!m.reversedBy&&m.data.type!=='transfer'&&m.data.date>=analytics.from&&m.data.date<=analytics.to);assert.equal(analytics.totalIncome,expected.flatMap(m=>m.effects).filter(e=>e.delta>0).reduce((n,e)=>n+e.delta,0));assert.equal(analytics.totalExpense,-expected.flatMap(m=>m.effects).filter(e=>e.delta<0).reduce((n,e)=>n+e.delta,0));assert.equal((await context.API.getDebts(ORG))[0].balance,500);
 const r=await context.API.saveTransaction(ORG,{clientUuid:randomUUID(),accountId:accountA,type:'income',amountKopecks:1,date:'2026-10-19',comment:'Из исходного API'});assert.ok(w.finance(owner.token).movements.some(m=>m.id===r.id));
});
test('archive includes full imported catalog and integration metadata with valid business links',()=>{const a=makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token));const stats=validateWorkspaceArchive(a);assert.equal(stats.products,19299);assert.ok(a.tables.account_events.some(e=>e.kind==='unified.preferences'));assert.ok(Buffer.byteLength(JSON.stringify(a))<32*1024*1024);});
test('a successful Z-report posts once and its cancellation restores all account balances',()=>{write('saveAccount',{name:'СБП',initialBalance:'0'});const e=write('saveEmployee',{fullName:'Кассир смены'}).id;const before=new Map(w.finance(owner.token).accounts.map(a=>[a.id,a.balance]));const d={register:'Касса 1',date:'2026-10-19',employeeId:e,shiftNum:92,zCash:100,zCard:200,zSbp:300,factCash:50,factCard:200,factSbp:300,withdrawals:[{amount:50,account:'Наличные',category:'Хозрасходы',comment:'Проверка'}]};const shift=write('saveShift',d);assert.equal(shift.diff_kopecks,0);assert.throws(()=>write('saveShift',d));write('cancelShift',{id:shift.id});for(const a of w.finance(owner.token).accounts)assert.equal(a.balance,before.get(a.id));assert.equal(read('shifts','id=eq.'+shift.id)[0].status,'cancelled');});
test('new source catalog cards retain their identifiers and private supplier fields stay role-filtered',async()=>{const id=randomUUID();data.catalogSave(owner.token,{requestId:randomUUID(),products:[{id,name:'Новая карточка интеграции',retail_price:3.21,barcodes:['9999999999999'],prices:[{supplier_id:randomUUID(),price:1}]}]});assert.equal(w.catalog(owner.token).products.find(p=>p.id===id).price,321);assert.ok(data.catalog(owner.token).products.find(p=>p.id===id).prices);const replacement=w.accounts.session(owner.token);assert.equal(replacement.role,'owner');const staff=await w.accounts.login({login:'employee',password});assert.equal(data.catalog(staff.token).products.find(p=>p.id===id).prices,undefined);});
test('preference writes detect stale tabs and identical retries create no extra versions',()=>{
 const key='concurrent-device',initial={theme:'dark',textSize:'normal',lastModule:'workspace'};
 const first=data.preferences(owner.token,{deviceId:key,save:true,expectedVersion:0,value:initial});assert.ok(first._version>0);
 const duplicate=data.preferences(owner.token,{deviceId:key,save:true,expectedVersion:0,value:initial});assert.equal(duplicate._version,first._version);
 assert.throws(()=>data.preferences(owner.token,{deviceId:key,save:true,expectedVersion:0,value:{...initial,theme:'light'}}),/другой вкладке/);
 const fresh=data.preferences(owner.token,{deviceId:key,save:true,expectedVersion:first._version,value:{...initial,theme:'light',password:'must not persist'}});assert.equal(fresh.theme,'light');assert.equal(fresh.password,undefined);
});
test('browser navigation to a protected module redirects to common login while API requests stay 401',async()=>{
 const r=await fetch(base+'/finance/',{redirect:'manual',headers:{Accept:'text/html'}});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');
 assert.equal((await http('/catalog/',null)).status,401);assert.equal((await http('/unified/preferences.js',null)).status,200);
});
test('remembered device cookie remains stable when switching accounts',async()=>{
 const first=await http('/api/session');const session=await first.json();assert.match(session.deviceId,/^[a-f0-9]{32}$/);
 const other=await w.accounts.login({login:'employee',password});const second=await fetch(base+'/api/session',{headers:{Cookie:'way_workspace='+other.token+'; way_device='+session.deviceId}});
 assert.equal((await second.json()).deviceId,session.deviceId);assert.ok(second.headers.getSetCookie().some(c=>c.includes('way_device=')&&c.includes('HttpOnly')));
});
test('malformed financial colors are rejected atomically instead of becoming HTML attributes',()=>{
 const before=w.finance(owner.token).accounts.length;
 assert.throws(()=>write('saveAccount',{name:'Счёт с ошибкой цвета',initialBalance:'0',color:'red" onclick="alert(1)'}),/Цвет/);
 assert.equal(w.finance(owner.token).accounts.length,before);
});
test('administrator edits preserve hidden purchase fields and reject forged private changes',async()=>{
 await w.accounts.createUser(owner.token,{login:'catalog-admin',name:'Администратор каталога',role:'administrator',password});const admin=await w.accounts.login({login:'catalog-admin',password});
 const card=data.catalog(admin.token).products.find(p=>p.name==='Новая карточка интеграции');assert.equal(card.prices,undefined);
 data.catalogSave(admin.token,{requestId:randomUUID(),products:[{...card,name:card.name+' обновлена'}]});
 const ownerCard=data.catalog(owner.token).products.find(p=>p.id===card.id);assert.equal(ownerCard.prices[0].price,1);
 const next=data.catalog(admin.token).products.find(p=>p.id===card.id);
 assert.throws(()=>data.catalogSave(admin.token,{requestId:randomUUID(),products:[{...next,prices:[]}]}),/закрытые поля/);
 assert.equal(data.catalog(owner.token).products.find(p=>p.id===card.id).prices[0].price,1);
});
test('concurrent source group edits and cycles cannot replace the latest saved version',()=>{
 const groups=[{id:randomUUID(),name:'Группа проверки'}];const requestId=randomUUID();
 const first=data.catalogSave(owner.token,{requestId,products:[],groups,groupsVersion:0});assert.ok(first.groupsVersion>0);assert.deepEqual(data.catalogSave(owner.token,{requestId,products:[],groups,groupsVersion:0}),first);
 assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],groups:[],groupsVersion:0}),/Группы изменены/);
 const id=randomUUID();assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],groups:[{id,name:'Цикл',parent_id:id}],groupsVersion:first.groupsVersion}),/Цикл/);
 assert.equal(data.catalog(owner.token).groups[0].name,'Группа проверки');
});
test('source shared settings use version checks and are not writable by an administrator',async()=>{
 const first=data.catalogSave(owner.token,{requestId:randomUUID(),products:[],supplement:{orders:[]},supplementVersion:0});
 assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],supplement:{orders:[{note:'устаревшее'}]},supplementVersion:0}),/другой вкладке/);
 const admin=await w.accounts.login({login:'catalog-admin',password});assert.throws(()=>data.catalogSave(admin.token,{requestId:randomUUID(),products:[],supplement:{orders:[]},supplementVersion:first.supplementVersion}),/владелец/);
});
test('removing a source catalog card archives the shared record without erasing history',()=>{
 const p=data.catalog(owner.token).products[0],requestId=randomUUID(),command={requestId,products:[],archives:[{id:p.id,expectedVersion:p._version}]};
 const result=data.catalogSave(owner.token,command);assert.equal(result.archived.length,1);assert.deepEqual(data.catalogSave(owner.token,command),result);
 assert.equal(data.catalog(owner.token).products.some(x=>x.id===p.id),false);assert.equal(w.catalog(owner.token,{all:true}).products.find(x=>x.id===p.id).active,0);
 assert.throws(()=>data.catalogSave(owner.token,{...command,requestId:randomUUID()}),/Товар изменён/);
 assert.ok(w.catalogHistory(owner.token,p.id).length>0);
});
test('a failed archive batch leaves all earlier cards active',()=>{
 const p=data.catalog(owner.token).products[0];assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],archives:[{id:p.id,expectedVersion:p._version},{id:randomUUID(),expectedVersion:1}]}));assert.equal(data.catalog(owner.token).products.some(x=>x.id===p.id),true);
});
test('encrypted full-catalog backup restores shared finance and preferences into an isolated database',async()=>{
 const {backupWorker}=await import('./workspace/workspace-backups.mjs');const snapshot=w.accounts.workspaceSnapshot(owner.token),secret='Отдельная проверочная фраза копии 2026';
 const encrypted=await backupWorker({operation:'encrypt',password:secret,tables:snapshot});assert.equal(Buffer.from(encrypted.bytes).includes(Buffer.from(owner.token)),false);
 const decoded=await backupWorker({operation:'decrypt',password:secret,bytes:encrypted.bytes});const restored=openWorkspace(join(dir,'full-restore.sqlite'),{persistentSessions:true,clock:()=>clock});
 try{restored.accounts.restoreWorkspace(decoded.archive,owner.user.id);assert.throws(()=>restored.accounts.session(owner.token));const login=await restored.accounts.login({login:'owner',password});
  assert.equal(restored.catalog(login.token,{all:true}).products.length,w.catalog(owner.token,{all:true}).products.length);
  assert.deepEqual(restored.finance(login.token).accounts.map(a=>a.balance),w.finance(owner.token).accounts.map(a=>a.balance));
  assert.equal(createUnifiedData(restored).preferences(login.token,{deviceId:'concurrent-device'}).theme,'light');
 }finally{restored.close();}
});
test('unified catalog neither loads nor writes the unscoped legacy private cache',async()=>{
 const {runInNewContext}=await import('node:vm');const response=await http('/catalog/js/modules/data.js');assert.equal(response.status,200);
 let calls=0;const context={CACHE_KEY:'legacy',idbGet:async()=>{calls++;return {products:[{name:'private'}]};},idbSet:async()=>{calls++;},state:{products:[]},cmpRu:()=>0,buildIndex:()=>{calls++;},setTimeout:()=>{calls++;}};
 const code=(await response.text()).replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+/g,'');const module=runInNewContext(code+'\n;({loadCache,saveCache});',context);
 assert.equal(await module.loadCache(),false);module.saveCache();assert.equal(calls,0);
});

test('new calendar, order workflow and text parser use the shared authenticated role boundary',async()=>{
 for(const path of ['/api/unified/orders','/api/unified/calendar']){assert.equal((await http(path)).status,200);assert.equal((await http(path,null)).status,401);const low=await w.accounts.login({login:'employee',password});assert.equal((await http(path,low)).status,403);}
 const r=await http('/api/unified/parse-agreement',owner,{text:'5000 рублей за молоко, оплата завтра'});assert.equal(r.status,200);assert.equal((await r.json()).amountMinor,500000);
 const noCsrf=await fetch(base+'/api/unified/parse-agreement',{method:'POST',headers:{Cookie:'way_workspace='+owner.token,'Content-Type':'application/json'},body:JSON.stringify({text:'5000 рублей'})});assert.equal(noCsrf.status,403);
 const html=await(await http('/finance/')).text();assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
});

test('source order rules and competitor prices use unified persistence without a GitHub key',async()=>{
 const {runInNewContext}=await import('node:vm');let saves=0;const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{hidden:true,value:'3',textContent:''});return elements.get(id);};
 const context={Number,Date,localStorage:{setItem:()=>{}},state:{serverless:true,isAdmin:true,compPrices:[]},ui:{unifiedSave:async()=>{saves++;},compProduct:{id:'product'},compChosenId:'store'},$:get,ghConfigured:()=>false,svSaveAndPublish:async()=>{saves++;},publishFull:async()=>{saves++;},closeSheet:()=>{},toast:()=>{},renderStock:()=>{},parsePriceNum:Number};
 const card=await(await http('/catalog/js/modules/card.js')).text(),comp=await(await http('/catalog/js/modules/competitors.js')).text();
 for(const [code,name]of [[card,'saveOrderRules'],[comp,'submitCompetitorPrice']]){const fn=code.match(new RegExp('export async function '+name+'\\([^]*?\\n}'))?.[0];assert.ok(fn);runInNewContext(fn.replace('export ',''),context);}
 await context.saveOrderRules();assert.equal(saves,1);
 get('compPrice').value='10';await context.submitCompetitorPrice({preventDefault:()=>{}});assert.equal(saves,2);assert.equal(context.state.compPrices[0].price,10);
 assert.equal(get('compError').textContent,'');
 const {businessMoney}=await import('./unified-business.mjs'),html=await(await http('/finance/')).text(),moneyContext={window:{wayBusiness:{money:businessMoney}}};const fn=html.match(/function fmtRub\(kopecks\)\{[^]*?\}/)?.[0];assert.ok(fn);runInNewContext(fn,moneyContext);assert.match(moneyContext.fmtRub(115),/1,15/);
});
