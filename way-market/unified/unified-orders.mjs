import {randomUUID,createHash} from 'node:crypto';
import {InputError,money} from './workspace/domain.mjs';
import {VersionError} from './workspace/workspace-store.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const records=(db,kind)=>db.prepare('SELECT subject_id,detail,sequence FROM account_events WHERE kind=? ORDER BY sequence').all('unified.'+kind);
const latest=(db,kind)=>new Map(records(db,kind).map(r=>[r.subject_id,{...JSON.parse(r.detail).value,_version:r.sequence}]));
const sourceState=db=>latest(db,'catalog-supplement').get('shared')||{};
function sourceOrders(db){const list=sourceState(db).orders??[];if(!Array.isArray(list))throw new InputError('Проверьте список заказов каталога');return list;}
export function unifiedOrderMethods(w){
 const command=(token,fn)=>w.accounts.command(token,'procurement.manage',()=>({}),fn);
 function list(token){return command(token,db=>{
  const source=sourceState(db),links=latest(db,'order-link'),procurement=w.procurement(token);
  return {sourceVersion:source._version||0,orders:sourceOrders(db).map(o=>({...o,link:links.has(o.id)?{...links.get(o.id),sourceChanged:hash(o)!==links.get(o.id).sourceHash}:null})),budgets:procurement.budgets};
 });}
 function convert(token,p){return command(token,(db,actor,audit)=>{
  if(!p||!/^[a-f0-9-]{36}$/.test(p.requestId||''))throw new InputError('Нужен идентификатор команды');
  const digest=hash({actorId:actor.id,p});const prior=records(db,'order-request').find(r=>r.subject_id===p.requestId);
  if(prior){const d=JSON.parse(prior.detail);if(d.digest!==digest)throw new InputError('Команда уже использована');return d.result;}
  const source=sourceState(db);if(p.sourceVersion!==(source._version||0))throw new VersionError('Заказы каталога изменены. Обновите список');
  const matches=sourceOrders(db).filter(o=>o?.id===p.sourceId);
  if(matches.length!==1)throw new InputError('Исходный заказ недоступен или его идентификатор повторяется');
  const order=matches[0];if(['received','cancelled'].includes(order.status))throw new InputError('Переносить можно только ожидаемый заказ');
  if(latest(db,'order-link').has(order.id))throw new VersionError('Этот заказ уже связан с закупкой');
  const items=order.items;if(!Array.isArray(items)||!items.length||items.length>50)throw new InputError('В заказе нужны от 1 до 50 позиций. Сначала уточните заказ в каталоге');
  if(!Array.isArray(p.lines)||p.lines.length!==items.length)throw new InputError('Сопоставьте все позиции исходного заказа');
  const indices=new Set();for(const l of p.lines){if(!l||!Number.isInteger(l.sourceIndex)||l.sourceIndex<0||l.sourceIndex>=items.length||indices.has(l.sourceIndex))throw new InputError('Позиция пропущена или повторяется');indices.add(l.sourceIndex);}
  const supplier=w.procurement(token).suppliers.find(s=>s.id===order.supplier_id&&s.data.active);if(!supplier)throw new InputError('Выберите действующего поставщика в исходном заказе');
  const reply=w.procurementSave(token,{requestId:randomUUID(),expectedVersion:0,kind:'order',supplierId:supplier.id,budgetId:p.budgetId,date:order.placed_at,status:'open',lines:p.lines.map(l=>({id:randomUUID(),productId:l.productId,unit:l.unit,quantity:l.quantity,price:l.price}))});
  const saved=w.procurement(token).orders.find(o=>o.id===reply.id),declared=money(String(order.amount),'Сумма исходного заказа');
  if(saved.total!==declared&&p.confirmAmountChange!==true)throw new InputError('Сумма позиций отличается от суммы каталога. Подтвердите изменение суммы');
  const link={orderId:reply.id,sourceId:order.id,sourceHash:hash(order),sourceAmount:declared,amount:saved.total,sourceSnapshot:order};
  audit('unified.order-link',order.id,{value:link});const result={...reply,total:saved.total,sourceAmount:declared};audit('unified.order-request',p.requestId,{digest,result});return result;
 });}
 return {list,convert};
}
