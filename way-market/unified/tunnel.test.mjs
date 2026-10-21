import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createTunnelGateway,quickOrigin} from './tunnel-gateway.mjs';
import {quickUrlFromLog,testDirectory,TUNNEL_SESSIONS} from './tunnel-test.mjs';
import {openWorkspace} from './workspace/workspace-store.mjs';
import {createWorkspaceServer} from './workspace/workspace-server.mjs';
const origin='https://example-test.trycloudflare.com',password='Isolated tunnel test password 123456';
async function fixture(t,configured=true){
 const w=openWorkspace(':memory:',{persistentSessions:true});if(configured)await w.accounts.bootstrapOwner({login:'owner',name:'Тестовый владелец',password});
 const {server:inner}=createWorkspaceServer(w,{persistentSessions:true});await new Promise(r=>inner.listen(0,'127.0.0.1',r));
 const gateway=createTunnelGateway({upstreamPort:inner.address().port,configured:()=>w.accounts.configured()});await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{gateway.disable();for(const s of [gateway.server,inner]){s.closeAllConnections();await new Promise(r=>s.close(r));}w.close();});
 function call(path,{headers={},data,method=data?'POST':'GET'}={}){return new Promise((ok,fail)=>{
  const c=request({host:'127.0.0.1',port:gateway.server.address().port,path,method,headers:{Host:new URL(origin).host,'X-Forwarded-Proto':'https',...(data?{'Content-Type':'application/json'}:{}),...headers}},res=>{let text='';res.setEncoding('utf8');res.on('data',v=>text+=v);res.on('end',()=>{let body;try{body=JSON.parse(text);}catch{}ok({status:res.statusCode,headers:res.headers,body,text});});});c.on('error',fail);c.end(data?JSON.stringify(data):undefined);
 });}
 return {w,inner,gateway,call};
}
test('tunnel pins a single HTTPS trycloudflare origin and rejects URL ambiguity',()=>{
 assert.equal(quickOrigin(origin+'/'),origin);
 for(const bad of ['http://example-test.trycloudflare.com','https://trycloudflare.com','https://evil.example.com','https://x.trycloudflare.com.evil.example','https://user@x.trycloudflare.com','https://x.trycloudflare.com:8443','https://x.trycloudflare.com/?x','https://x.trycloudflare.com/a','https://x.trycloudflare.com/#x'])assert.throws(()=>quickOrigin(bad));
 const g=createTunnelGateway({upstreamPort:1234,configured:()=>true});g.setOrigin(origin);g.setOrigin(origin);assert.throws(()=>g.setOrigin('https://different.trycloudflare.com'));
});
test('quick URL log parser ignores unrelated destinations; test data directory is separate',()=>{
 assert.equal(quickUrlFromLog('INF Your URL: '+origin),origin);assert.equal(quickUrlFromLog('https://developers.cloudflare.com/'),null);
 assert.equal(quickUrlFromLog('https://evil.example.com/'),null);
 assert.match(testDirectory('win32',{ProgramData:'C:/ProgramData'},'/home'),/WayMarket-Quick-Tunnel-Test$/);
 assert.doesNotMatch(testDirectory('win32',{},'/home'),/WayMarket-Unified-Test/);
 assert.match(testDirectory('linux',{},'/home/test'),/\.way-market-quick-tunnel-test$/);
});
test('gateway stays closed before URL discovery and local owner setup, and can be disabled',async t=>{
 const f=await fixture(t,false);assert.equal((await f.call('/api/session')).status,503);
 f.gateway.setOrigin(origin);assert.equal((await f.call('/api/session')).status,503);
 await f.w.accounts.bootstrapOwner({login:'owner',name:'Тест',password});assert.equal((await f.call('/api/session')).status,200);
 f.gateway.disable();assert.equal((await f.call('/api/session')).status,503);
});
test('public host, scheme, foreign origins, fetch metadata, bootstrap and unsupported methods are rejected',async t=>{
 const f=await fixture(t);f.gateway.setOrigin(origin);
 for(const headers of [{Host:'evil.example'},{'X-Forwarded-Proto':'http'},{'X-Forwarded-Proto':''},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.call('/api/session',{headers})).status,403);
 assert.equal((await f.call('/api/bootstrap',{data:{}})).status,403);
 assert.equal((await f.call('/api/session',{method:'DELETE'})).status,405);
 assert.equal((await f.call('//evil.example/api/session')).status,400);
});
test('authenticated session survives gateway, cookies are Secure and HttpOnly, and logout revokes it',async t=>{
 const f=await fixture(t);f.gateway.setOrigin(origin);
 const session=await f.call('/api/session');assert.equal(session.status,200);assert.equal(session.body.user,null);
 assert.equal((await f.call('/api/finance')).status,401);
 const login=await f.call('/api/login',{headers:{Origin:origin,'X-Way-Token':session.body.csrf},data:{login:'owner',password}});
 assert.equal(login.status,200);const cookie=login.headers['set-cookie'].find(c=>c.startsWith('way_workspace='));assert.match(cookie,/; Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Max-Age=34560000/);
 const headers={Cookie:cookie.split(';')[0],Origin:origin,'X-Way-Token':session.body.csrf};
 assert.equal((await f.call('/api/finance',{headers})).status,200);
 assert.equal((await f.call('/request-id.mjs',{headers})).status,200);
 assert.equal((await f.call('/api/logout',{headers,data:{}})).status,200);
 assert.equal((await f.call('/api/finance',{headers})).status,401);
});
test('gateway retains CSRF and role authorization while removing untrusted forwarding headers',async t=>{
 const f=await fixture(t);f.gateway.setOrigin(origin);const session=(await f.call('/api/session')).body;
 const owner=await f.w.accounts.login({login:'owner',password});await f.w.accounts.createUser(owner.token,{login:'cashier',name:'Тестовый кассир',password,role:'cashier'});
 const cashier=await f.w.accounts.login({login:'cashier',password});const cookie='way_workspace='+cashier.token;
 assert.equal((await f.call('/api/finance',{headers:{Cookie:cookie}})).status,403);
 assert.equal((await f.call('/api/tasks',{headers:{Cookie:cookie},data:{}})).status,403);
 const headers={Cookie:'way_workspace='+owner.token,Origin:origin,'X-Way-Token':session.csrf,'X-Forwarded-For':'192.0.2.1','X-Forwarded-Host':'evil.example',Forwarded:'host=evil.example'};
 const saved=await f.call('/api/tasks',{headers,data:{requestId:randomUUID(),expectedVersion:0,title:'Проверить тестовый товар',assigneeId:owner.user.id,status:'open'}});
 assert.equal(saved.status,200);assert.equal(f.w.tasks(owner.token).length,1);
 assert.equal((await f.call('/api/overview',{headers})).headers['cache-control'],'no-store');
});
test('guessing unknown logins cannot lock out staff; a real login is limited separately',async()=>{const w=openWorkspace(':memory:',{persistentSessions:TUNNEL_SESSIONS});try{await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});await w.accounts.createUser(owner.token,{login:'employee',name:'Сотрудник',password,role:'employee'});
 for(let i=0;i<31;i++)await assert.rejects(w.accounts.login({login:'nobody-'+i,password:'wrong password value'}));
 assert.ok((await w.accounts.login({login:'employee',password})).token);
 for(let i=0;i<5;i++)await assert.rejects(w.accounts.login({login:'owner',password:'wrong password value'}));
 await assert.rejects(w.accounts.login({login:'owner',password}));assert.ok((await w.accounts.login({login:'employee',password})).token);}finally{w.close();}});
test('internet sessions expire after idle time and after the absolute limit',async()=>{let now=Date.parse('2026-10-21T08:00:00Z');const w=openWorkspace(':memory:',{persistentSessions:TUNNEL_SESSIONS,clock:()=>now});try{await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});
 const idle=await w.accounts.login({login:'owner',password});assert.equal(idle.expiresAt,now+TUNNEL_SESSIONS.absoluteMs);now+=TUNNEL_SESSIONS.idleMs-1000;w.accounts.session(idle.token);now+=TUNNEL_SESSIONS.idleMs;assert.throws(()=>w.accounts.session(idle.token),/Войдите/);
 const active=await w.accounts.login({login:'owner',password}),start=now;while(now-start<TUNNEL_SESSIONS.absoluteMs-86400000){now+=86400000;w.accounts.session(active.token);}now=start+TUNNEL_SESSIONS.absoluteMs;assert.throws(()=>w.accounts.session(active.token),/Войдите/);
 const local=openWorkspace(':memory:',{persistentSessions:true,clock:()=>now});try{await local.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const s=await local.accounts.login({login:'owner',password});now+=400*86400000;assert.equal(local.accounts.session(s.token).role,'owner');}finally{local.close();}}finally{w.close();}});
