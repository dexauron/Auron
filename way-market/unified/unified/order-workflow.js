import { newRequestId } from '/request-id.mjs';
import {productPicker} from './product-picker.js';
// Review source planning orders before creating a budget reservation.
export async function appendCatalogOrders({root,s,products,api,node,button,field,select,surface,modal,formSubmit,rub,save}) {
 const state=await api('/api/unified/orders');
 const section=surface('Заказы из каталога');
 section.append(node('p','Перенос свяжет исходный заказ с закупкой и зарезервирует лимит. Проверьте товары, количество и закупочные цены.','fine'));
 const pending=state.orders.filter(o=>!['cancelled','received'].includes(o.status)||o.link);
 if(!pending.length)section.append(node('p','Ожидаемых заказов в каталоге пока нет.','empty'));
 for(const o of pending){
  const row=node('div',null,'row'),info=node('div',null,'row-main');
  info.append(node('strong',o.supplier_name||s.suppliers.find(x=>x.id===o.supplier_id)?.data.name||'Поставщик'),node('small',`Заказ ${o.placed_at||'—'} · поставка ${o.due_at||'—'} · ${rub(Math.round(Number(o.amount||0)*100))}`));
  if(o.note)info.append(node('p',o.note,'fine'));row.append(info);
  if(o.link){if(o.link.sourceChanged)info.append(node('p','Исходная заявка изменена после переноса. Проверьте её отдельно: резерв и накладные относятся к сохранённой закупке.','error'));const common=s.orders.find(x=>x.id===o.link.orderId);info.append(node('small',common?`${common.closed?'Закрыт':'Открыт'} в закупках · резерв ${rub(common.reserved)} · принято ${rub(common.used)}`:'Связанный заказ недоступен'));}
  else row.append(button('Связать с закупкой',()=>review(o),'primary'));
  section.append(row);
 }
 root.prepend(section);
 function review(o){
  if(!Array.isArray(o.items)||!o.items.length||o.items.length>50){modal('Уточните заказ',node('p','В исходном заказе нужны от 1 до 50 позиций. Добавьте или уточните их в каталоге.'));return;}
  const f=node('form');f.append(node('p',`Сумма каталога: ${rub(Math.round(Number(o.amount||0)*100))}. Лимит резервируется по итоговой сумме позиций.`,'fine'));
  select(f,'Лимит закупки','budgetId',s.budgets.map(b=>[b.id,`${b.data.name} · доступно ${rub(b.available)}`]));
  const lines=[];
  for(const [sourceIndex,item] of o.items.entries()){
   const box=surface(`${sourceIndex+1}. ${String(item.name||'Без наименования')}`);
   const exact=products.filter(p=>p.name.toLocaleLowerCase('ru')===String(item.name||'').toLocaleLowerCase('ru'));
   const product=productPicker({box,api,node,field,select,initial:exact.length===1?exact[0]:null,query:String(item.name||'')});
   const unit=field(box,'Единица','unit',{value:'шт',required:true,maxLength:20});
   const quantity=field(box,'Количество','quantity',{value:Number(item.qty)>0?String(item.qty):'',required:true,inputMode:'decimal'});
   const price=field(box,'Закупочная цена, ₽','price',{required:true,inputMode:'decimal'});
   lines.push({sourceIndex,product,unit,quantity,price});f.append(box);
  }
  select(f,'Если итог отличается от суммы каталога','confirmAmountChange',[['no','Остановить и проверить'],['yes','Подтверждаю сумму по позициям']]);
  const requestId=newRequestId();
  formSubmit(f,'Создать закупку и резерв',async()=>{
   if(lines.some(l=>!l.product.value))throw Error('Сопоставьте каждый товар с общей базой');
   await save({requestId,sourceId:o.id,sourceVersion:state.sourceVersion,budgetId:f.elements.budgetId.value,confirmAmountChange:f.elements.confirmAmountChange.value==='yes',lines:lines.map(l=>({sourceIndex:l.sourceIndex,productId:l.product.value,unit:l.unit.value,quantity:l.quantity.value,price:l.price.value}))});
  });modal('Заказ каталога → закупка',f);
 }
}
