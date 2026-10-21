import {createHash} from 'node:crypto';
import {InputError} from './workspace/domain.mjs';
import {AccessError} from './workspace/access.mjs';
import {VersionError} from './workspace/workspace-store.mjs';
import {financeId} from './workspace/finance-data.mjs';
export function financeDevice(req,token){return /(?:^|;\s*)way_device=([a-f0-9]{32})(?:;|$)/.exec(req.headers.cookie||'')?.[1] || createHash('sha256').update('way-device:'+token).digest('hex').slice(0,32);}
export function unifiedCommands(w,data){
 const latest=db=>{const records=new Map();for(const row of db.prepare("SELECT subject_id,detail FROM account_events WHERE kind='unified.command' ORDER BY sequence").all())records.set(row.subject_id,JSON.parse(row.detail));return records;};
 const scope=(record,actor,device)=>record&&record.actorId===actor.id&&record.device===device;
 const command=(token,device,fn)=>{if(!/^[a-f0-9]{32}$/.test(device))throw new InputError('Не удалось определить устройство');return w.accounts.command(token,'finance.manage',()=>({}),(db,actor,audit)=>fn(db,actor,(id,value)=>audit('unified.command',id,value)));};
 const get=(db,actor,device,id)=>{if(!financeId(id))throw new InputError('Неверная команда');const record=latest(db).get(id);if(!scope(record,actor,device))throw new AccessError('Команда недоступна');return record;};
 return {
  list:(token,device)=>command(token,device,(db,actor)=>({commands:[...latest(db)].filter(([,r])=>scope(r,actor,device)&&r.status!=='dismissed').map(([id,r])=>({id,payload:r.payload,status:r.status,result:r.result,error:r.error,stale:r.actorVersion!==actor.version}))})),
  prepare:(token,device,payload)=>command(token,device,(db,actor,stamp)=>{
   if(!payload||!financeId(payload.requestId)||typeof payload.method!=='string'||!payload.data||typeof payload.data!=='object'||Array.isArray(payload.data)||Buffer.byteLength(JSON.stringify(payload))>16000)throw new InputError('Проверьте финансовую команду');
   if(payload.method==='saveShift')throw new InputError('Сдача и приём смены выполняются в кассовом листе по Excel-форме: раздел «Касса»');
   const records=latest(db),old=records.get(payload.requestId);
   if(old){if(!scope(old,actor,device)||old.actorVersion!==actor.version||JSON.stringify(old.payload)!==JSON.stringify(payload))throw new VersionError('Идентификатор команды уже использован');if(old.status==='dismissed')throw new VersionError('Команда уже закрыта');return {id:payload.requestId,status:old.status};}
   if([...records.values()].some(r=>scope(r,actor,device)&&r.status!=='dismissed'))throw new VersionError('Сначала проверьте неподтверждённую операцию этого устройства');
   stamp(payload.requestId,{actorId:actor.id,actorVersion:actor.version,device,payload,status:'prepared'});return {id:payload.requestId,status:'prepared'};
  }),
  execute:(token,device,id)=>command(token,device,(db,actor,stamp)=>{
   const r=get(db,actor,device,id);if(r.actorVersion!==actor.version)throw new AccessError('Права аккаунта изменились. Проверьте и закройте прежнюю команду');
   if(r.status==='completed')return {ok:true,result:r.result};if(r.status==='rejected')return {ok:false,error:r.error};if(r.status!=='prepared')throw new VersionError('Команда уже закрыта');
   try{const result=data.financeWrite(token,r.payload);stamp(id,{...r,status:'completed',result});return {ok:true,result};}
   catch(error){if(!(error instanceof InputError||error instanceof AccessError||error instanceof VersionError))throw error;stamp(id,{...r,status:'rejected',error:error.message});return {ok:false,error:error.message};}
  }),
  dismiss:(token,device,id)=>command(token,device,(db,actor,stamp)=>{const r=get(db,actor,device,id);if(r.status!=='dismissed')stamp(id,{...r,status:'dismissed'});return {ok:true};})
 };
}
