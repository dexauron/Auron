import {createHash,randomUUID} from 'node:crypto';
import saxes from './vendor/node_modules/saxes/saxes.js';
import {InputError,money} from './workspace/domain.mjs';
import {VersionError} from './workspace/workspace-store.mjs';
import {defaultProductProfile} from './workspace/catalog-data.mjs';

export const CAPABILITIES=Object.freeze({filePreview:true,catalogApply:true,liveOData:false,httpService:false,documentWrite:false,posting:false});
export const LIMITS=Object.freeze({rows:50,files:3,fileBytes:48000,eventBytes:60000});
const fail=s=>{throw new InputError(s);};
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,label,max=150,optional=false)=>{if(typeof x!=='string'||x.length>max||/[\x00-\x1f\ufffd]/.test(x)||(!optional&&!x.trim()))fail('Проверьте '+label);return x.trim();};
const priceString=n=>`${Math.floor(n/100)}.${String(n%100).padStart(2,'0')}`;
const unit=x=>({'шт.':'шт','Штука':'шт','штука':'шт','Килограмм':'кг','килограмм':'кг','Литр':'л','литр':'л','Метр':'м','метр':'м'})[x]??x;
const rub=x=>typeof x==='string'&&['RUB','РУБ','РУБ.','643'].includes(x.trim().toUpperCase());
function record(db,kind,id){const r=db.prepare('SELECT sequence,detail FROM account_events WHERE kind=? AND subject_id=? ORDER BY sequence DESC LIMIT 1').get('onec.'+kind,id);return r?{...JSON.parse(r.detail),version:r.sequence}:null;}
function records(db,kind){const m=new Map();for(const r of db.prepare('SELECT sequence,subject_id,detail FROM account_events WHERE kind=? ORDER BY sequence').all('onec.'+kind))m.set(r.subject_id,{...JSON.parse(r.detail),version:r.sequence});return [...m.values()];}
function put(audit,kind,id,value){if(Buffer.byteLength(JSON.stringify(value))>LIMITS.eventBytes)fail('Пакет слишком подробный: разделите его на меньшие части');audit('onec.'+kind,id,value);}
const key=(source,id)=>hash([source,'product',id]);

export function validateProfile(p){
 if(!object(p)||Object.keys(p).some(k=>!['id','expectedVersion','sourceId','name','configuration','release','format','currency','columns','separator','priceType'].includes(k)))fail('Неверный профиль обмена');
 if(!uuid(p.id)||!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<0)fail('Неверная версия профиля');
 const sourceId=text(p.sourceId,'идентификатор базы',64);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(sourceId))fail('Идентификатор базы: 3–64 латинских символа, цифры, _ или -');
 if(!['ut','unf','shtrih','other'].includes(p.configuration)||!['json','csv','commerceml'].includes(p.format)||p.currency!=='RUB')fail('Выберите конфигурацию, формат и рублёвую валюту');
 if(![';',',','\t'].includes(p.separator)||!object(p.columns))fail('Проверьте разделитель и карту столбцов');
 const fields=['externalId','name','price','unit','code','article','barcodes','currency'];if(Object.keys(p.columns).some(k=>!fields.includes(k)))fail('Неизвестное поле сопоставления');
 const columns=Object.fromEntries(fields.map(k=>[k,text(p.columns[k]??'',k,100,!['externalId','name','price','unit'].includes(k))]));
 const used=Object.values(columns).filter(Boolean);if(new Set(used).size!==used.length||used.some(v=>['__proto__','prototype','constructor'].includes(v)))fail('Повторное или недопустимое имя столбца');
 return {id:p.id,sourceId,name:text(p.name,'название'),configuration:p.configuration,release:text(p.release,'релиз',100),format:p.format,currency:'RUB',separator:p.separator,columns,priceType:text(p.priceType??'','вид цены',150,true)};
}

export function parseCSV(s,separator){
 let row=[],cell='',quoted=false,closed=false;const rows=[];
 const cellEnd=()=>{row.push(cell);cell='';closed=false;if(row.length>50)fail('Слишком много столбцов');};
 const rowEnd=()=>{cellEnd();if(row.some(x=>x!==''))rows.push(row);row=[];if(rows.length>LIMITS.rows+1)fail('Не более 50 товаров в пакете');};
 for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(c==='"'){if(s[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(closed&&![separator,'\n','\r'].includes(c))fail('Лишние символы после кавычек CSV');
  if(c==='"'){if(cell||closed)fail('Неверные кавычки CSV');quoted=true;}else if(c===separator)cellEnd();else if(c==='\r'||c==='\n'){if(c==='\r'&&s[i+1]==='\n')i++;rowEnd();}else cell+=c;
 }
 if(quoted)fail('Не закрыты кавычки CSV');if(cell||row.length||closed)rowEnd();if(rows.length<2)fail('Нужны заголовки и товары');
 const headings=rows.shift().map(x=>x.trim());if(headings.some(x=>!x)||new Set(headings).size!==headings.length)fail('Пустые или повторные заголовки CSV');
 return rows.map((r,i)=>{if(r.length!==headings.length)fail('Число ячеек не совпадает, строка '+(i+2));return Object.fromEntries(headings.map((h,j)=>[h,r[j]]));});
}

function xmlTree(s){
 const parser=new saxes.SaxesParser({xmlns:true}),stack=[];let root,nodes=0;
 parser.on('doctype',()=>fail('DOCTYPE и внешние сущности запрещены'));parser.on('error',()=>fail('Повреждённый XML или неизвестная сущность'));
 parser.on('opentag',t=>{if(++nodes>10000||stack.length>=32)fail('Превышена сложность XML');if(root&&t.uri!==root.uri)fail('Смешанные пространства имён XML не поддерживаются');const n={name:t.local,uri:t.uri,attrs:Object.fromEntries(Object.values(t.attributes).map(a=>[a.local,a.value])),text:'',children:[]};if(stack.length)stack.at(-1).children.push(n);else root=n;stack.push(n);});
 const append=s=>{if(stack.length)stack.at(-1).text+=s;};parser.on('text',append);parser.on('cdata',append);parser.on('closetag',()=>stack.pop());parser.write(s).close();return root;
}
const many=(n,k)=>n?.children.filter(c=>c.name===k)??[];
function one(n,k){const a=many(n,k);if(a.length>1)fail('Повторное поле XML: '+k);return a[0];}
const val=(n,k)=>one(n,k)?.text.trim()??'';
function commerceFiles(files,p){
 const products=[],offers=[],types=new Map();
 for(const file of files){const root=xmlTree(file.text);
  if(root?.name!=='КоммерческаяИнформация')fail(root?.name==='MetaDataObject'?'Это метаданные, а не выгрузка товаров':'Требуется CommerceML');
  if(!/^2\.(?:0\d|10)$/.test(root.attrs.ВерсияСхемы??''))fail('Поддерживается ограниченный CommerceML 2.0x/2.10');
  if(root.uri&&!['urn:1C.ru:commerceml_2','urn:1C.ru:commerceml_210'].includes(root.uri))fail('Неизвестный namespace CommerceML');
  for(const catalog of many(root,'Каталог')){const catalogId=val(catalog,'Ид');if(!catalogId)fail('Не указан ИД каталога');
   for(const item of many(one(catalog,'Товары'),'Товар')){
    if(one(item,'ХарактеристикиТовара')||['true','1'].includes(val(item,'ПометкаУдаления'))||['true','1'].includes(val(item,'ЭтоГруппа')))fail('Варианты, группы и удаления требуют отдельного профиля');
    if(val(item,'ИдКаталога')&&val(item,'ИдКаталога')!==catalogId)fail('Товар относится к другому каталогу');
    const u=one(item,'БазоваяЕдиница');products.push({externalId:val(item,'Ид'),catalogId,name:val(item,'Наименование'),article:val(item,'Артикул'),unit:u?.attrs.НаименованиеПолное||u?.text.trim()||'',barcodes:many(item,'Штрихкод').map(n=>n.text.trim()),price:'',currency:'RUB'});
   }
  }
  for(const pack of many(root,'ПакетПредложений')){const catalogId=val(pack,'ИдКаталога');if(!catalogId)fail('Не указан ИД каталога предложений');
   for(const t of many(one(pack,'ТипыЦен'),'ТипЦены')){const id=val(t,'Ид'),tax=one(t,'Налог'),data={currency:val(t,'Валюта'),tax:tax?val(tax,'УчтеноВСумме'):'none'};if(types.has(id)&&JSON.stringify(types.get(id))!==JSON.stringify(data))fail('Противоречивые условия вида цены');types.set(id,data);}
   for(const o of many(one(pack,'Предложения'),'Предложение'))offers.push({id:val(o,'Ид'),catalogId,prices:many(one(o,'Цены'),'Цена')});
  }
 }
 if(new Set(products.map(r=>r.catalogId)).size>1)fail('Один каталог на пакет');const ids=new Set(products.map(r=>r.externalId)),seen=new Set();
 for(const o of offers){if(seen.has(o.id)||!ids.has(o.id))fail('Повтор предложения, вариант или предложение без товара');seen.add(o.id);}
 for(const item of products){const offer=offers.find(o=>o.id===item.externalId);if(!offer)continue;if(offer.catalogId!==item.catalogId)fail('Предложения относятся к другому каталогу');
  const prices=offer.prices.filter(v=>p.priceType&&val(v,'ИдТипаЦены')===p.priceType);if(prices.length>1)fail('Повтор выбранного вида цены');if(!prices.length)continue;
  const price=prices[0],type=types.get(p.priceType),currency=val(price,'Валюта')||type?.currency;
  if(!currency)fail('Валюта выбранной цены неизвестна');if(!rub(currency))fail('Поддерживаются только рублёвые цены');
  if(type&&!['none','true','1'].includes(type.tax))fail('Налог не включён в цену или правило неизвестно');
  const known=['ИдТипаЦены','ЦенаЗаЕдиницу','Валюта','Единица','Коэффициент','МинКоличество','ИдКаталога','Представление'];
  if(price.children.some(c=>!known.includes(c.name)))fail('Неподдержанные условия цены');
  if(val(price,'МинКоличество')&&!/^0([.,]0+)?$/.test(val(price,'МинКоличество')))fail('Цена зависит от минимального количества');
  if(val(price,'Коэффициент')&&!/^1([.,]0+)?$/.test(val(price,'Коэффициент')))fail('Требуется пересчёт упаковок');
  if(val(price,'ИдКаталога')&&val(price,'ИдКаталога')!==item.catalogId)fail('Цена относится к другому каталогу');
  if(val(price,'Единица')&&unit(val(price,'Единица'))!==unit(item.unit))fail('Единица цены отличается от товара');
  item.price=val(price,'ЦенаЗаЕдиницу');
 }
 return {raw:products,priceTypes:[...new Set([...types.keys(),...offers.flatMap(o=>o.prices.map(r=>val(r,'ИдТипаЦены')))])]};
}

export function parseFiles(p,input){
 if(!Array.isArray(input)||input.length<1||input.length>LIMITS.files)fail('От 1 до 3 файлов');
 const files=input.map(f=>{if(!object(f)||typeof f.text!=='string'||Buffer.byteLength(f.text)>LIMITS.fileBytes||/[\0\ufffd]/.test(f.text))fail('Файл повреждён либо больше 48 000 байт UTF-8');return {name:text(f.name,'имя файла'),text:f.text.replace(/^\ufeff/,''),encoding:text(f.encoding??'utf-8','кодировку',30)};});
 let raw,priceTypes=[];
 if(p.format==='commerceml')({raw,priceTypes}=commerceFiles(files,p));
 else{if(files.length!==1)fail('Для CSV/JSON выберите один файл');if(p.format==='csv')raw=parseCSV(files[0].text,p.separator);else{let v;try{v=JSON.parse(files[0].text);}catch{fail('Неверный JSON');}if(Array.isArray(v))raw=v;else if(object(v)&&Array.isArray(v.products)&&Object.keys(v).every(k=>k==='products'||k==='currency')){if(v.currency!==undefined&&!rub(v.currency))fail('Поддерживаются только рублёвые цены');raw=v.products;}else fail('JSON: массив товаров или объект products');}}
 if(!raw.length||raw.length>LIMITS.rows)fail('От 1 до 50 товаров');const ids=new Set(),bars=new Set();
 const rows=raw.map((item,index)=>{const errors=[];let row={row:index+1};try{
  if(!object(item))fail('Строка должна быть объектом');const get=k=>p.format==='commerceml'?item[k]:p.columns[k]&&Object.hasOwn(item,p.columns[k])?item[p.columns[k]]:undefined;
  const externalId=text(get('externalId'),'внешний ИД',120),name=text(get('name'),'наименование');if(ids.has(externalId))fail('Повтор внешнего ИД');ids.add(externalId);
  const rawPrice=get('price');if(typeof rawPrice!=='string'||!rawPrice.trim())fail('Цена неизвестна: нужна десятичная строка');const priceMinor=money(rawPrice,'Цена');
  const currency=get('currency');if(currency!==undefined&&!rub(currency))fail('Поддерживаются только рублёвые цены');for(const k of ['currency','Currency','Валюта'])if(Object.hasOwn(item,k)&&!rub(item[k]))fail('Поддерживаются только рублёвые цены');
  const rawUnit=text(get('unit'),'единицу',30),u=unit(rawUnit);if(!['шт','кг','л','м'].includes(u))fail('Поддерживаются шт/кг/л/м; упаковки требуют пересчёта');
  let barcodes=get('barcodes')??[];if(typeof barcodes==='string')barcodes=barcodes?barcodes.split('|'):[];
  if(!Array.isArray(barcodes)||barcodes.length>20||barcodes.some(b=>typeof b!=='string'||!/^\d{1,32}$/.test(b))||new Set(barcodes).size!==barcodes.length)fail('Неверные штрихкоды');
  if(barcodes.some(b=>bars.has(b)))fail('Штрихкод повторяется у разных строк пакета');for(const b of barcodes)bars.add(b);
  row={...row,externalId,name,rawName:get('name'),price:priceString(priceMinor),priceMinor,unit:u,rawUnit,barcodes,code:text(get('code')??'','кассовый код',40,true),article:text(get('article')??'','артикул',60,true)};
 }catch(e){if(!(e instanceof InputError))throw e;errors.push(e.message);}return {...row,errors};});
 return {rows,priceTypes,files:files.map(f=>({name:f.name,encoding:f.encoding,textSha256:hash(f.text)})),warnings:p.format==='commerceml'?['Ограниченный разбор каталога и выбранной цены; остатки и документы не переносятся, полная XSD-валидация не выполняется.']:[]};
}

export function onecExchange(w){
 const run=(token,fn)=>w.accounts.command(token,'accounts.manage',()=>({}),(db,actor,audit,at)=>fn(db,actor,audit,at));
 const request=(db,actor,audit,p,kind,fn)=>{if(!uuid(p.requestId))fail('Нужен идентификатор команды');const digest=hash({actor:actor.id,kind,p}),old=record(db,'request',p.requestId);if(old){if(old.digest!==digest)throw new VersionError('Ключ повтора уже использован');return old.result;}const result=fn();put(audit,'request',p.requestId,{digest,result});return result;};
 return {
  state(token){return run(token,db=>({capabilities:CAPABILITIES,limits:LIMITS,profiles:records(db,'profile'),stages:records(db,'stage').slice(-20).reverse().map(s=>({id:s.id,profileId:s.profileId,profileName:s.profileName,at:s.at,rows:s.rows.length,errors:s.rows.filter(r=>r.errors.length).length,applied:!!record(db,'applied',s.id)}))}));},
  saveProfile(token,p){return run(token,(db,actor,audit)=>{const value=validateProfile(p),old=record(db,'profile',value.id);if((old?.version??0)!==p.expectedVersion)throw new VersionError('Профиль изменён');if(old&&old.sourceId!==value.sourceId)fail('Идентификатор базы неизменяем');if(records(db,'profile').some(v=>v.id!==value.id&&v.sourceId===value.sourceId))fail('Идентификатор базы уже используется');put(audit,'profile',value.id,value);return record(db,'profile',value.id);});},
  preview(token,p){return run(token,(db,actor,audit,at)=>request(db,actor,audit,p,'preview',()=>{const profile=record(db,'profile',p.profileId);if(!profile||profile.version!==p.expectedVersion)throw new VersionError('Профиль изменён');const parsed=parseFiles(profile,p.files),catalog=w.catalog(token,{all:true}).products;
   const rows=parsed.rows.map(r=>{if(r.errors.length)return r;const link=record(db,'link',key(profile.sourceId,r.externalId)),linked=catalog.find(x=>x.id===link?.targetId&&x.active);
   // A confirmed link is never reassigned silently, so show blocking cases here instead of failing at apply.
   if(link&&!linked)return {...r,linkedTargetId:link.targetId,candidates:[],errors:['Связанная карточка снята с продажи. Верните её в продажу и повторите проверку']};
   if(linked&&linked.profile.unit!==r.unit)return {...r,linkedTargetId:link.targetId,candidates:[],errors:['Единица в 1С ('+r.unit+') отличается от карточки ('+linked.profile.unit+'); базовую единицу товара менять нельзя']};
   const others=catalog.filter(x=>x.active&&x.id!==linked?.id&&(x.name===r.name||r.barcodes.some(b=>b===x.barcode||x.profile.barcodes.some(v=>v.code===b))));return {...r,linkedTargetId:link?.targetId??null,candidates:[...(linked?[linked]:[]),...others].slice(0,6).map(x=>({id:x.id,name:x.name,version:x.version,unit:x.profile.unit,priceMinor:x.price}))};});
   const id=randomUUID(),stage={id,profileId:profile.id,profileName:profile.name,profileVersion:profile.version,sourceId:profile.sourceId,at,...parsed,rows};put(audit,'stage',id,stage);return stage;}));},
  stage(token,id){return run(token,db=>{if(!uuid(id))fail('Неверный пакет');const stage=record(db,'stage',id);if(!stage)fail('Пакет не найден');return {...stage,applied:record(db,'applied',id)};});},
  apply(token,p){return run(token,(db,actor,audit,at)=>request(db,actor,audit,p,'apply',()=>{
   const s=record(db,'stage',p.stageId);if(!s)fail('Пакет не найден');const done=record(db,'applied',s.id);if(done)return done.result;
   if(record(db,'profile',s.profileId)?.version!==s.profileVersion)throw new VersionError('Профиль изменён: проверьте пакет заново');
   if(p.confirmed!==true||s.rows.some(r=>r.errors.length))fail('Подтвердите пакет без ошибок');
   if(!Array.isArray(p.decisions)||p.decisions.length!==s.rows.length)fail('Нужны действия для всех строк');const decisions=new Map();
   for(const d of p.decisions){if(!object(d)||typeof d.externalId!=='string'||(!uuid(d.targetId)&&d.targetId!==null)||decisions.has(d.externalId))fail('Неверные соответствия');decisions.set(d.externalId,d.targetId);}
   const used=new Set(),result={stageId:s.id,changed:[]};
   for(const r of s.rows){if(!decisions.has(r.externalId))fail('Не выбрано соответствие');const link=record(db,'link',key(s.sourceId,r.externalId));if((link?.targetId??null)!==(r.linkedTargetId??null))throw new VersionError('Соответствие изменилось: проверьте пакет заново');
    let id=decisions.get(r.externalId),old=null;if(r.linkedTargetId&&id!==r.linkedTargetId)fail('Нельзя незаметно переназначить подтверждённую связь');
    if(id){const expected=r.candidates.find(c=>c.id===id);old=db.prepare('SELECT * FROM workspace_products WHERE id=?').get(id);if(!expected||!old||!old.active||old.version!==expected.version)throw new VersionError('Карточка изменена: новый предпросмотр');}else id=randomUUID();
    if(used.has(id)||records(db,'link').some(l=>l.sourceId===s.sourceId&&l.targetId===id&&l.externalId!==r.externalId))fail('Разные внешние товары нельзя слить в одну карточку');used.add(id);
    const current=old?w.catalog(token,{all:true}).products.find(x=>x.id===id):null,profile=structuredClone(current?.profile??defaultProductProfile());
    if(old&&profile.unit!==r.unit)fail('Нельзя менять базовую единицу существующего товара');profile.unit=r.unit;if(r.code)profile.cashCode=r.code;if(r.article)profile.article=r.article;
    if(r.barcodes.length)profile.barcodes=r.barcodes.map(code=>profile.barcodes.find(b=>b.code===code)??{code,packageId:null});
    const product=w.productSave(token,{requestId:randomUUID(),expectedVersion:old?.version??0,...(old?{id}:{createId:id}),name:r.name,barcode:profile.barcodes[0]?.code??'',price:r.price,active:true,profile,reason:old?'Проверенный пакет 1С '+s.id:''});
    const extra=db.prepare("SELECT detail FROM account_events WHERE kind='unified.product' AND subject_id=? ORDER BY sequence DESC LIMIT 1").get(id),value={...(extra?JSON.parse(extra.detail).value:{}),code:profile.cashCode,article:profile.article,unit:profile.unit,barcodes:profile.barcodes.map(b=>b.code)};delete value._version;audit('unified.product',id,{value});
    put(audit,'link',key(s.sourceId,r.externalId),{sourceId:s.sourceId,externalId:r.externalId,targetId:id});result.changed.push({externalId:r.externalId,id,version:product.version});
   }
   put(audit,'applied',s.id,{at,result});return result;
  }));}
 };
}
