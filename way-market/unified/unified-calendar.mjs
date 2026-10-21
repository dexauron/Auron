import {financeDate} from './workspace/finance-data.mjs';
// Calendar is a projection: it never posts money or confirms another party's action.
export function unifiedCalendar(w,token,{clock=Date.now}={}) {
 const finance=w.finance(token),procurement=w.procurement(token),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(clock()));
 const items=[];
 for(const o of finance.obligations){
  const closed=o.data.status==='cancelled'||o.remaining===0;
  items.push({id:'obligation:'+o.id,kind:'obligation',date:o.data.dueDate,title:o.data.party,detail:o.data.direction==='payable'?'К оплате поставщику':'К получению',amount:o.remaining,originalAmount:o.data.amount,closed,overdue:!closed&&o.data.dueDate<today,href:'/?view=finance'});
 }
 for(const p of finance.plans){const o=finance.obligations.find(o=>o.id===p.data.obligationId);const closed=p.data.status==='cancelled'||p.remaining===0;items.push({id:'plan:'+p.id,kind:'plan',date:p.data.date,title:o.data.party,detail:'Назначенный платёж',amount:p.remaining,closed,overdue:!closed&&p.data.date<today,href:'/?view=finance'});}
 for(const o of procurement.orders){items.push({id:'order:'+o.id,kind:'order',date:o.data.date,title:procurement.suppliers.find(s=>s.id===o.data.supplierId)?.data.name||'Поставщик',detail:'Заказ закупки',amount:o.total,closed:o.closed,overdue:false,href:'/?view=procurement'});}
 const sourceRows=w.accounts.command(token,'procurement.read',()=>({}),db=>db.prepare("SELECT kind,subject_id,detail FROM account_events WHERE kind IN ('unified.catalog-supplement','unified.order-link') ORDER BY sequence").all());
 let source={};const links=new Map();for(const row of sourceRows){const d=JSON.parse(row.detail).value;if(row.kind==='unified.catalog-supplement')source=d;else links.set(row.subject_id,d);}
 for(const o of Array.isArray(source.orders)?source.orders:[]){if(!o||!financeDate(o.due_at))continue;const linked=procurement.orders.find(p=>p.id===links.get(o.id)?.orderId);const closed=linked?linked.closed:['received','cancelled'].includes(o.status);items.push({id:'delivery:'+o.id,kind:'delivery',date:o.due_at,title:o.supplier_name||'Поставка каталога',detail:links.has(o.id)?'Ожидаемая поставка · связана с закупкой':'Ожидаемая поставка каталога',amount:null,closed,overdue:!closed&&o.due_at<today,href:'/?view=procurement'});}
 return {today,items:items.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))};
}
