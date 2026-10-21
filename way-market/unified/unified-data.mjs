import {cashShiftKey,assertShiftCanPost} from './workspace/shared-cash.mjs';
import {validateSourceSupplement,validateSourceProduct} from './unified-validation.mjs';
import {financeDate} from './workspace/finance-data.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {InputError,money} from './workspace/domain.mjs';
import {AccessError} from './workspace/access.mjs';
import {VersionError} from './workspace/workspace-store.mjs';
import {workspaceFinancialState} from './workspace/workspace-finance.mjs';
import {workspaceCatalogState} from './workspace/workspace-catalog.mjs';
export const ORG='00000000-0000-4000-8000-000000000001';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uid=s=>{const h=hash(s);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const amount=n=>{if(!Number.isSafeInteger(n)||n<0||n>99999999999)throw new InputError('Нужна целая сумма в копейках');return (BigInt(n)/100n).toString()+'.'+(n%100).toString().padStart(2,'0');};
const text=(s,max=150)=>{if(typeof s!=='string'||!s.trim()||s.length>max||/[\x00-\x1f]/.test(s))throw new InputError('Проверьте текст');return s.trim();};
const color=v=>{const c=v||'#5e5ce6';if(typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))throw new InputError('Цвет должен иметь вид #5E5CE6');return c;};
const categoryDefaults=[['Продажи','income'],['Z-отчёт','income'],['ЗП','expense'],['Аренда','expense'],['Закупка','expense'],['Хозрасходы владельца','expense'],['Налоги','expense'],['Прочий расход','expense'],['Перевод','income'],['Корректировка','income'],['Долг ТП','expense']].map(([name,type])=>({id:uid('cat:'+name),name,type,icon:'',color:'#5e5ce6',deleted_at:null}));
function metadata(db,bucket){const map=new Map();for(const row of db.prepare('SELECT subject_id,detail,sequence FROM account_events WHERE kind=? ORDER BY sequence').all('unified.'+bucket)){const d=JSON.parse(row.detail);map.set(row.subject_id,{...d.value,_version:row.sequence});}return map;}
const put=(audit,bucket,id,value)=>audit('unified.'+bucket,id,{value});
const iso=at=>new Date(at).toISOString();
export function createUnifiedData(w,sourceProducts=[],sourceGroups=[],{clock=Date.now}={}){
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(clock()));
 const source=new Map(sourceProducts.map(p=>[p.id,p]));
 const command=(token,action,fn)=>w.accounts.command(token,action,()=>({}),fn);
 const mutate=(token,p,fn)=>command(token,'finance.manage',(db,actor,audit)=>{
   if(p.orgId!==undefined&&p.orgId!==ORG)throw new AccessError('Другой магазин недоступен');
   if(!/^[a-f0-9-]{36}$/.test(p.requestId||''))throw new InputError('Нужен идентификатор команды');
   const old=db.prepare("SELECT detail FROM account_events WHERE kind='unified.request' AND subject_id=?").get(p.requestId);
   const digest=hash({actorId:actor.id,p});if(old){const d=JSON.parse(old.detail);if(d.digest!==digest)throw new InputError('Команда уже использована');return d.result;}
   const result=fn(db,actor,audit);audit('unified.request',p.requestId,{digest,result});return result;
 });
 function save(token,kind,p){const s=w.finance(token),refVersions={};for(const [key,list]of [['accountId',s.accounts],['toAccountId',s.accounts],['obligationId',s.obligations],['planId',s.plans],['movementId',s.movements]])if(p[key]){const r=list.find(x=>x.id===p[key]);if(r)refVersions[p[key]]=r.version;}return w.financeSave(token,{requestId:randomUUID(),expectedVersion:0,refVersions,kind,...p});}
 function state(db){return workspaceFinancialState(db);}
 function rows(db,actor,table){
  if(table==='org_members')return [{org_id:ORG,user_id:actor.id,role:actor.role,organizations:{name:'Way Market',type:'retail',settings:{}}}];
  if(table==='categories'){const m=new Map(categoryDefaults.map(c=>[c.id,c]));for(const [id,c] of metadata(db,'category'))m.set(id,c);return [...m.values()];}
  if(table==='employees')return [...metadata(db,'employee')].map(([id,e])=>({id,...e}));
  if(table==='org_settings')return [...metadata(db,'setting')].map(([key,e])=>({org_id:ORG,key,value:e.value}));
  const s=state(db), am=metadata(db,'account'),tm=metadata(db,'transaction');
  const cats=new Map(rows(db,actor,'categories').map(c=>[c.id,c]));
  const accounts=s.accounts.map(a=>({id:a.id,name:a.data.name,balance_kopecks:a.balance,deleted_at:a.data.active?null:'archived',status:a.data.active?'active':'archived',...am.get(a.id),_version:a.version}));
  if(table==='accounts')return accounts;
  const accountMap=new Map(accounts.map(a=>[a.id,a]));
  if(table==='shifts')return [...metadata(db,'shift')].map(([id,d])=>({id,...d,employees:rows(db,actor,'employees').find(e=>e.id===d.employee_id)}));
  if(table==='counterparties')return w.procurement(actor._token).suppliers.map(s=>({id:s.id,name:s.data.name,type:'supplier',phone:s.data.contact,note:s.data.terms,deleted_at:s.data.active?null:'archived',_version:s.version}));
  if(table==='transactions'){
   const out=[];for(const m of s.movements){const md=tm.get(m.id)||{};for(const effect of m.effects){const category=cats.get(md.categoryId);out.push({id:m.id+(m.data.type==='transfer'?(effect.delta<0?':out':':in'):''),client_uuid:m.id,date:m.data.date,type:effect.delta>=0?'income':'expense',amount_kopecks:Math.abs(effect.delta),comment:m.data.purpose,receipt_url:md.receiptUrl||null,shift_id:md.shiftId||null,locked:!!md.shiftId,deleted_at:m.reversedBy?iso(m.at):null,created_at:iso(m.at),category_id:md.categoryId||null,account_id:effect.accountId,employee_id:md.employeeId||null,categories:category||(m.data.type==='transfer'?{name:'Перевод между счетами',icon:'↔',color:'#625be6'}:undefined),accounts:accountMap.get(effect.accountId),employees:rows(db,actor,'employees').find(e=>e.id===md.employeeId),_version:m.version,transfer:m.data.type==='transfer'});}}
   return out;
  }
  if(table==='debt_entries'){
   const cps=new Map(rows(db,actor,'counterparties').map(c=>[c.id,c])),out=[];
   for(const o of s.obligations.filter(o=>o.data.direction==='payable')){
    out.push({id:o.id,counterparty_id:o.data.supplierId,type:'debt',amount_kopecks:o.data.amount,date:o.data.date,deleted_at:o.data.status==='cancelled'?'cancelled':null,counterparties:cps.get(o.data.supplierId),comment:o.data.basis});
    for(const m of s.movements.filter(m=>m.data.obligationId===o.id&&!m.reversedBy))out.push({id:m.id,counterparty_id:o.data.supplierId,type:'payment',amount_kopecks:m.data.amount,date:m.data.date,deleted_at:null,counterparties:cps.get(o.data.supplierId),accounts:accountMap.get(m.data.accountId)});
   }return out;
  }
  throw new InputError('Неизвестный набор данных');
 }
 function financeRead(token,table,query){return command(token,'finance.read',(db,actor)=>{
   let list=rows(db,{...actor,_token:token},table).map(r=>({org_id:ORG,deleted_at:null,...r}));
   for(const [key,expr] of query){if(['select','order','limit','offset'].includes(key))continue;if(!/^[a-z_]+$/.test(key))throw new InputError('Неверный фильтр');const ix=expr.indexOf('.'),op=expr.slice(0,ix),v=expr.slice(ix+1);if(!['eq','neq','is','gt','gte','lte','ilike'].includes(op))throw new InputError('Неверный фильтр');list=list.filter(r=>{const x=r[key];if(op==='eq')return String(x)===v;if(op==='neq')return String(x)!==v;if(op==='is')return v==='null'?x==null:String(x)===v;if(op==='gt')return x>v;if(op==='gte')return x>=v;if(op==='lte')return x<=v;return String(x||'').toLocaleLowerCase('ru').includes(v.replace(/^%|%$/g,'').toLocaleLowerCase('ru'));});}
   const order=query.get('order');if(order){const parts=order.split(',');list.sort((a,b)=>{for(const p of parts){const [key,dir]=p.split('.');const cmp=typeof a[key]==='number'?a[key]-b[key]:String(a[key]??'').localeCompare(String(b[key]??''),'ru');if(cmp)return cmp*(dir==='desc'?-1:1);}return 0;});}
   const offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||100000);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100000)throw new InputError('Неверный размер страницы');return list.slice(offset,offset+limit);
 });}
 function financeWrite(token,p){if(!p||typeof p!=='object'||Array.isArray(p))throw new InputError('Нужна финансовая команда');return mutate(token,p,(db,actor,audit)=>{
  const d=p.data||{};if(typeof d!=='object'||Array.isArray(d))throw new InputError('Нужны данные финансовой команды');const method=p.method, s=state(db),find=(list,id)=>{const x=list.find(x=>x.id===id);if(!x)throw new InputError('Запись недоступна');return x;};
  const stamp=(bucket,id,v)=>{put(audit,bucket,id,v);return {id,...v};};
  const accountPayload=(a,patch={})=>({id:a.id,expectedVersion:a.version,name:a.data.name,type:a.data.type,openingBalance:amount(a.data.openingBalance),openingDate:a.data.openingDate,active:a.data.active,reason:'Изменение в Finance',...patch});
  const movement=(type,data)=>{
   if(['amount','kind','id','expectedVersion','refVersions','requestId','confirmed','purpose','evidence','reference'].some(k=>Object.hasOwn(data,k)))throw new InputError('Лишние поля финансовой команды');
   const payload={type:type==='income'?'inflow':type==='expense'?'outflow':type,amount:amount(data.amountKopecks),accountId:data.accountId,date:data.date||today(),purpose:text(data.comment||'Операция Finance',500),evidence:'Ввод в Finance',reference:'',confirmed:true,reason:data.reason||''};
   for(const key of ['toAccountId','obligationId','planId','cashId','cashVersion'])if(Object.hasOwn(data,key))payload[key]=data[key];
   return save(token,'movement',payload);
  };
  if(method==='saveAccount'){
    if(actor.role!=='owner')throw new AccessError('Счета настраивает владелец');
    const a=d.id?find(s.accounts,d.id):null;if(a&&p.expectedVersion!==a.version)throw new InputError('Счёт изменён. Обновите данные');
    const r=save(token,'account',a?accountPayload(a,{name:text(d.name)}):{name:text(d.name),type:d.type==='bank'||/банк|карт|сбп/i.test(d.name)?'bank':'cash',openingBalance:amount(d.initialBalance==null?0:money(String(d.initialBalance),'Начальный остаток')),openingDate:today(),active:true});
    stamp('account',r.id,{icon:d.icon||'',color:color(d.color),sort_order:d.sortOrder||0});return r;
  }
  if(method==='deleteAccount'){if(actor.role!=='owner')throw new AccessError();const a=find(s.accounts,d.id);if(p.expectedVersion!==a.version)throw new InputError('Счёт изменён');return save(token,'account',accountPayload(a,{active:false}));}
  if(method==='adjustBalance'){const a=find(s.accounts,d.id);if(!Number.isSafeInteger(d.expectedBalance)||d.expectedBalance!==a.balance)throw new VersionError('Остаток изменён. Обновите счёт перед корректировкой');const delta=d.amountKopecks-a.balance;if(!Number.isSafeInteger(delta))throw new InputError('Проверьте остаток');return delta?movement(delta>0?'income':'expense',{accountId:a.id,amountKopecks:Math.abs(delta),comment:d.comment||'Корректировка остатка'}):{id:a.id};}
  if(['saveCategory','deleteCategory','saveEmployee','deleteEmployee'].includes(method)){
   const employee=method.includes('Employee'),bucket=employee?'employee':'category';const records=employee?rows(db,actor,'employees'):rows(db,actor,'categories');if(method.startsWith('delete')&&!d.id)throw new InputError('Выберите запись для удаления');const old=d.id?find(records,d.id):null;if(old?._version&&p.expectedVersion!==old._version)throw new InputError('Запись изменена. Обновите данные');const id=d.id||randomUUID();
   if(method.startsWith('delete'))return stamp(bucket,id,{...old,deleted_at:iso(Date.now())});
   if(employee)return stamp(bucket,id,{full_name:text(d.fullName,100),short_name:text(d.shortName||d.fullName.split(' ')[0],100),role:'cashier',phone:String(d.phone||''),salary:d.salary?money(String(d.salary),'Ставка'):null,deleted_at:null});
   if(!['income','expense','both'].includes(d.type))throw new InputError('Выберите вид статьи');return stamp(bucket,id,{name:text(d.name),type:d.type,icon:String(d.icon||''),color:color(d.color),deleted_at:null});
  }
  if(method==='setSetting'){const key=text(d.key,100);if(!Object.hasOwn(d,'value')||JSON.stringify(d.value).length>10000)throw new InputError('Слишком большие настройки');return stamp('setting',key,{value:d.value});}
  if(method==='saveCounterparty'){
   const old=d.id?find(w.procurement(token).suppliers,d.id):null;if(old&&p.expectedVersion!==old.version)throw new VersionError('Поставщик изменён. Обновите справочник');return w.procurementSave(token,{kind:'supplier',requestId:randomUUID(),expectedVersion:old?.version||0,...(old?{id:old.id}:{}),name:text(d.name),contact:String(d.phone||''),terms:String(d.note||''),active:true,reason:old?'Изменение в Finance':''});
  }
  if(method==='saveTransaction'){
   if(!['income','expense'].includes(d.type))throw new InputError('Выберите поступление или списание');const r=movement(d.type,d);stamp('transaction',r.id,{categoryId:d.categoryId||rows(db,actor,'categories').find(c=>c.name===d.categoryName)?.id||null,employeeId:d.employeeId||null,receiptUrl:d.receiptUrl||null,shiftId:d.shiftId||null});return r;
  }
  if(method==='saveTransfer')return movement('transfer',{...d,accountId:d.fromAccountId,toAccountId:d.toAccountId});
  if(method==='deleteTransaction'){
   const id=String(d.id).split(':')[0],m=find(s.movements,id);if(metadata(db,'transaction').get(id)?.shiftId)throw new InputError('Сначала отмените смену');return save(token,'reversal',{movementId:m.id,date:today(),reason:'Исправление записи в Finance',confirmed:true});
  }
  if(method==='saveDebtEntry'){
   const supplier=find(w.procurement(token).suppliers,d.counterpartyId),date=d.date||today();
   if(['debt','initial'].includes(d.type))return save(token,'obligation',{direction:'payable',party:supplier.data.name,supplierId:supplier.id,amount:amount(d.amountKopecks),date,dueDate:date,basis:d.comment||'Долг поставщику из Finance',status:'open'});
   if(d.type!=='payment'||!d.accountId)throw new InputError('Для оплаты выберите счёт');
   let remaining=d.amountKopecks;if(!Number.isSafeInteger(remaining)||remaining<=0)throw new InputError('Проверьте сумму');const debts=s.obligations.filter(o=>o.data.supplierId===supplier.id&&o.data.status==='open'&&o.data.direction==='payable').sort((a,b)=>a.data.date.localeCompare(b.data.date));
   if(debts.reduce((n,o)=>n+o.remaining,0)<remaining)throw new InputError('Оплата превышает долг. Аванс требует отдельного оформления');
   const ids=[];for(const debt of debts){const n=Math.min(remaining,debt.remaining);if(!n)continue;ids.push(movement('settlement',{accountId:d.accountId,obligationId:debt.id,amountKopecks:n,date,comment:d.comment||'Оплата поставщику'}).id);remaining-=n;if(!remaining)break;}return {ids};
  }
  if(method==='deleteDebtEntry'){
   const o=s.obligations.find(o=>o.id===d.id);if(o)return save(token,'obligation',{...o.data,amount:amount(o.data.amount),id:o.id,expectedVersion:o.version,status:'cancelled',reason:'Отмена ошибочного долга в Finance'});
   const m=find(s.movements,d.id);if(m.data.type!=='settlement')throw new InputError('Это не оплата долга');return save(token,'reversal',{movementId:m.id,date:today(),reason:'Исправление оплаты в Finance',confirmed:true});
  }
  if(method==='saveShift'){
   const employees=rows(db,actor,'employees'),employee=find(employees,d.employeeId);if(employee.deleted_at)throw new InputError('Сотрудник в архиве');
   if(!financeDate(d.date)||d.date>today()||!Number.isSafeInteger(d.shiftNum??1)||(d.shiftNum??1)<1||(d.shiftNum??1)>999999)throw new InputError('Проверьте дату и номер смены');
   const register=text(d.register,150),physical={date:d.date,register,shiftNo:String(d.shiftNum??1)};const key=cashShiftKey(physical);assertShiftCanPost(db,physical,s.movements);
   const id=randomUUID(),withdrawals=d.withdrawals||[];if(!Array.isArray(withdrawals)||withdrawals.length>100)throw new InputError('Проверьте выплаты');
   if(withdrawals.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new InputError('Проверьте выплаты');
   for(const k of ['zCash','zCard','zSbp','factCash','factCard','factSbp'])amount(d[k]);
   const withdrawalsSum=withdrawals.reduce((n,x)=>n+(Number.isSafeInteger(x.amount)&&x.amount>=0?x.amount:(()=>{throw new InputError('Проверьте сумму выплаты');})()),0);
   const movements=[];for(const [name,k] of [['Наличные','zCash'],['Карта/Банк','zCard'],['СБП','zSbp']]){if(!d[k])continue;const a=s.accounts.find(a=>a.data.name===name&&a.data.active);if(!a)throw new InputError('Создайте счёт «'+name+'»');const r=movement('income',{accountId:a.id,amountKopecks:d[k],date:d.date,comment:'Выручка по Z-отчёту, смена '+(d.shiftNum||1)});movements.push(r.id);stamp('transaction',r.id,{categoryId:uid('cat:Z-отчёт'),shiftId:id,employeeId:d.employeeId});}
   for(const x of withdrawals){if(!x.amount)continue;const a=s.accounts.find(a=>a.data.name===(x.account||'Наличные')&&a.data.active);if(!a)throw new InputError('Не найден счёт выплаты');const r=movement('expense',{accountId:a.id,amountKopecks:x.amount,date:d.date,comment:x.comment||'Выплата из кассы'});movements.push(r.id);stamp('transaction',r.id,{categoryId:rows(db,actor,'categories').find(c=>c.name===x.category)?.id||null,shiftId:id,employeeId:d.employeeId});}
   return stamp('shift',id,{key,register,date:d.date,shift_num:d.shiftNum||1,employee_id:d.employeeId,z_cash_kopecks:d.zCash,z_card_kopecks:d.zCard,z_sbp_kopecks:d.zSbp,z_total_kopecks:d.zCash+d.zCard+d.zSbp,fact_cash_kopecks:d.factCash,fact_card_kopecks:d.factCard,fact_sbp_kopecks:d.factSbp,diff_kopecks:d.factCash+withdrawalsSum-d.zCash,withdrawals_json:withdrawals,status:'closed',created_at:iso(Date.now()),movements});
  }
  if(method==='cancelShift'){
   const shift=metadata(db,'shift').get(d.id);if(!shift)throw new InputError('Смена не найдена');if(shift.status==='cancelled')return {id:d.id};for(const id of shift.movements||[]){const m=find(s.movements,id);if(m.reversedBy)continue;save(token,'reversal',{movementId:id,date:today(),reason:'Отмена смены '+shift.shift_num,confirmed:true});}return stamp('shift',d.id,{...shift,status:'cancelled'});
  }
  throw new InputError('Действие ещё не подключено');
 });}
 function seed(token){return command(token,'catalog.manage',(db,actor,audit)=>{
  if(db.prepare("SELECT 1 FROM account_events WHERE kind='unified.seed' LIMIT 1").get())return {imported:0};
  if(db.prepare('SELECT 1 FROM workspace_products LIMIT 1').get())throw new InputError('Импорт исходного каталога требует пустого товарного справочника');
  const insert=db.prepare('INSERT INTO workspace_products VALUES (?,?,?,?,?,?)'),req=db.prepare('INSERT INTO workspace_requests VALUES (?,?,?)');let count=0;
  for(const p of sourceProducts){const price=money(String(p.retail_price||0),'Цена'),barcode=p.barcodes?.find(b=>/^\d{0,32}$/.test(b))||'';text(p.name);if(!/^[a-f0-9-]{36}$/.test(p.id)||!/^\d{0,32}$/.test(barcode))throw new InputError('Некорректный товар в исходном каталоге');insert.run(p.id,1,p.name,barcode,price,1);audit('product.changed',p.id,{before:null,after:{version:1,name:p.name,barcode,price,active:true}});req.run(uid('seed:'+p.id),hash(p),JSON.stringify({id:p.id,version:1}));count++;}
  audit('unified.seed',null,{count,source:'b509d042bd3367f36424a4c3a6cc62089bb60975'});return {imported:count};
 });}
 function catalogSuppliers(db,actor){
  const contacts={},personal=metadata(db,'supplier');
  const suppliers=db.prepare("SELECT id,version,data FROM workspace_procurement WHERE kind='supplier' AND (id,version) IN (SELECT id,MAX(version) FROM workspace_procurement GROUP BY id)").all().filter(r=>JSON.parse(r.data).active).map(r=>{
   const d=JSON.parse(r.data);if(['owner','accountant'].includes(actor.role))contacts[r.id]={phone:d.contact,note:d.terms,contact_name:personal.get(r.id)?.contact_name||''};
   return {id:r.id,name:d.name,_version:r.version};
  });return {suppliers,contacts};
 }
 function catalog(token){return command(token,'catalog.read',(db,actor)=>{
  const s=workspaceCatalogState(db),overrides=metadata(db,'product'),profiles=new Set(db.prepare("SELECT DISTINCT id FROM workspace_catalog WHERE kind='profile'").all().map(r=>r.id));return {groups:metadata(db,'catalog-groups').get('groups')?.groups||sourceGroups,groupsVersion:metadata(db,'catalog-groups').get('groups')?._version||0,supplementVersion:['owner','accountant'].includes(actor.role)?metadata(db,'catalog-supplement').get('shared')?._version||0:0,...catalogSuppliers(db,actor),supplement:['owner','accountant'].includes(actor.role)?metadata(db,'catalog-supplement').get('shared')||{}:{},products:s.products.filter(p=>p.active).map(p=>{const src=source.get(p.id)||{},extra=overrides.get(p.id)||{};const visible={...src,...extra,id:p.id,name:p.name,barcodes:extra.barcodes||(profiles.has(p.id)?p.profile.barcodes.map(x=>x.code):(src.barcodes||[p.barcode].filter(Boolean))),code:p.profile.cashCode||extra.code||src.code||'',retail_price:p.price/100,unit:profiles.has(p.id)?p.profile.unit:(extra.unit||src.unit||'шт'),_version:p.version,photos:extra.photos||src.photos||[]};if(['owner','accountant'].includes(actor.role))return visible;const allowed=['id','name','barcodes','code','retail_price','unit','_version','photos','group_id','is_weighted','arrival_at','article','description'];return Object.fromEntries(allowed.filter(k=>Object.hasOwn(visible,k)).map(k=>[k,visible[k]]));}),role:actor.role};
 });}
 function preferences(token,p){return command(token,'workspace.read',(db,actor,audit)=>{
  const key=actor.id+':'+text(p.deviceId,100),old=metadata(db,'preferences').get(key)||{};
  if(!p.save)return old;
  const v=p.value;
  if(!v||typeof v!=='object'||Array.isArray(v)||!['system','light','dark'].includes(v.theme)||!['normal','large'].includes(v.textSize)||!['workspace','catalog','finance'].includes(v.lastModule))throw new InputError('Проверьте настройки');
  const value={theme:v.theme,textSize:v.textSize,lastModule:v.lastModule};
  if(Object.keys(value).every(k=>old[k]===value[k]))return old;
  if((p.expectedVersion??0)!==(old._version??0))throw new VersionError('Настройки изменены в другой вкладке. Обновите профиль перед сохранением');
  put(audit,'preferences',key,value);
  return metadata(db,'preferences').get(key);
 });}
 function catalogSave(token,p){return command(token,'catalog.manage',(db,actor,audit)=>{
  if(!Array.isArray(p.products)||!Array.isArray(p.archives??[])||p.products.length+(p.archives?.length||0)>50)throw new InputError('Допустимо до 50 изменённых товаров за запрос');
  const oldRequest=db.prepare("SELECT detail FROM account_events WHERE kind='unified.catalog-request' AND subject_id=?").get(p.requestId);
  const digest=hash({actorId:actor.id,p});if(oldRequest){const d=JSON.parse(oldRequest.detail);if(d.digest!==digest)throw new InputError('Команда уже использована');return d.result;}
  if(!/^[a-f0-9-]{36}$/.test(p.requestId||''))throw new InputError('Нужен идентификатор команды');
  if(p.groups&&(p.groupsVersion??0)!==(metadata(db,'catalog-groups').get('groups')?._version??0))throw new VersionError('Группы изменены в другой вкладке. Обновите каталог');
  if(p.supplement){
   if(actor.role!=='owner')throw new AccessError('Общие заказы и закупочные настройки каталога сохраняет владелец');
   if((p.supplementVersion??0)!==(metadata(db,'catalog-supplement').get('shared')?._version??0))throw new VersionError('Заказы или настройки изменены в другой вкладке. Обновите каталог');
  }
  const suppliers=[];
  if(p.suppliers!==undefined){
   if(actor.role!=='owner')throw new AccessError('Поставщиков из каталога изменяет владелец');
   if(!Array.isArray(p.suppliers)||p.suppliers.length>50||new Set(p.suppliers.map(x=>x?.id)).size!==p.suppliers.length)throw new InputError('Допустимо до 50 разных поставщиков');
   for(const entry of p.suppliers){
    if(!entry||!/^[a-f0-9-]{36}$/.test(entry.id)||typeof entry.active!=='boolean')throw new InputError('Проверьте поставщика');
    const old=w.procurement(token).suppliers.find(x=>x.id===entry.id);
    if((entry.version??0)!==(old?.version??0))throw new VersionError('Поставщик изменён. Обновите каталог');
    const c=entry.contact||{};for(const [key,max]of [['phone',200],['contact_name',100],['note',500]])if(typeof(c[key]??'')!=='string'||(c[key]??'').length>max||/[\x00-\x1f]/.test(c[key]??''))throw new InputError('Проверьте контакт поставщика');
    const r=w.procurementSave(token,{kind:'supplier',requestId:randomUUID(),expectedVersion:old?.version??0,...(old?{id:old.id}:{createId:entry.id}),name:text(entry.name),contact:(c.phone||'').trim(),terms:(c.note||'').trim(),active:entry.active,reason:old?'Изменение поставщика из каталога':''});
    put(audit,'supplier',r.id,{contact_name:(c.contact_name||'').trim()});suppliers.push(r);
   }
  }
  const changes=[...p.products.map(x=>x?.id),...(p.archives??[]).map(x=>x?.id)];if(new Set(changes).size!==changes.length)throw new InputError('Товар повторяется в команде');
  const currentExtras=metadata(db,'product');
  const result=[];
  for(const incoming of p.products){
   if(JSON.stringify(incoming).length>48000)throw new InputError('Карточка слишком большая; фото требуется загружать отдельным файлом');
   if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw new InputError('Проверьте карточку');
   if(actor.role!=='owner'){
    const publicFields=new Set(['id','name','barcodes','code','retail_price','unit','photos','group_id','is_weighted','arrival_at','article','description','active']);
    if(Object.keys(incoming).some(k=>!k.startsWith('_')&&!publicFields.has(k)))throw new AccessError('У этой роли нет прав изменять закрытые поля карточки');
   }
   validateSourceProduct(incoming);
   const old=db.prepare('SELECT * FROM workspace_products WHERE id=?').get(incoming.id);
   if(old&&incoming._version!==old.version)throw new InputError('Карточка изменена другим сотрудником: '+old.name);
   const r=w.productSave(token,{requestId:randomUUID(),expectedVersion:old?.version||0,...(old?{id:old.id}:{createId:incoming.id}),name:text(incoming.name),barcode:incoming.barcodes?.find(b=>/^\d{0,32}$/.test(b))||'',price:String(incoming.retail_price||0),active:incoming.active!==false,reason:old?'Изменение в исходном каталоге':''});
   const {id,_version,...extra}=incoming;const previous={...currentExtras.get(r.id)};delete previous._version;put(audit,'product',r.id,{...previous,...extra});result.push(r);
  }
  const archived=[];
  for(const incoming of p.archives??[]){
   const old=incoming&&db.prepare('SELECT * FROM workspace_products WHERE id=?').get(incoming.id);
   if(!old||old.version!==incoming.expectedVersion)throw new VersionError('Товар изменён. Обновите каталог перед удалением');
   archived.push(w.productSave(token,{requestId:randomUUID(),id:old.id,expectedVersion:old.version,name:old.name,barcode:old.barcode,price:amount(old.price),active:false,reason:'Архивирование из исходного каталога'}));
  }
  if(p.supplement){validateSourceSupplement(p.supplement);put(audit,'catalog-supplement','shared',p.supplement);}
  if(p.groups){if(!Array.isArray(p.groups)||JSON.stringify(p.groups).length>48000)throw new InputError('Проверьте группы');const groups=new Map();for(const g of p.groups){if(!g||!/^([a-f0-9-]{36})$/.test(g.id)||groups.has(g.id))throw new InputError('Неверный или повторный идентификатор группы');text(g.name,100);groups.set(g.id,g);}for(const g of groups.values()){const seen=new Set();let cursor=g;while(cursor){if(seen.has(cursor.id))throw new InputError('Цикл в группах');seen.add(cursor.id);if(!cursor.parent_id)break;cursor=groups.get(cursor.parent_id);if(!cursor)throw new InputError('Родительская группа не найдена');}}put(audit,'catalog-groups','groups',{groups:p.groups});}
  const reply={products:result,archived,suppliers,groupsVersion:metadata(db,'catalog-groups').get('groups')?._version||0,supplementVersion:metadata(db,'catalog-supplement').get('shared')?._version||0};audit('unified.catalog-request',p.requestId,{digest,result:reply});return reply;
 });}
 return {financeRead,financeWrite,seed,catalog,catalogSave,preferences};
}
