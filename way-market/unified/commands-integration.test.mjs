import {makeWorkspaceArchive,validateWorkspaceArchive} from './workspace/workspace-archive.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {createWorkspaceServer} from './workspace/workspace-server.mjs';
import {createUnifiedData,ORG} from './unified-data.mjs';
import {unifiedCommands} from './unified-commands.mjs';
import {createUnifiedExtension} from './unified-extension.mjs';
import {root} from './start.mjs';
const password='Проверка устойчивых команд длинная фраза 2026',device='a'.repeat(32),otherDevice='b'.repeat(32);
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'way-commands-'));let w,data,commands,server,base;
 const start=async()=>{w=openWorkspace(join(dir,'test.sqlite'),{persistentSessions:true});data=createUnifiedData(w);commands=unifiedCommands(w,data);server=createWorkspaceServer(w,{persistentSessions:true,extension:createUnifiedExtension(root,data,w)}).server;await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));w.close();};await start();t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});const account=data.financeWrite(owner.token,{method:'saveAccount',orgId:ORG,requestId:randomUUID(),data:{name:'Наличные',initialBalance:'0'}});
 const f={owner,account,get w(){return w;},get data(){return data;},get commands(){return commands;},get base(){return base;},restart:async()=>{await stop();await start();}};
 f.payload=(extra={})=>({method:'saveTransaction',orgId:ORG,requestId:randomUUID(),data:{accountId:account.id,type:'income',amountKopecks:115,date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date()),comment:'Проверка потерянного ответа',...extra}});
 f.balance=()=>w.finance(owner.token).accounts.find(a=>a.id===account.id).balance;return f;
}
test('durable commands: prepare does not move money; execution and completion survive server restart',async t=>{
 const f=await fixture(t),p=f.payload();f.commands.prepare(f.owner.token,device,p);assert.equal(f.balance(),0);await f.restart();assert.equal(f.commands.list(f.owner.token,device).commands[0].status,'prepared');const first=f.commands.execute(f.owner.token,device,p.requestId);assert.equal(first.ok,true);await f.restart();assert.deepEqual(f.commands.execute(f.owner.token,device,p.requestId),first);assert.equal(f.balance(),115);f.commands.dismiss(f.owner.token,device,p.requestId);assert.equal(f.commands.list(f.owner.token,device).commands.length,0);assert.throws(()=>f.commands.execute(f.owner.token,device,p.requestId));assert.equal(f.balance(),115);
});
test('durable commands: a lost execution response is recovered by a new browser context without reposting',async t=>{
 const f=await fixture(t),script=await readFile(new URL('./unified/finance-adapter.js',import.meta.url),'utf8');let loseResponse=true,executeCount=0;
 const client=async()=>{const context={URL,crypto:{randomUUID},location:{href:f.base+'/finance/',origin:f.base,replace:()=>{}},API:{},fetch:async(path,opts={})=>{const response=await fetch(f.base+path,{...opts,headers:{...opts.headers,Cookie:'way_workspace='+f.owner.token+'; way_device='+device}});if(path.endsWith('/execute')){executeCount++;if(loseResponse){loseResponse=false;await response.text();throw Error('Ответ потерян после COMMIT');}}return response;}};context.window=context;runInNewContext(script,context);await context.AUTH.init();return context;};
 let browser=await client();const d=f.payload().data;await assert.rejects(()=>browser.API.saveTransaction(ORG,{...d,clientUuid:randomUUID()}),/потерян/);assert.equal(f.balance(),115);
 browser=await client();assert.equal(executeCount,1,'Reload only reads pending commands');await browser.API.saveTransaction(ORG,{...d,clientUuid:randomUUID()});assert.equal(f.balance(),115);assert.equal(f.commands.list(f.owner.token,device).commands.length,0);
});
test('durable commands: pending command blocks unrelated new input and cannot be overwritten',async t=>{
 const f=await fixture(t),p=f.payload();f.commands.prepare(f.owner.token,device,p);assert.throws(()=>f.commands.prepare(f.owner.token,device,f.payload({amountKopecks:200})),/неподтверждённую/);assert.throws(()=>f.commands.prepare(f.owner.token,device,{...p,data:{...p.data,amountKopecks:999}}),/использован/);assert.equal(f.balance(),0);f.commands.dismiss(f.owner.token,device,p.requestId);assert.throws(()=>f.commands.execute(f.owner.token,device,p.requestId));
});
test('durable commands: commands are private to the account and device that prepared them',async t=>{
 const f=await fixture(t),p=f.payload();f.commands.prepare(f.owner.token,device,p);await f.w.accounts.createUser(f.owner.token,{login:'bookkeeper',name:'Бухгалтер',password,role:'accountant'});const b=await f.w.accounts.login({login:'bookkeeper',password});assert.equal(f.commands.list(b.token,device).commands.length,0);assert.equal(f.commands.list(f.owner.token,otherDevice).commands.length,0);assert.throws(()=>f.commands.execute(b.token,device,p.requestId));assert.throws(()=>f.commands.dismiss(f.owner.token,otherDevice,p.requestId));assert.equal(f.balance(),0);
});
test('durable commands: changed account permissions cannot execute an old prepared command',async t=>{
 const f=await fixture(t);await f.w.accounts.createUser(f.owner.token,{login:'bookkeeper',name:'Бухгалтер',password,role:'accountant'});let b=await f.w.accounts.login({login:'bookkeeper',password});const p=f.payload();f.commands.prepare(b.token,device,p);f.w.accounts.updateUser(f.owner.token,{id:b.user.id,expectedVersion:1,name:'Бухгалтер изменён',role:'accountant',active:true,reason:'Проверка смены прав'});b=await f.w.accounts.login({login:'bookkeeper',password});assert.equal(f.commands.list(b.token,device).commands[0].stale,true);assert.throws(()=>f.commands.execute(b.token,device,p.requestId),/Права/);f.commands.dismiss(b.token,device,p.requestId);assert.equal(f.balance(),0);
});
test('durable commands: a rejected operation rolls back and cannot become a different command',async t=>{
 const f=await fixture(t),p=f.payload({amountKopecks:1.5});f.commands.prepare(f.owner.token,device,p);const result=f.commands.execute(f.owner.token,device,p.requestId);assert.equal(result.ok,false);assert.deepEqual(f.commands.execute(f.owner.token,device,p.requestId),result);assert.equal(f.balance(),0);assert.equal(f.commands.list(f.owner.token,device).commands[0].status,'rejected');
});
test('Excel cash form: legacy Finance URL redirects to the worksheet and alternate closure is rejected',async t=>{
 const f=await fixture(t),headers={Cookie:'way_workspace='+f.owner.token+'; way_device='+device};const old=await fetch(f.base+'/finance/?tab=kassa',{headers,redirect:'manual'});assert.equal(old.status,303);assert.equal(old.headers.get('location'),'/?view=cash');const session=await(await fetch(f.base+'/api/session',{headers})).json();const p={method:'saveShift',requestId:randomUUID(),orgId:ORG,data:{}};const denied=await fetch(f.base+'/api/unified/finance',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Way-Token':session.csrf,'X-Way-Account':f.owner.user.id},body:JSON.stringify(p)});assert.equal(denied.status,400);assert.match((await denied.json()).error,/Excel/);assert.throws(()=>f.commands.prepare(f.owner.token,device,p),/Excel/);assert.equal(f.balance(),0);
 const layout=await readFile(new URL('./unified/layout.js',import.meta.url),'utf8');assert.match(layout,/\['cash','Касса','\/\?view=cash'\]/);
 const worksheet=await readFile(new URL('./workspace/worksheet.mjs',import.meta.url));assert.equal(createHash('sha256').update(worksheet).digest('hex'),'29677d89fbea8db4a43cab8d63bd58ae4bb68000dadb11db25c84be1bb195bee');
});

test('durable commands: an unexpected failure after a financial write rolls back money and retains the prepared command',async t=>{
 const f=await fixture(t),p=f.payload();f.commands.prepare(f.owner.token,device,p);const failing=unifiedCommands(f.w,{financeWrite:(...args)=>{f.data.financeWrite(...args);throw Error('Сбой после записи');}});assert.throws(()=>failing.execute(f.owner.token,device,p.requestId),/Сбой/);assert.equal(f.balance(),0);assert.equal(f.commands.list(f.owner.token,device).commands[0].status,'prepared');assert.equal(f.commands.execute(f.owner.token,device,p.requestId).ok,true);assert.equal(f.balance(),115);
});

test('durable commands: a full archive retains an unexecuted command without executing it during restore',async t=>{
 const f=await fixture(t),p=f.payload();f.commands.prepare(f.owner.token,device,p);const archive=makeWorkspaceArchive(f.w.accounts.workspaceSnapshot(f.owner.token));validateWorkspaceArchive(archive);const restored=openWorkspace(':memory:',{persistentSessions:true});t.after(()=>restored.close());restored.accounts.restoreWorkspace(archive,randomUUID());const owner=await restored.accounts.login({login:'owner',password});const commands=unifiedCommands(restored,createUnifiedData(restored));assert.equal(commands.list(owner.token,device).commands[0].status,'prepared');assert.equal(restored.finance(owner.token).accounts.find(a=>a.id===f.account.id).balance,0);
});
