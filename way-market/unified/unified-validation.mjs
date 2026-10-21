import {InputError,money} from './workspace/domain.mjs';
import {financeDate} from './workspace/finance-data.mjs';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const bad=message=>{throw new InputError(message);};
const string=(v,max,blank=true)=>typeof v==='string'&&v.length<=max&&(blank||v.trim())&&!/[\x00-\x1f]/.test(v);
export function validateSourceSupplement(v){
 if(!object(v)||JSON.stringify(v).length>48000||Object.keys(v).some(k=>!['orders','competitors','compPrices','unitCoef','orderRules'].includes(k)))bad('Проверьте дополнительные данные каталога');
 for(const key of ['orders','competitors','compPrices'])if(Object.hasOwn(v,key)&&(!Array.isArray(v[key])||v[key].some(x=>!object(x))))bad('Проверьте список '+key);
 const ids=new Set();for(const o of v.orders||[]){
  if(!string(o.id,80,false)||ids.has(o.id)||!['ordered','received','cancelled'].includes(o.status)||!string(o.supplier_id,80,false)||!financeDate(o.placed_at)||!financeDate(o.due_at)||o.due_at<o.placed_at)bad('Проверьте идентификатор, поставщика, статус и даты заказа');ids.add(o.id);
  if(money(String(o.amount),'Сумма заказа')<=0)bad('Сумма заказа должна быть положительной');
  if(!Array.isArray(o.items)||o.items.length>500||o.items.some(i=>!object(i)||!string(i.name,150,false)||(i.code!==undefined&&!string(i.code,100))||typeof i.qty!=='number'||!Number.isFinite(i.qty)||i.qty<0||i.qty>999999.999))bad('Проверьте позиции исходного заказа');
  for(const [key,max]of [['supplier_name',150],['who',100],['note',500]])if(o[key]!==undefined&&!string(o[key],max))bad('Проверьте описание заказа');
 }
 for(const c of v.competitors||[])if(!string(c.id,80,false)||!string(c.name,150,false))bad('Проверьте магазин конкурента');
 for(const p of v.compPrices||[])if(!string(p.product_id,80,false)||!string(p.competitor_id,80,false)||!financeDate(p.observed_at)||money(String(p.price),'Цена конкурента')<=0)bad('Проверьте цену конкурента');
 if(v.unitCoef!==undefined&&(!object(v.unitCoef)||Object.entries(v.unitCoef).some(([key,n])=>!string(key,40,false)||['__proto__','prototype','constructor'].includes(key)||typeof n!=='number'||!Number.isFinite(n)||n<=0||n>1e6)))bad('Проверьте коэффициенты единиц');
 if(v.orderRules!==undefined&&v.orderRules!==null&&(!object(v.orderRules)||Object.entries(v.orderRules).some(([key,n])=>!['lead','cycle','safety'].includes(key)||typeof n!=='number'||!Number.isFinite(n)||n<0||n>3650)))bad('Проверьте правила заказа');
}
export function validateSourceProduct(p){
 if(!object(p))bad('Проверьте карточку');
 for(const [key,max]of [['barcodes',200],['photos',30]])if(p[key]!==undefined&&(!Array.isArray(p[key])||p[key].length>max||p[key].some(v=>!string(v,key==='photos'?40000:100,false))))bad('Проверьте '+key+' товара');
 for(const [key,max]of [['unit',20],['code',100],['article',100],['description',10000]])if(p[key]!==undefined&&!string(p[key],max))bad('Проверьте поле '+key);
 if(p.is_weighted!==undefined&&typeof p.is_weighted!=='boolean')bad('Проверьте признак весового товара');
 if(p.retail_price!==undefined&&(typeof p.retail_price!=='number'||!Number.isFinite(p.retail_price)))bad('Проверьте розничную цену');
}
