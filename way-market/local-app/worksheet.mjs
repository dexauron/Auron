import {money,InputError} from './domain.mjs';
export const EXCEL_FIELDS=[
 ['cashReport','Наличка','cash','money'],['cashViaTerminal','Наличка через эквайринг','cash','money'],['suppliers','Выплата ТП','cash','money'],['payroll','Выплата ЗП','cash','money'],['lunch','Обед','cash','money'],['owner','Чеки владельца','cash','money'],['insertion','Внесение','cash','money'],['cashReturns','Возвраты','cash','money'],['cashCancelled','Аннулированные чеки','cash','count'],
 ['card','Оплата картой','bank','money'],['qr','QR','bank','money'],['bluetooth','Bluetooth','bank','money'],['bio','Био','bank','money'],['bankZ','Нефискальный отчёт','bank','money'],['bankReturns','Возвраты','bank','money'],['bankCancelled','Аннулированные чеки','bank','count'],
 ['received','Наличка фактическая','fact','money'],
 ['opening','Остаток на начало','extra','money'],['retained','Оставлено в кассе','extra','money'],['otherIn','Другие поступления','extra','money'],['previousTransfers','Передано ранее','extra','money'],['claimed','По подсчёту кассира','extra','money']
].map(([id,label,group,type])=>({id,label,group,type}));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const clean=(v,label,max=100)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw new InputError(`Заполните: ${label}`);return v.trim();};
export function defaultExcelSettings(){return {version:1,register:'Касса 1',cashBasis:'collection',cashReturns:'review',bankReturns:'review',ownerKind:'review',rows:EXCEL_FIELDS.map(f=>({id:f.id,label:f.label,visible:f.group!=='extra',enabled:f.group!=='extra'})),custom:[]};}
export function validateExcelSettings(raw){
 if(!exact(raw,['version','register','cashBasis','cashReturns','bankReturns','ownerKind','rows','custom'])||raw.version!==1||!['collection','sales'].includes(raw.cashBasis)||!['review','included','subtract','outside'].includes(raw.cashReturns)||!['review','included','subtract','outside'].includes(raw.bankReturns)||!['review','cash','goods-in-cash','goods-outside'].includes(raw.ownerKind)||!Array.isArray(raw.rows)||raw.rows.length!==EXCEL_FIELDS.length||!Array.isArray(raw.custom)||raw.custom.length>20)throw new InputError('Неверные настройки кассового листа');
 const ids=new Set();const rows=raw.rows.map(r=>{if(!exact(r,['id','label','visible','enabled'])||!EXCEL_FIELDS.some(f=>f.id===r.id)||ids.has(r.id)||typeof r.visible!=='boolean'||typeof r.enabled!=='boolean')throw new InputError('Проверьте строки кассового листа');ids.add(r.id);return {...r,label:clean(r.label,'название строки',80)};});
 const custom=raw.custom.map(r=>{if(!exact(r,['id','label','visible','enabled','kind'])||typeof r.id!=='string'||!/^custom-[a-f0-9-]{36}$/.test(r.id)||ids.has(r.id)||typeof r.visible!=='boolean'||typeof r.enabled!=='boolean'||!['cash-out','cash-in','goods-in-cash','reference'].includes(r.kind))throw new InputError('Проверьте дополнительную строку');ids.add(r.id);return {...r,label:clean(r.label,'дополнительная строка',80)};});
 return {version:1,register:clean(raw.register,'касса',50),cashBasis:raw.cashBasis,cashReturns:raw.cashReturns,bankReturns:raw.bankReturns,ownerKind:raw.ownerKind,rows,custom};
}
function count(v,label){if(v==='')return null;if(typeof v!=='string'||!/^\d{1,9}$/.test(v))throw new InputError(`${label}: нужно целое неотрицательное число`);return Number(v);}
const safe=(...values)=>{const n=values.reduce((s,v)=>s+BigInt(v),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n< -BigInt(Number.MAX_SAFE_INTEGER))throw new InputError('Сумма вне допустимого диапазона');return Number(n);};
export function evaluateExcel(raw){
 const settings=validateExcelSettings(raw?.worksheet?.settings);const data=raw.worksheet.values;
 if(!exact(data,[...EXCEL_FIELDS.map(f=>f.id),...settings.custom.map(f=>f.id)]))throw new InputError('Неверные поля кассового листа');
 const values={},errors=[];
 for(const row of [...settings.rows,...settings.custom]){const f=EXCEL_FIELDS.find(f=>f.id===row.id)??{type:'money'};try{if(!row.enabled){if(data[row.id]!==''&&(f.type==='count'?count(data[row.id],row.label):money(data[row.id],row.label))!==0)throw new InputError(`${row.label}: сумма не может быть отключена; обнулите после проверки или включите строку`);values[row.id]=['received','claimed'].includes(row.id)?null:0;}else if(f.type==='count')values[row.id]=count(data[row.id],row.label);else if(row.id==='received'||row.id==='claimed')values[row.id]=data[row.id]===''?null:money(data[row.id],row.label);else{if(data[row.id]==='')throw new InputError(`${row.label}: впишите сумму; если не было — 0`);values[row.id]=money(data[row.id],row.label);}}catch(e){values[row.id]=null;errors.push({field:row.id,message:e.message,...(data[row.id]===''?{missing:true}:{})});}}
 const rows=[...settings.rows,...settings.custom];const v=k=>values[k];
 const semantic=(field,policy,label)=>{if(v(field)>0&&policy==='review'){errors.push({field,setting:true,message:`${label}: укажите в настройках, как учитывать эту сумму`});return false;}return true;};
 const cashClear=semantic('cashReturns',settings.cashReturns,'Возвраты наличными')&&semantic('owner',settings.ownerKind,'Чеки владельца');
 const bankClear=semantic('bankReturns',settings.bankReturns,'Возвраты эквайринга');
 const cashIds=EXCEL_FIELDS.filter(f=>['cash','extra'].includes(f.group)&&f.id!=='claimed'&&f.type==='money').map(f=>f.id).concat(settings.custom.map(f=>f.id));
 let cashSales=null,cashPaid=null,goodsAdjustment=null,expected=null,actualSales=null,bankNet=null,bankDifference=null,totalSales=null,payouts=null;
 if(cashClear&&cashIds.every(k=>v(k)!==null)){
  cashSales=safe(v('cashReport'),v('cashViaTerminal'),settings.cashBasis==='collection'?-v('insertion'):0,settings.cashReturns==='subtract'?-v('cashReturns'):0);
  cashPaid=safe(v('suppliers'),v('payroll'),v('lunch'),settings.ownerKind==='cash'?v('owner'):0,...settings.custom.filter(r=>r.kind==='cash-out').map(r=>v(r.id)));
  goodsAdjustment=safe(settings.ownerKind==='goods-in-cash'?v('owner'):0,...settings.custom.filter(r=>r.kind==='goods-in-cash').map(r=>v(r.id)));
  const customIn=safe(...settings.custom.filter(r=>r.kind==='cash-in').map(r=>v(r.id)));
  payouts=safe(cashPaid,goodsAdjustment);
  expected=safe(cashSales,v('opening'),v('otherIn'),customIn,-cashPaid,-goodsAdjustment,-v('previousTransfers'),-v('retained'));
  if(v('received')!==null)actualSales=safe(v('received'),-v('opening'),-v('otherIn'),-customIn,cashPaid,goodsAdjustment,v('previousTransfers'),v('retained'));
 }
 if(bankClear&&['card','qr','bluetooth','bio','bankReturns'].every(k=>v(k)!==null)){bankNet=safe(v('card'),v('qr'),v('bluetooth'),v('bio'),settings.bankReturns==='subtract'?-v('bankReturns'):0);if(v('bankZ')!==null)bankDifference=safe(bankNet,-v('bankZ'));}
 // Overall sales use the cash-register noncash total, not a mismatching terminal total.
 if(cashSales!==null&&v('bankZ')!==null)totalSales=safe(cashSales,v('bankZ'));
 const difference=expected===null||v('received')===null?null:safe(v('received'),-expected);
 const hidden=rows.filter(r=>r.enabled&&!r.visible&&v(r.id)!==null&&v(r.id)!==0).map(r=>({id:r.id,label:r.label,value:v(r.id)}));
 return {settings,values,errors,cashSales,cashPaid,goodsAdjustment,payouts,expected,actualSales,bankNet,bankDifference,totalSales,difference,hidden};
}
export function reconcileExcel(raw){
 if(!exact(raw,['date','register','shiftNo','cashier','author','accountant','worksheet'])||!exact(raw.worksheet,['settings','values','counts','sourceNote'])||!exact(raw.worksheet.counts,['receipts','documents']))throw new InputError('Неверная структура кассового листа');
 const date=clean(raw.date,'дата',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new InputError('Укажите существующую дату');
 const register=clean(raw.register,'касса',50),shiftNo=clean(raw.shiftNo,'номер листа',50),cashier=clean(raw.cashier,'кассир'),author=clean(raw.author,'кто принимает кассу'),accountant=clean(raw.accountant,'кто принимает кассу');
 const r=evaluateExcel(raw);if(r.errors.length)throw new InputError(r.errors[0].message);if(register!==r.settings.register)throw new InputError('Касса не соответствует настройкам листа');
 const counts={receipts:count(raw.worksheet.counts.receipts,'Чеков за смену'),documents:count(raw.worksheet.counts.documents,'ФД за смену')};
 const sourceNote=typeof raw.worksheet.sourceNote==='string'&&raw.worksheet.sourceNote.length<=300&&!/[\x00-\x1f]/.test(raw.worksheet.sourceNote)?raw.worksheet.sourceNote:null;if(sourceNote===null)throw new InputError('Проверьте примечание к источникам');
 const n=r.values,received=n.received,claimed=r.settings.rows.find(x=>x.id==='claimed').enabled?n.claimed:null;
 return {date,register,shiftNo,cashier,author,accountant,amounts:{opening:n.opening,zCash:r.cashSales,otherIn:n.otherIn,retained:n.retained},payments:[],claimed,received,cashPaid:r.cashPaid,expected:r.expected,formulaVersion:'cash-excel-v1',claimedDifference:claimed===null?null:safe(claimed,-r.expected),receivedDifference:r.difference,transferDifference:claimed===null||received===null?null:safe(received,-claimed),counts,
 warnings:[...(r.expected<0?['Ожидаемая передача отрицательная. Проверьте источники и выплаты.']:[]),...(received===null?['Фактический пересчёт пока не внесён.']:[]),...(['cashReturns','bankReturns'].filter(k=>n[k]>0&&r.settings[k]==='outside').map(k=>`${k==='cashReturns'?'Наличные возвраты':'Возвраты эквайринга'}: по заявлению автора относятся к другому периоду и не вычтены.`))],
 nonCash:{mode:'aggregate',zNet:n.bankZ,reportNet:r.bankNet,difference:r.bankDifference,reportRef:sourceNote,periodConfirmed:false,formulaVersion:'noncash-excel-v1'},
 worksheet:{settings:r.settings,values:n,sourceNote,cashSales:r.cashSales,actualSales:r.actualSales,totalSales:r.totalSales,bankNet:r.bankNet,payouts:r.payouts,goodsAdjustment:r.goodsAdjustment,hidden:r.hidden}};
}
