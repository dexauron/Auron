import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=resolve(process.env.WAY_BOOT_TARGET||fileURLToPath(new URL('.',import.meta.url)));
const {openWorkspace}=await import(pathToFileURL(join(root,'workspace/workspace-store.mjs')));
const {createWorkspaceServer}=await import(pathToFileURL(join(root,'workspace/workspace-server.mjs')));
const {createUnifiedData}=await import(pathToFileURL(join(root,'unified-data.mjs')));
const {createUnifiedExtension}=await import(pathToFileURL(join(root,'unified-extension.mjs')));
async function fixture(t){const w=openWorkspace(':memory:');const app=createWorkspaceServer(w,{extension:createUnifiedExtension(root,createUnifiedData(w),w)});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));w.close();});const base='http://127.0.0.1:'+app.server.address().port;return {w,app,base};}
async function entryGraph(base){const seen=new Set(),pending=['/workspace.mjs','/unified/shell.js'];while(pending.length){const path=pending.pop();if(seen.has(path))continue;seen.add(path);const response=await fetch(base+path);assert.equal(response.status,200,'Anonymous static module blocked: '+path);assert.match(response.headers.get('content-type'),/javascript/);const source=await response.text();for(const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g)){const url=new URL(match[1],base+path);assert.equal(url.origin,base);pending.push(url.pathname);}}return seen;}
test('first-run: anonymous static module graph loads before the first owner exists',async t=>{const {base}=await fixture(t);const session=await(await fetch(base+'/api/session')).json();assert.equal(session.configured,false);assert.equal(session.user,null);const html=await(await fetch(base+'/')).text();assert.match(html,/id="boot-state"/);assert.match(html,/src="\/startup.js"/);assert.equal((await fetch(base+'/startup.js')).status,200);const seen=await entryGraph(base);assert.ok(seen.has('/worksheet.mjs'));});
test('first-run: after logout the complete login module graph remains available while protected helpers and data stay private',async t=>{
 const {w,base}=await fixture(t),password='Проверка первого входа длинная фраза';await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});w.accounts.logout(owner.token);await entryGraph(base);
 for(const path of ['/unified/product-picker.js','/unified/calendar.js','/unified/order-workflow.js','/api/unified/catalog','/api/finance'])assert.equal((await fetch(base+path)).status,401,path);
});
test('first-run: setup, login and authenticated helper loading work on the actual HTTP server',async t=>{
 const {base,app}=await fixture(t),s=await(await fetch(base+'/api/session')).json();const credentials={login:'owner',name:'Владелец',password:'Проверка первого входа длинная фраза'};
 const post=(path,body,cookie='')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Way-Token':s.csrf,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 assert.equal((await post('/api/bootstrap',{...credentials,code:app.setupCode})).status,200);const response=await post('/api/login',credentials);assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];
 for(const path of ['/unified/product-picker.js','/unified/calendar.js','/unified/order-workflow.js'])assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,200,path);
 const owner=await(await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json();assert.equal(owner.user.role,'owner');
});

async function startupUI(loadWorkspace,visible=false){
 const elements=Object.fromEntries(['boot-state','boot-message','boot-detail','boot-retry','entry','app'].map(id=>[id,{hidden:true,textContent:'',addEventListener:()=>{}}]));elements['boot-state'].hidden=false;elements.entry.hidden=!visible;
 const code=(await readFile(join(root,'workspace/workspace/startup.js'),'utf8')).replace("import('/workspace.mjs')",'loadWorkspace()');
 runInNewContext(code,{document:{getElementById:id=>elements[id]},location:{reload:()=>{}},setTimeout:()=>1,clearTimeout:()=>{},loadWorkspace});await new Promise(setImmediate);return elements;
}
test('startup screen: a failed module import leaves an actionable visible error instead of a blank page',async()=>{
 const e=await startupUI(()=>Promise.reject(Error('Не удалось загрузить модуль')));assert.equal(e['boot-state'].hidden,false);assert.match(e['boot-message'].textContent,/Не удалось загрузить интерфейс/);assert.equal(e['boot-detail'].textContent,'Не удалось загрузить модуль');
});
test('startup screen: successful login screen rendering dismisses the loading panel',async()=>{
 const e=await startupUI(()=>Promise.resolve(),true);assert.equal(e['boot-state'].hidden,true);
});
