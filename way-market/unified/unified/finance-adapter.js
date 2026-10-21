(() => {
 let user=null,identity=null,csrf='',versions=new Map(),balances=new Map(),uncertain=new Map();
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,options)=>{
  const response=await nativeFetch(input,options);
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
  if(url.origin===location.origin&&url.pathname.startsWith('/integration/rest/v1/')&&response.ok){try{const list=await response.clone().json();if(Array.isArray(list))for(const row of list){if(row.id&&row._version)versions.set(row.id,row._version);if(row.id&&Number.isSafeInteger(row.balance_kopecks))balances.set(row.id,row.balance_kopecks);}}catch{}}
  if(response.status===401&&url.origin===location.origin){location.replace('/');}
  return response;
 };
 async function session(){
  const r=await nativeFetch('/api/session',{cache:'no-store'});
  if(!r.ok)throw Error('Не удалось проверить вход. Сохранение не выполнено.');
  const s=await r.json();
  if(!s.user){user=null;location.replace('/');throw Error('Войдите в аккаунт');}
  if(identity&&(identity.id!==s.user.id||identity.version!==s.user.version)){user=null;location.replace('/');throw Error('Аккаунт изменился в другой вкладке. Обновите страницу перед сохранением.');}
  identity=identity||{id:s.user.id,version:s.user.version};csrf=s.csrf;user=s.user;return s;
 }
 function exactKopecks(value){
  if(typeof value!=='number'||!Number.isFinite(value))return value;
  const rounded=Math.round(value);
  return Number.isSafeInteger(rounded)&&Math.abs(value-rounded)<=Math.max(1,Math.abs(value))*Number.EPSILON*4?rounded:value;
 }
 function normalizeMoney(data){const out={...data};for(const key of ['amountKopecks','zCash','zCard','zSbp','factCash','factCard','factSbp'])if(Object.hasOwn(out,key))out[key]=exactKopecks(out[key]);if(Array.isArray(out.withdrawals))out.withdrawals=out.withdrawals.map(row=>({...row,amount:exactKopecks(row.amount)}));return out;}
 function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['clientUuid','_requestId'].includes(k)).map(k=>[k,canonical(value[k])]));return value;}
 function pendingKey(method,orgId,data){const copy={...data};delete copy.expectedBalance;return JSON.stringify([identity,method,orgId,canonical(copy)]);}
 async function queueCall(action,payload){
  const r=await nativeFetch('/api/unified/commands'+(action?'/'+action:''),action?{method:'POST',headers:{'Content-Type':'application/json','X-Way-Token':csrf,'X-Way-Account':user.id},body:JSON.stringify(payload)}:{cache:'no-store'});
  const out=await r.json();if(!r.ok){const error=Error(out.error||'Результат операции не подтверждён');error.definite=r.status>=400&&r.status<500;throw error;}return out;
 }
 let pendingNotice=null,queueError=null;
 function showPending(){
  if(typeof document==='undefined'||!document.body)return;
  if(pendingNotice)pendingNotice.remove();pendingNotice=null;
  const entry=[...uncertain.entries()].find(([,p])=>!p.promise);if(!entry){if(queueError){const notice=document.createElement('section');notice.className='wm-command-notice';notice.setAttribute('role','status');const message=document.createElement('p');message.textContent='Не удалось сверить неподтверждённые операции. Вход сохранён; новые финансовые записи пока недоступны.';const retry=document.createElement('button');retry.textContent='Проверить ещё раз';retry.onclick=async()=>{try{await session();await loadPending();}catch(error){message.textContent=error.message;}};notice.append(message,retry);document.body.append(notice);pendingNotice=notice;}return;}
  const [key,pending]=entry,p=JSON.parse(pending.body),data=p.data||{},labels={saveShift:'Закрытие смены',saveTransaction:data.type==='income'?'Поступление':'Списание',saveTransfer:'Перевод',saveDebtEntry:'Запись по долгу',adjustBalance:'Корректировка остатка'};
  const notice=document.createElement('section');notice.className='wm-command-notice';notice.setAttribute('role','status');
  const title=document.createElement('strong');title.textContent=labels[p.method]||'Сохранение изменений';notice.append(title);
  const description=document.createElement('p');description.textContent=pending.stale?'Права аккаунта изменились. Прежняя команда не будет повторена. Проверьте журнал и закройте уведомление.':pending.status==='completed'?'Сервер уже выполнил операцию. Повторное проведение не требуется. Проверьте журнал.':pending.status==='rejected'?'Сохранение отклонено: '+pending.error:'Есть операция без подтверждённого ответа. Её исходные данные сохранены на сервере; автоматического повтора нет.';notice.append(description);
  const details=document.createElement('p');const total=data.amountKopecks??data.zCash;details.textContent=[data.date,data.register,data.shiftNum?'Смена '+data.shiftNum:'',Number.isSafeInteger(total)?new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(total/100):'',data.comment].filter(Boolean).join(' · ');notice.append(details);
  if(pending.status==='prepared'&&!pending.stale){const resume=document.createElement('button');resume.type='button';resume.textContent='Продолжить исходное сохранение';resume.onclick=async()=>{resume.disabled=true;try{await deliver(key,pending);location.assign('/finance/?tab=journal');}catch(error){description.textContent=error.message;resume.disabled=false;}};notice.append(resume);}
  const close=document.createElement('button');close.type='button';close.textContent=pending.status==='prepared'?'Отказаться от сохранения':'Уведомление проверено';close.onclick=async()=>{close.disabled=true;try{await session();await queueCall('dismiss',{id:p.requestId});uncertain.delete(key);showPending();}catch(error){description.textContent=error.message;close.disabled=false;}};notice.append(close);
  const link=document.createElement('a');link.href='/finance/?tab=journal';link.textContent='Открыть журнал';notice.append(link);document.body.append(notice);pendingNotice=notice;
 }
 async function loadPending(){
  const out=await queueCall('',null);queueError=null;if(!Array.isArray(out.commands))throw Error('Не удалось проверить неподтверждённые операции');
  const serverIds=new Set(out.commands.map(p=>p.id));for(const [key,p]of uncertain)if(!p.promise&&!serverIds.has(JSON.parse(p.body).requestId))uncertain.delete(key);
  for(const record of out.commands){const p=record.payload,key=pendingKey(p.method,p.orgId,p.data);const old=uncertain.get(key);if(!old?.promise)uncertain.set(key,{body:JSON.stringify(p),promise:null,status:record.status,error:record.error,stale:record.stale});}
  showPending();
 }
 async function deliver(key,pending){
  if(pending.promise)return pending.promise;
  pending.promise=(async()=>{
   await session();const payload=JSON.parse(pending.body);
   await queueCall('prepare',payload);
   let out;try{out=await queueCall('execute',{id:payload.requestId});}catch(error){if(error.definite){await queueCall('dismiss',{id:payload.requestId});uncertain.delete(key);}throw error;}
   pending.status='completed';
   // A lost acknowledgement leaves a completed receipt, never a second posting.
   try{await queueCall('dismiss',{id:payload.requestId});uncertain.delete(key);}catch{}
   if(out.result?.id&&out.result.version)versions.set(out.result.id,out.result.version);return out.result;
  })();
  try{return await pending.promise;}finally{pending.promise=null;showPending();}
 }
 async function write(method,orgId,input){
  const makeRequestId=typeof crypto.randomUUID==='function'?()=>crypto.randomUUID():(await import('/request-id.mjs')).newRequestId;
  const data=normalizeMoney(input);await session();await loadPending();
  if(method==='adjustBalance')data.expectedBalance=balances.get(data.id);
  const key=pendingKey(method,orgId,data);let pending=uncertain.get(key);
  if(!pending){if(uncertain.size)throw Error('Сначала проверьте неподтверждённую операцию в уведомлении. Новая запись не отправлена.');const requestId=data.clientUuid||data._requestId||makeRequestId();pending={body:JSON.stringify({method,orgId,data,requestId,expectedVersion:versions.get(data.id)}),promise:null,status:'prepared'};uncertain.set(key,pending);}
  return deliver(key,pending);
 }

 async function logout(){await session();const response=await nativeFetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Way-Token':csrf,'X-Way-Account':user.id},body:'{}'});if(!response.ok)throw Error('Выход не подтверждён сервером. Повторите попытку.');user=null;if(typeof BroadcastChannel==='function'){const c=new BroadcastChannel('way-workspace-session');c.postMessage('changed');c.close();}location.replace('/');}
 window.AUTH={init:async()=>{await session();try{await loadPending();}catch(error){queueError=error.message;showPending();}return user?'session':'new_user';},getUser:()=>user,getToken:()=> 'cookie-session',isSignedIn:()=>!!user,signIn:async()=>location.assign('/'),signUp:async()=>{throw Error('Аккаунт создаёт владелец в Way Market');},signOut:logout,lock:logout,hasPIN:()=>false,hasBiometrics:()=>false,biometricAvailable:()=>false,isBlocked:()=>false,setupPIN:async()=>{throw Error('Вход и пароль настраиваются в общем профиле Way Market');},verifyPIN:async()=>{throw Error('Используйте общий вход');},setupBiometrics:async()=>{throw Error('Биометрия общего входа пока не подключена');},setLockSeconds:()=>{},unblock:()=>{}};
 const original=window.API;
 const methods=['saveAccount','saveCategory','saveEmployee','saveCounterparty','saveTransaction','saveTransfer','saveShift'];
 for(const method of methods)original[method]=(orgId,data)=>write(method,orgId,data);
 original.saveShift=async()=>{throw Error('Откройте раздел «Касса»: сдача и приём выполняются по Excel-форме.');};
 for(const method of ['deleteAccount','deleteCategory','deleteEmployee','deleteTransaction','deleteDebtEntry','cancelShift'])original[method]=(orgId,id)=>write(method,orgId,{id});
 original.saveDebtEntry=(orgId,data)=>write('saveDebtEntry',orgId,data);
 original.adjustBalance=(orgId,id,amountKopecks,comment)=>write('adjustBalance',orgId,{id,amountKopecks,comment});
 original.setSetting=(orgId,key,value)=>write('setSetting',orgId,{key,value});
 original.createOrg=async()=>{throw Error('В этой системе уже выбран магазин Way Market');};
 original.uploadReceipt=async()=>{throw Error('Загрузка чеков пока не подключена; файл не сохранён');};
 original.flushQueue=async()=>{};
 // Legacy partial writes must never replay against the unified ledger.
 if(window.OfflineQueue)window.OfflineQueue.flush=async()=>{};
})();
