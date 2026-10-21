import {parseUnifiedAgreement} from './unified-agreement.mjs';
import {unifiedCalendar} from './unified-calendar.mjs';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {createUnifiedData} from './unified-data.mjs';
import {unifiedOrderMethods} from './unified-orders.mjs';
import {makeWorkspaceArchive,validateWorkspaceArchive} from './workspace/workspace-archive.mjs';
const password='Общая проверочная фраза 2026';let w,data,orders,owner,employee,administrator,dir,productId,supplierId,budgetId;
const uuid=()=>randomUUID();
before(async()=>{
 dir=await mkdtemp(join(tmpdir(),'way-order-'));w=openWorkspace(join(dir,'test.sqlite'));
 await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});owner=await w.accounts.login({login:'owner',password});
 for(const role of ['employee','administrator'])await w.accounts.createUser(owner.token,{login:role,name:role,role,password});
 employee=await w.accounts.login({login:'employee',password});administrator=await w.accounts.login({login:'administrator',password});
 productId=w.productSave(owner.token,{requestId:uuid(),expectedVersion:0,name:'Молоко',barcode:'123',price:'150',active:true}).id;
 data=createUnifiedData(w);orders=unifiedOrderMethods(w);supplierId=uuid();
 data.catalogSave(owner.token,{requestId:uuid(),products:[],suppliers:[{id:supplierId,name:'Общий поставщик',version:0,active:true,contact:{phone:'123',contact_name:'Представитель',note:'По накладной'}}]});
 budgetId=w.procurementSave(owner.token,{requestId:uuid(),expectedVersion:0,kind:'budget',name:'Закупки',scope:'Магазин',start:'2026-10-01',end:'2026-10-31',amount:'1000'}).id;
});
after(async()=>{w.close();await rm(dir,{recursive:true,force:true});});
function source(amount=200){const id=uuid();const old=data.catalog(owner.token);data.catalogSave(owner.token,{requestId:uuid(),products:[],supplementVersion:old.supplementVersion,supplement:{...Object.fromEntries(Object.entries(old.supplement).filter(([k])=>!k.startsWith('_'))),orders:[...(old.supplement.orders||[]),{id,supplier_id:supplierId,supplier_name:'Общий поставщик',placed_at:'2026-10-19',due_at:'2026-10-20',status:'ordered',amount,items:[{name:'Молоко',qty:2}]}]}});return id;}
function payload(sourceId,price='100'){return {requestId:uuid(),sourceId,sourceVersion:orders.list(owner.token).sourceVersion,budgetId,lines:[{sourceIndex:0,productId,quantity:'2',price,unit:'шт'}]};}
test('supplier CRUD from catalog shares IDs, contacts and optimistic versions with procurement and Finance',()=>{
 let c=data.catalog(owner.token),s=c.suppliers.find(s=>s.id===supplierId);assert.equal(s.name,'Общий поставщик');assert.equal(c.contacts[s.id].contact_name,'Представитель');
 assert.equal(data.financeRead(owner.token,'counterparties',new URLSearchParams()).find(x=>x.id===s.id).phone,'123');
 assert.equal(data.catalog(employee.token).contacts[s.id],undefined);
 const save={requestId:uuid(),products:[],suppliers:[{id:s.id,name:'Переименован',version:s._version,active:true,contact:{phone:'456',note:'Условия',contact_name:'Имя'}}]};data.catalogSave(owner.token,save);
 assert.equal(w.procurement(owner.token).suppliers.find(x=>x.id===s.id).data.contact,'456');
 assert.throws(()=>data.catalogSave(owner.token,{...save,requestId:uuid()}));
 assert.throws(()=>data.catalogSave(administrator.token,{...save,requestId:uuid()}));
});
test('catalog order conversion reserves one shared budget and retries return the same order',()=>{
 const id=source(),p=payload(id),r=orders.convert(owner.token,p);assert.equal(r.total,20000);
 assert.deepEqual(orders.convert(owner.token,p),r);assert.equal(orders.list(owner.token).orders.find(o=>o.id===id).link.orderId,r.id);
 const b=w.procurement(owner.token).budgets.find(x=>x.id===budgetId);assert.equal(b.reserved,20000);assert.equal(b.available,80000);
 assert.throws(()=>orders.convert(owner.token,{...p,requestId:uuid()}));assert.throws(()=>orders.convert(employee.token,p));
});
test('amount mismatch, missing mapping and budget overflow roll back orders, links and reserve',()=>{
 const id=source(50),p=payload(id),before=w.procurement(owner.token).orders.length;
 assert.throws(()=>orders.convert(owner.token,p),/Подтвердите/);assert.equal(w.procurement(owner.token).orders.length,before);
 assert.equal(orders.list(owner.token).orders.find(o=>o.id===id).link,null);
 assert.throws(()=>orders.convert(owner.token,{...p,lines:[]}));
 assert.throws(()=>orders.convert(owner.token,{...p,confirmAmountChange:true,lines:[{...p.lines[0],price:'10000'}]}));
 assert.equal(w.procurement(owner.token).orders.length,before);
 const r=orders.convert(owner.token,{...p,confirmAmountChange:true});assert.equal(r.sourceAmount,5000);assert.equal(r.total,20000);
});
test('stale source order snapshot and duplicate line indices cannot create a purchase',()=>{
 const id=source(),p=payload(id);source();assert.throws(()=>orders.convert(owner.token,p),/изменены/);
 const p2=payload(id);p2.lines.push({...p2.lines[0]});assert.throws(()=>orders.convert(owner.token,p2));
});
test('converted purchase can be partially received and reserve is replaced by actual invoice amount',()=>{
 const id=source(),r=orders.convert(owner.token,payload(id)),o=w.procurement(owner.token).orders.find(x=>x.id===r.id);
 w.procurementSave(owner.token,{requestId:uuid(),expectedVersion:0,kind:'receipt',orderId:o.id,orderVersion:o.version,number:'Каталог-1',date:'2026-10-20',final:true,note:'Недовоз одной единицы',lines:[{lineId:o.lines[0].id,quantity:'1',price:'100'}]});
 const order=w.procurement(owner.token).orders.find(x=>x.id===o.id);assert.equal(order.closed,true);assert.equal(order.reserved,0);assert.equal(order.used,10000);
 assert.equal(orders.list(owner.token).orders.find(x=>x.id===id).link.orderId,o.id);
});
test('supplier archive retains history, purchase links and valid backup relationships',()=>{
 const s=data.catalog(owner.token).suppliers.find(s=>s.id===supplierId);
 data.catalogSave(owner.token,{requestId:uuid(),products:[],suppliers:[{id:s.id,version:s._version,name:s.name,active:false,contact:{}}]});
 assert.equal(data.catalog(owner.token).suppliers.some(s=>s.id===supplierId),false);assert.ok(w.procurement(owner.token).suppliers.some(s=>s.id===supplierId));
 assert.doesNotThrow(()=>validateWorkspaceArchive(makeWorkspaceArchive(w.accounts.workspaceSnapshot(owner.token))));
});

test('unified calendar derives debt deadlines and purchase/delivery closures without posting money',()=>{
 const r=w.financeSave(owner.token,{requestId:uuid(),expectedVersion:0,kind:'obligation',refVersions:{},direction:'payable',party:'Календарный долг',amount:'10',date:'2026-10-19',dueDate:'2026-10-19',basis:'Проверка срока',status:'open'});
 const before=w.finance(owner.token).movements.length,state=unifiedCalendar(w,owner.token,{clock:()=>Date.parse('2026-10-21T00:00:00Z')});
 const event=state.items.find(x=>x.id==='obligation:'+r.id);assert.equal(event.overdue,true);assert.equal(event.amount,1000);
 assert.ok(state.items.some(x=>x.kind==='order'&&x.closed));assert.ok(state.items.some(x=>x.kind==='delivery'&&x.closed));
 assert.equal(w.finance(owner.token).movements.length,before);assert.throws(()=>unifiedCalendar(w,employee.token));
});

test('Telegram text parser fills a reviewable proposal under shared permissions without creating debts',()=>{
 const before=w.finance(owner.token).obligations.length;
 const r=parseUnifiedAgreement(w,owner.token,{text:'5000 руб за молоко, оплата завтра'},{clock:()=>Date.parse('2026-10-19T20:59:00Z')});
 assert.equal(r.amountMinor,500000);assert.equal(r.dueDate,'2026-10-20');assert.equal(r.requiresReview,true);
 const afterMidnight=parseUnifiedAgreement(w,owner.token,{text:'5000 руб за молоко, оплата завтра'},{clock:()=>Date.parse('2026-10-19T21:01:00Z')});assert.equal(afterMidnight.dueDate,'2026-10-21');
 assert.equal(w.finance(owner.token).obligations.length,before);
 assert.throws(()=>parseUnifiedAgreement(w,employee.token,{text:'5000 рублей'}));
 assert.throws(()=>parseUnifiedAgreement(w,owner.token,{text:'a'.repeat(501)}));
});
