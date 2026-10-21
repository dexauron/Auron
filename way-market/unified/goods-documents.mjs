import {createHash} from 'node:crypto';
import {InputError} from './workspace/domain.mjs';
import {AccessError} from './workspace/access.mjs';
import {VersionError} from './workspace/workspace-store.mjs';
import {workspaceCatalogState} from './workspace/workspace-catalog.mjs';

export const DOCUMENT_TYPES={writeoff:'Списание',supplier_return:'Возврат поставщику'};
export const DOCUMENT_STATUSES={draft:'Черновик',submitted:'На проверке',approved:'Подтверждён',rejected:'На доработке',cancelled:'Отменён'};
const staff=['owner','administrator','accountant','cashier','employee'];
const manages=a=>['owner','administrator','accountant'].includes(a.role);
const fail=m=>{throw new InputError(m);};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const text=(v,label,max=200,blank=false)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x1f\ufffd\ud800-\udfff]/u.test(v)||(!blank&&!v.trim()))fail('Проверьте поле «'+label+'»');return v.trim();};
const exact=(p,keys)=>p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>keys.includes(k));
const hash=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const defaults=['Овощи и фрукты','Молочная продукция','Бакалея','Прочие товары'].map((name,i)=>({id:'default-'+i,name,active:true}));
function all(db,kind){const result=new Map();for(const r of db.prepare('SELECT sequence,subject_id,detail FROM account_events WHERE kind=? ORDER BY sequence').all('goods.'+kind))result.set(r.subject_id,{...JSON.parse(r.detail),version:r.sequence});return [...result.values()];}
function get(db,kind,id){const r=db.prepare('SELECT sequence,detail FROM account_events WHERE kind=? AND subject_id=? ORDER BY sequence DESC LIMIT 1').get('goods.'+kind,id);return r?{...JSON.parse(r.detail),version:r.sequence}:null;}
function put(audit,kind,id,value){if(Buffer.byteLength(JSON.stringify(value))>60000)fail('Документ слишком подробный: разделите его на части');audit('goods.'+kind,id,value);}
function articles(db){return get(db,'articles','directory')??{version:0,items:defaults};}
function accessible(actor,doc){if(!doc)fail('Документ не найден');if(!manages(actor)&&doc.authorId!==actor.id)throw new AccessError();return doc;}
function expected(old,p){if(!Number.isSafeInteger(p.expectedVersion)||p.expectedVersion<0||(old?.version??0)!==p.expectedVersion)throw new VersionError('Документ изменён. Откройте актуальную версию');}
function request(db,actor,audit,p,kind,fn){if(!uuid(p.requestId))fail('Нужен идентификатор команды');const digest=hash({actor:actor.id,kind,p}),old=get(db,'request',p.requestId);if(old){if(old.digest!==digest)throw new VersionError('Ключ повтора уже использован');return old.result;}const result=fn();put(audit,'request',p.requestId,{digest,result});return result;}
export function quantity(v,unit){
 if(typeof v!=='string'||!/^\d{1,6}(?:[.,]\d{1,3})?$/.test(v.trim()))fail('Количество: положительное число, не более трёх знаков после запятой');
 const [a,b='']=v.trim().replace(',','.').split('.'),m=BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));if(m<=0n||m>999999999n||unit==='шт'&&m%1000n)fail('Для штучного товара нужно целое количество; количество должно быть больше нуля');
 return {milli:Number(m),value:(m/1000n).toString()+(m%1000n?'.'+String(m%1000n).padStart(3,'0').replace(/0+$/,''):'')};
}
function date(v){if(typeof v!=='string'||!/^20\d\d-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Проверьте дату документа');return v;}
function sourceRefs(db){const refs=new Map();for(const r of db.prepare("SELECT subject_id,detail FROM account_events WHERE kind='onec.link' ORDER BY sequence").all())refs.set(r.subject_id,JSON.parse(r.detail));return [...refs.values()];}
function profiles(db){const m=new Map();for(const r of db.prepare("SELECT detail FROM account_events WHERE kind='onec.profile' ORDER BY sequence").all()){const p=JSON.parse(r.detail);m.set(p.sourceId,{sourceId:p.sourceId,name:p.name,release:p.release});}return [...m.values()];}
function validateDoc(db,p,old){
 if(!exact(p,['id','expectedVersion','requestId','type','date','warehouse','supplier','sourceId','note','lines'])||!uuid(p.id)||!Object.hasOwn(DOCUMENT_TYPES,p.type))fail('Неверный документ');
 if(old&&old.type!==p.type)fail('Нельзя менять вид сохранённого документа');
 const sourceId=text(p.sourceId??'','Источник 1С',64,true);if(sourceId&&!profiles(db).some(s=>s.sourceId===sourceId))fail('Источник 1С не найден');
 const supplier=text(p.supplier??'','Поставщик',150,p.type!=='supplier_return'),warehouse=text(p.warehouse,'Склад',100),note=text(p.note??'','Комментарий',500,true);
 if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>50)fail('Добавьте от 1 до 50 товаров');
 const catalog=new Map(workspaceCatalogState(db).products.filter(x=>x.active).map(x=>[x.id,x])),refs=sourceRefs(db),directory=articles(db).items,seen=new Set();
 const lines=p.lines.map((l,i)=>{
  if(!exact(l,['productId','quantity','articleId','reason','note'])||!uuid(l.productId)||seen.has(l.productId))fail('Один товар должен быть одной строкой; проверьте строку '+(i+1));seen.add(l.productId);
  const product=catalog.get(l.productId),article=directory.find(x=>x.id===l.articleId&&x.active);if(!product||!article)fail('Товар или статья недоступны, строка '+(i+1));
  const q=quantity(l.quantity,product.profile.unit),external=refs.find(x=>x.targetId===product.id&&x.sourceId===sourceId);
  return {productId:product.id,productVersion:product.version,name:product.name,unit:product.profile.unit,cashCode:product.profile.cashCode,articleCode:product.profile.article,barcode:product.profile.barcodes.find(x=>x.packageId===null)?.code??'',externalId:external?.externalId??'',quantity:q.value,quantityMilli:q.milli,articleId:article.id,article:article.name,reason:text(l.reason,'Причина в строке '+(i+1),150),note:text(l.note??'','Комментарий строки',300,true)};
 });
 return {type:p.type,date:date(p.date),warehouse,supplier,sourceId,note,lines};
}
function ready(doc){for(const l of doc.lines)if(!l.cashCode&&!l.articleCode&&!l.barcode&&!l.externalId)fail('У товара «'+l.name+'» нет кода, артикула или штрихкода для выгрузки. Дополните карточку и пересохраните документ');}
export function goodsDocuments(w){
 const command=(token,fn)=>w.accounts.command(token,'workspace.read',()=>({}),(db,a,audit,at)=>{if(!staff.includes(a.role))throw new AccessError();return fn(db,a,audit,at);});
 return {
  list(token){return command(token,(db,a)=>({canManage:manages(a),articles:articles(db),sources:profiles(db),documents:all(db,'document').filter(d=>manages(a)||d.authorId===a.id).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,200),limit:200,integration:{automaticSend:false,contractVersion:'way-market-goods/v1'}}));},
  get(token,id){return command(token,(db,a)=>accessible(a,get(db,'document',id)));},
  history(token,id){return command(token,(db,a)=>{accessible(a,get(db,'document',id));return db.prepare("SELECT sequence,actor_id,at_ms,detail FROM account_events WHERE kind='goods.document' AND subject_id=? ORDER BY sequence").all(id).map(r=>({...JSON.parse(r.detail),version:r.sequence,actorId:r.actor_id,at:r.at_ms}));});},
  products(token,q=''){return command(token,(db)=>{q=text(q,'Поиск',150,true).toLocaleLowerCase('ru').replace(/ё/g,'е');const words=q.split(/\s+/).filter(Boolean);const result=workspaceCatalogState(db).products.filter(p=>p.active&&words.every(t=>(p.name+' '+p.profile.cashCode+' '+p.profile.article+' '+p.profile.barcodes.map(b=>b.code).join(' ')).toLocaleLowerCase('ru').replace(/ё/g,'е').includes(t)));return {products:result.slice(0,30).map(p=>({id:p.id,name:p.name,unit:p.profile.unit,code:p.profile.cashCode,article:p.profile.article,barcode:p.profile.barcodes.find(b=>b.packageId===null)?.code??''})),hasMore:result.length>30};});},
  saveArticles(token,p){return command(token,(db,a,audit,at)=>{if(!manages(a))throw new AccessError();return request(db,a,audit,p,'articles',()=>{if(!exact(p,['expectedVersion','requestId','items'])||!Array.isArray(p.items)||!p.items.length||p.items.length>100)fail('Укажите от 1 до 100 статей');expected(articles(db),p);const ids=new Set(),names=new Set(),items=p.items.map(x=>{if(!exact(x,['id','name','active'])||typeof x.id!=='string'||!(/^(default-[0-3]|[a-f0-9-]{36})$/).test(x.id)||typeof x.active!=='boolean')fail('Проверьте статью');const name=text(x.name,'Статья',80),key=name.toLocaleLowerCase('ru');if(ids.has(x.id)||names.has(key))fail('Повтор статьи');ids.add(x.id);names.add(key);return {id:x.id,name,active:x.active};});if(articles(db).items.some(x=>!ids.has(x.id)))fail('Используйте отключение статьи вместо удаления');put(audit,'articles','directory',{items,updatedAt:at});return articles(db);});});},
  save(token,p){return command(token,(db,a,audit,at)=>request(db,a,audit,p,'save',()=>{const old=get(db,'document',p.id);if(old)accessible(a,old);expected(old,p);if(old&&!['draft','rejected'].includes(old.status))fail('Редактируется только черновик или документ на доработке');const value=validateDoc(db,p,old);put(audit,'document',p.id,{...value,id:p.id,number:old?.number??'WM-'+p.id.toUpperCase(),authorId:old?.authorId??a.id,authorName:old?.authorName??a.name,createdAt:old?.createdAt??at,updatedAt:at,editorName:a.name,status:'draft',lastAction:'saved',review:null});return get(db,'document',p.id);}));},
  transition(token,p){return command(token,(db,a,audit,at)=>request(db,a,audit,p,'transition',()=>{if(!exact(p,['id','expectedVersion','requestId','action','reason'])||!uuid(p.id))fail('Неверное действие');const old=accessible(a,get(db,'document',p.id));expected(old,p);const reason=text(p.reason??'','Комментарий проверки',500,true);let status;
   if(p.action==='submit'&&old.status==='draft'){ready(old);status='submitted';}
   else if(p.action==='approve'&&old.status==='submitted'&&manages(a)){ready(old);status='approved';}
   else if(p.action==='reject'&&old.status==='submitted'&&manages(a)){if(!reason)fail('Укажите причину доработки');status='rejected';}
   else if(p.action==='cancel'&&['draft','rejected','submitted'].includes(old.status)){if(!reason)fail('Укажите причину отмены');status='cancelled';}
   else throw new AccessError('Действие недоступно для этой роли или состояния');
   const {version,...doc}=old;put(audit,'document',p.id,{...doc,status,updatedAt:at,editorName:a.name,lastAction:p.action,review:{actorId:a.id,name:a.name,at,reason}});return get(db,'document',p.id);
  }));},
  export(token,id,version){return command(token,(db,a,audit,at)=>{const doc=accessible(a,get(db,'document',id));if(!Number.isSafeInteger(version)||doc.version!==version)throw new VersionError('Документ изменён. Обновите страницу перед выгрузкой');if(doc.status!=='approved')fail('Для выгрузки требуется подтверждённый документ');ready(doc);audit('goods.export.requested',id,{version,at});return {schema:'way-market-goods/v1',idempotencyKey:'goods:'+doc.id+':'+doc.version,document:doc,automaticSend:false};});}
 };
}
