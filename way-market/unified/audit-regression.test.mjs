import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
const target=resolve(process.env.WAY_AUDIT_TARGET||new URL('.',import.meta.url).pathname),url=p=>pathToFileURL(join(target,p)).href;
const {openWorkspace}=await import(url('workspace/workspace-store.mjs'));
const {createUnifiedData,ORG}=await import(url('unified-data.mjs'));
const password='Фраза проверки аудита 2026';
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'way-audit-')),w=openWorkspace(join(dir,'audit.sqlite'));t.after(async()=>{w.close();await rm(dir,{recursive:true,force:true});});await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});const data=createUnifiedData(w,[],[],{clock:()=>Date.now()});const write=(method,d,extra={})=>data.financeWrite(owner.token,{requestId:randomUUID(),orgId:ORG,method,data:d,...extra});return {w,owner,data,write};}
test('AUDIT: financial amount cannot be replaced by an unrelated request field',async t=>{
 const {w,write,owner}=await fixture(t);const a=write('saveAccount',{name:'Наличные',initialBalance:'0'}).id;
 assert.throws(()=>write('saveTransaction',{type:'income',accountId:a,amountKopecks:100,amount:'999',date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'})}));
 assert.equal(w.finance(owner.token).accounts.find(x=>x.id===a).balance,0);
});
test('AUDIT: empty Z-report still requires a valid date, shift number and active employee',async t=>{
 const {write,data,owner}=await fixture(t);const employeeId=write('saveEmployee',{fullName:'Кассир'}).id;
 const amounts={employeeId,zCash:0,zCard:0,zSbp:0,factCash:0,factCard:0,factSbp:0};
 assert.throws(()=>write('saveShift',{...amounts,date:'2026-02-30',shiftNum:-2}));
 write('deleteEmployee',{id:employeeId},{expectedVersion:data.financeRead(owner.token,'employees',new URLSearchParams()).find(e=>e.id===employeeId)._version});
 assert.throws(()=>write('saveShift',{...amounts,date:'2026-10-19',shiftNum:1}));
});
test('AUDIT: malformed source orders cannot poison the common calendar',async t=>{
 const {data,owner}=await fixture(t);
 assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],supplement:{orders:[null]}}));
 assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[],supplement:{orders:[{id:randomUUID(),status:'ordered',placed_at:'2026-10-19',due_at:'2026-02-30',amount:10,items:[]}]}}));
});
test('AUDIT: stale supplier edits from Finance cannot overwrite newer procurement changes',async t=>{
 const {write,w,owner}=await fixture(t);const p=write('saveCounterparty',{name:'Первая версия'});const old=w.procurement(owner.token).suppliers.find(s=>s.id===p.id);
 w.procurementSave(owner.token,{kind:'supplier',id:old.id,expectedVersion:old.version,requestId:randomUUID(),name:'Новая версия',contact:'',terms:'',active:true,reason:'Проверка'});
 assert.throws(()=>write('saveCounterparty',{id:p.id,name:'Устаревшая версия'},{expectedVersion:old.version}));
 assert.equal(w.procurement(owner.token).suppliers.find(s=>s.id===p.id).data.name,'Новая версия');
});
async function catalogClient(){
 const p={id:randomUUID(),name:'Товар',retail_price:1,_version:1},group={id:randomUUID(),name:'Группа'};
 const state={},ui={},posts=[];let groupVersion=1,supplementVersion=1,beforeReply=null;
 const context={newRequestId:randomUUID,state,ui,$:()=>null,buildIndex:()=>{},renderAll:()=>{},toast:()=>{},crypto:{randomUUID},location:{replace:()=>{}},document:{addEventListener:()=>{}},fetch:async(path,options)=>{
  if(path==='/api/session')return new Response(JSON.stringify({user:{id:'owner',role:'owner'},csrf:'csrf'}));
  if(path==='/api/unified/seed')return new Response('{}');
  if(path==='/api/unified/catalog')return new Response(JSON.stringify({products:[p],groups:[group],suppliers:[],contacts:{},supplement:{orders:[],competitors:[],compPrices:[],unitCoef:{},orderRules:null},groupsVersion:1,supplementVersion:1}));
  const b=JSON.parse(options.body);posts.push(b);if(beforeReply){const fn=beforeReply;beforeReply=null;await fn();}return new Response(JSON.stringify({products:b.products.map(p=>({id:p.id,version:p._version+1})),groupsVersion:groupVersion,supplementVersion}));
 }};context.window=context;
 const source=(await readFile(join(target,'unified/catalog-adapter.js'),'utf8')).replace(/^import .*;\n/gm,'').replace('export async function initialize','async function initialize');
 runInNewContext(source+'\nthis.start=initialize;',context);await context.start();return {state,ui,posts,onReply:fn=>{beforeReply=fn;},setVersions:(g,s)=>{groupVersion=g;supplementVersion=s;}};
}
test('AUDIT: unrelated card save must not advance unseen group and setting versions',async()=>{
 const c=await catalogClient();c.setVersions(2,2);c.state.products[0].retail_price=2;await c.ui.unifiedSave();
 c.state.groups[0].name='Из старой вкладки';c.state.orders.push({id:randomUUID()});await c.ui.unifiedSave();
 assert.equal(c.posts.find(p=>p.groups)?.groupsVersion,1);assert.equal(c.posts.find(p=>p.supplement)?.supplementVersion,1);
});
test('AUDIT: ambiguous financial response reuses the complete original command on retry',async()=>{
 const bodies=[];let fail=true,pending=null;const context={URL,crypto:{randomUUID},location:{href:'http://localhost/finance/',origin:'http://localhost',replace:()=>{}},API:{},fetch:async(path,opts)=>{
  if(path==='/api/session')return new Response(JSON.stringify({user:{id:'owner',version:1},csrf:'csrf'}));
  if(path==='/api/unified/commands')return new Response(JSON.stringify({commands:pending?[{id:pending.requestId,payload:pending,status:'prepared'}]:[]}));
  if(path.endsWith('/prepare')){pending=JSON.parse(opts.body);return new Response('{}');}
  if(path.endsWith('/dismiss')){pending=null;return new Response('{}');}
  bodies.push(pending);if(fail){fail=false;throw Error('Ответ потерян после записи');}return new Response('{"ok":true,"result":{"id":"saved"}}');
 }};context.window=context;runInNewContext(await readFile(join(target,'unified/finance-adapter.js'),'utf8'),context);await context.AUTH.init();
 const p={type:'income',amountKopecks:100,accountId:'account'};
 await assert.rejects(()=>context.API.saveTransaction(ORG,{...p,clientUuid:randomUUID()}));await context.API.saveTransaction(ORG,{...p,clientUuid:randomUUID()});
 assert.deepEqual(bodies[0],bodies[1]);
});
test('AUDIT: role change in another tab scrubs a protected source view before navigation',async()=>{
 const redirects=[],state={scrubbed:false,hidden:false},context={session:{user:{id:'owner',version:1}},current:'finance',generation:0,fetchSession:async()=>({user:{id:'employee',version:1}}),samePrincipal:(a,b)=>!!a&&!!b&&a.id===b.id&&a.version===b.version,detach:()=>{},clearPrivate:()=>{},document:{getElementById:()=>({}),body:{replaceChildren:()=>{state.scrubbed=true;}},documentElement:{style:{set visibility(v){state.hidden=v==='hidden';}}}},location:{replace:p=>redirects.push(p)}};
 const source=await readFile(join(target,'unified/shell.js'),'utf8'),start=source.indexOf('async function mountInner(){'),end=source.indexOf(' const identity=',start);
 runInNewContext(source.slice(start,end)+' return true; }\nthis.check=mountInner;',context);
 await context.check();assert.equal(state.scrubbed,true);assert.equal(state.hidden,true);assert.deepEqual(redirects,['/?view=home']);
});

test('AUDIT: edits made while a catalog request is pending are not falsely marked saved',async()=>{
 const c=await catalogClient();c.state.products[0].name='Отправлено';c.onReply(async()=>{c.state.products[0].name='Новая правка во время запроса';});
 await c.ui.unifiedSave();assert.equal(c.posts[0].products[0].name,'Отправлено');await c.ui.unifiedSave();assert.equal(c.posts[1].products[0].name,'Новая правка во время запроса');
});

test('AUDIT: a balance adjustment cannot use a stale observed account balance',async t=>{
 const {write,w,owner}=await fixture(t),accountId=write('saveAccount',{name:'Наличные',initialBalance:'0'}).id;
 write('saveTransaction',{accountId,type:'income',amountKopecks:100});
 assert.throws(()=>write('adjustBalance',{id:accountId,amountKopecks:10000,expectedBalance:0}));
 assert.equal(w.finance(owner.token).accounts.find(a=>a.id===accountId).balance,100);
});
test('AUDIT: product lookup reaches beyond the first 1000 records and limits rendered choices',async t=>{
 const {w,owner}=await fixture(t),{productOptions}=await import(url('unified-product-options.mjs'));let wanted;
 w.accounts.command(owner.token,'catalog.manage',()=>({}),db=>{const insert=db.prepare('INSERT INTO workspace_products VALUES (?,?,?,?,?,?)');for(let i=0;i<1200;i++){const id=randomUUID();insert.run(id,1,'Товар '+String(i).padStart(4,'0'),String(i),100,1);if(i===1199)wanted=id;}});
 assert.equal(w.products(owner.token).length,1000);
 const found=productOptions(w,owner.token,'ТОВАР 1199');assert.equal(found.products.length,1);assert.equal(found.products[0].id,wanted);
 assert.equal(productOptions(w,owner.token,'1199').products[0].id,wanted);const all=productOptions(w,owner.token,'Товар');assert.equal(all.products.length,30);assert.equal(all.hasMore,true);
});
test('AUDIT: malformed public card collections and incomplete metadata commands are rejected atomically',async t=>{
 const {data,owner,write}=await fixture(t);
 assert.throws(()=>data.catalogSave(owner.token,{requestId:randomUUID(),products:[{id:randomUUID(),name:'Товар',retail_price:1,photos:'not-an-array'}]}));
 assert.equal(data.catalog(owner.token).products.length,0);assert.throws(()=>write('deleteCategory',{}));assert.throws(()=>write('setSetting',{key:'missing'}));
});

test('AUDIT: legacy source status cannot close an open linked procurement delivery',async()=>{
 const {unifiedCalendar}=await import(url('unified-calendar.mjs'));
 const w={finance:()=>({obligations:[],plans:[]}),procurement:()=>({suppliers:[],orders:[{id:'purchase',data:{supplierId:'supplier',date:'2026-10-19'},closed:false,total:100}]}),accounts:{command:()=>[
  {kind:'unified.catalog-supplement',subject_id:'shared',detail:JSON.stringify({value:{orders:[{id:'source',due_at:'2026-10-19',status:'received'}]}})},
  {kind:'unified.order-link',subject_id:'source',detail:JSON.stringify({value:{orderId:'purchase'}})}
 ]}};
 const event=unifiedCalendar(w,'token',{clock:()=>Date.parse('2026-10-20T12:00:00Z')}).items.find(x=>x.kind==='delivery');assert.equal(event.closed,false);assert.equal(event.overdue,true);
});

test('AUDIT: shop dates use Moscow midnight and Sunday belongs to the ending week',async()=>{
 const {businessDate,businessRange}=await import(url('unified-business.mjs'));
 assert.equal(businessDate(new Date('2026-10-19T20:59:00Z')),'2026-10-19');assert.equal(businessDate(new Date('2026-10-19T21:00:00Z')),'2026-10-20');
 assert.deepEqual(businessRange('week',new Date('2026-10-18T12:00:00Z')),{from:'2026-10-12',to:'2026-10-18'});
 assert.deepEqual(businessRange('week',new Date('2026-10-18T21:00:00Z')),{from:'2026-10-19',to:'2026-10-19'});
});
test('AUDIT: displayed financial amounts retain kopecks',async()=>{
 const {businessMoney}=await import(url('unified-business.mjs'));
 assert.match(businessMoney(115),/1,15/);assert.match(businessMoney(199),/1,99/);assert.match(businessMoney(-115),/[-−]1,15/);assert.match(businessMoney(100),/1/);assert.equal(businessMoney(NaN),'—');
});
