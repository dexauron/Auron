import {newRequestId} from '/request-id.mjs';
export async function onecPage(ctx){
 const {api,node,button,surface,modal,formSubmit,rub,onDirty=()=>{}}=ctx,state=await api('/api/unified/1c'),root=node('div');
 const intro=surface('Обмен с 1С');intro.append(node('p','Проверьте небольшой пакет товаров, выберите соответствия и перенесите его в каталог Way Market.'));
 intro.append(node('p','Профиль УТ, УНФ или Штрих-М описывает источник выгрузки. Подключение к работающей базе, передача документов и проведение в 1С ещё не включены.','fine'));root.append(intro);
 const input=(f,label,name,value='',type='text')=>{const l=node('label'),e=node('input');l.append(node('span',label),e);e.name=name;e.type=type;if(type!=='file')e.value=value;f.append(l);return e;};
 const select=(f,label,name,choices,value)=>{const l=node('label'),e=node('select');l.append(node('span',label),e);e.name=name;for(const [v,t]of choices){const o=node('option',t);o.value=v;e.append(o);}if(value!==undefined)e.value=value;f.append(l);return e;};
 const edit=p=>{const f=node('form');f.className='onec-form';const id=p?.id??newRequestId();
  for(const [k,t,v]of [['name','Название подключения','Основная база магазина'],['sourceId','Постоянный идентификатор базы','store-main'],['release','Точное название и релиз конфигурации','']]){const e=input(f,t,k,p?.[k]??v);e.required=true;e.maxLength=k==='sourceId'?64:100;if(k==='sourceId'&&p)e.readOnly=true;}
  select(f,'Конфигурация','configuration',[['ut','Управление торговлей'],['unf','Управление нашей фирмой'],['shtrih','Штрих-М'],['other','Другая 1С']],p?.configuration??'shtrih');
  select(f,'Формат','format',[['csv','CSV с заголовками'],['json','JSON'],['commerceml','CommerceML 2: каталог и предложения']],p?.format??'csv');
  select(f,'Валюта цен','currency',[['RUB','Российские рубли; без конвертации']],'RUB');
  select(f,'Разделитель CSV','separator',[[';','Точка с запятой'],[',','Запятая'],['\t','Табуляция']],p?.separator??';');
  f.append(node('p','Для CSV и JSON укажите исходные имена полей. Цена — за базовую единицу, в рублях. Упаковки сначала нужно пересчитать. В CommerceML используются поля стандарта.','fine'));
  const columns={externalId:['Внешний ИД','Ид'],name:['Название','Наименование'],price:['Розничная цена','Цена'],unit:['Базовая единица','Единица'],code:['Кассовый код','КодККМ'],article:['Артикул','Артикул'],barcodes:['Штрихкоды через |','Штрихкод'],currency:['Валюта — если есть отдельное поле','']};
  for(const [k,[title,value]]of Object.entries(columns)){const e=input(f,title+' — имя поля','column-'+k,p?.columns[k]??value);e.maxLength=100;e.required=['externalId','name','price','unit'].includes(k);}
  input(f,'Идентификатор вида цены CommerceML','priceType',p?.priceType??'');
  formSubmit(f,'Сохранить профиль',async()=>{const data=Object.fromEntries(new FormData(f));await api('/api/unified/1c/profile',{id,expectedVersion:p?.version??0,name:data.name,sourceId:data.sourceId,release:data.release,configuration:data.configuration,format:data.format,currency:data.currency,separator:data.separator,columns:Object.fromEntries(Object.keys(columns).map(k=>[k,data['column-'+k]])),priceType:data.priceType});document.getElementById('modal').close();onDirty(false);root.replaceChildren(await onecPage(ctx));});modal(p?'Профиль обмена':'Новый профиль',f);
 };
 const controls=surface('Источник'),f=node('form');f.className='onec-form';controls.append(button('Новый профиль',()=>edit(null)));
 const selected=select(f,'Профиль','profileId',state.profiles.map(p=>[p.id,p.name+' · '+p.release]));if(state.profiles.length)controls.append(button('Изменить профиль',()=>edit(state.profiles.find(p=>p.id===selected.value))));
 const encoding=select(f,'Кодировка','encoding',[['utf-8','UTF-8'],['windows-1251','Windows-1251'],['ibm866','DOS CP866']],'utf-8');
 const files=input(f,'До 3 файлов по 48 000 байт, всего до 50 товаров','files','','file');files.multiple=true;files.accept='.csv,.json,.xml';
 let previewId=newRequestId();const dirty=()=>{previewId=newRequestId();onDirty(true);};for(const e of [files,encoding,selected])e.addEventListener('change',dirty);
 const output=surface('Предпросмотр'),history=surface('Последние пакеты');
 const show=s=>{
  output.replaceChildren(node('h2',s.applied?'Пакет применён':'Проверьте товары'),node('p',s.profileName+' · '+s.rows.length+' строк'));
  for(const w of s.warnings)output.append(node('p',w,'fine'));if(s.priceTypes.length)output.append(node('p','Виды цен: '+s.priceTypes.join(', '),'fine'));
  const form=node('form'),choices=[];output.append(form);
  for(const r of s.rows){const box=node('div',null,'onec-row');box.append(node('h3',r.row+'. '+(r.name??'Ошибка строки')),node('p',(r.externalId??'—')+' · '+(r.priceMinor===undefined?'Цена неизвестна':rub(r.priceMinor))+' / '+(r.unit??'—')+' · код '+(r.code||'—')));form.append(box);
   for(const err of r.errors)box.append(node('p',err,'error'));
   if(!s.applied&&!r.errors.length){const target=select(box,'Соответствие','target-'+r.row,[['','Выберите действие'],['NEW','Создать отдельный товар'],...r.candidates.map(c=>[c.id,'Обновить: '+c.name+' · '+rub(c.priceMinor)+' / '+c.unit])],r.linkedTargetId??'');if(r.linkedTargetId)target.disabled=true;target.addEventListener('change',()=>onDirty(true));choices.push({row:r,target});box.append(node('p','Совпадение имени или штрихкода — предложение, а не доказательство. Проверьте товар и фасовку.','fine'));}
  }
  if(s.applied){output.append(node('p','Сохранено товаров: '+s.applied.result.changed.length+'. Повтор не создаёт новых карточек.'));return;}
  if(s.rows.some(r=>r.errors.length)){output.append(node('p','Исправьте файл или профиль и выполните новый предпросмотр. Пакет с ошибками применить нельзя.','error'));return;}
  const confirm=input(form,'Соответствия, розничные цены и базовые единицы проверены','confirmed','','checkbox');confirm.required=true;const requestId=newRequestId();
  formSubmit(form,'Применить к каталогу Way Market',async()=>{if(!confirm.checked||choices.some(c=>!c.target.value))throw Error('Выберите действие для всех строк и подтвердите проверку');await api('/api/unified/1c/apply',{requestId,stageId:s.id,confirmed:true,decisions:choices.map(c=>({externalId:c.row.externalId,targetId:c.target.value==='NEW'?null:c.target.value}))});onDirty(false);show(await api('/api/unified/1c/stages/'+s.id));});
 };
 formSubmit(f,'Проверить файлы',async()=>{const profile=state.profiles.find(p=>p.id===selected.value);if(!profile)throw Error('Сначала создайте профиль');if(files.files.length<1||files.files.length>3)throw Error('Выберите от 1 до 3 файлов');const decoded=[];
  for(const file of files.files){if(file.size>48000)throw Error('Файл больше 48 000 байт');let text;try{text=new TextDecoder(encoding.value,{fatal:true}).decode(await file.arrayBuffer());}catch{throw Error('Не удалось прочитать файл: проверьте кодировку');}decoded.push({name:file.name,encoding:encoding.value,text});}
  show(await api('/api/unified/1c/preview',{requestId:previewId,profileId:profile.id,expectedVersion:profile.version,files:decoded}));previewId=newRequestId();onDirty(false);
 });controls.append(f);root.append(controls,output,history);
 for(const s of state.stages){const box=node('div',null,'onec-row'),error=node('p','','error');box.append(node('p',s.profileName+' · '+new Date(s.at).toLocaleString('ru-RU')+' · '+s.rows+' строк · '+(s.applied?'применён':s.errors?'есть ошибки':'проверен')),button('Открыть пакет',async()=>{try{show(await api('/api/unified/1c/stages/'+s.id));}catch(e){error.textContent=e.message;}}),error);history.append(box);}
 return root;
}
