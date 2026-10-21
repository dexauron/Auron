import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {EventEmitter} from 'node:events';
import launcher from './launch.cjs';
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'way-launch-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('unsupported Node and incomplete extraction fail before importing SQLite or opening a browser',async()=>{
 let imports=0,browsers=0;await assert.rejects(()=>launcher.launch({version:'22.20.0',load:async()=>{imports++;},browser:async()=>{browsers++;}}),/Node.js 24/);assert.equal(imports,0);assert.equal(browsers,0);assert.throws(()=>launcher.preflight('24.19.0',()=>false),e=>e.code==='ENOENT');assert.match(launcher.diagnose({code:'ENOENT'}),/ВЕСЬ архив/);for(const module of ['request-id.mjs','list-controls.mjs'])assert.throws(()=>launcher.preflight('24.19.0',p=>!p.endsWith(module)),e=>e.code==='ENOENT'&&e.message.includes(module));
});
test('browser opens only after the actual server returns a working HTML page and session endpoint',async t=>{
 const dir=await directory(t);let called=0;const suite=await launcher.launch({options:{dataDirectory:dir,port:0},browser:async url=>{called++;const page=await fetch(url);assert.equal(page.status,200);assert.match(await page.text(),/<html/);const session=await(await fetch(url+'/api/session')).json();assert.equal(session.configured,false);return true;}});t.after(()=>suite.close());assert.equal(called,1);
});
test('failed automatic browser opening keeps the server running for manual access',async t=>{
 const dir=await directory(t);const suite=await launcher.launch({options:{dataDirectory:dir,port:0},browser:async()=>{throw Error('No desktop handler');}});t.after(()=>suite.close());assert.equal((await fetch('http://127.0.0.1:'+suite.server.address().port+'/')).status,200);
});
test('occupied port reports the conflict and never opens an unrelated server in a browser',async t=>{
 const dir=await directory(t),occupied=createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>occupied.close(r)));let browsers=0;
 await assert.rejects(()=>launcher.launch({options:{dataDirectory:dir,port:occupied.address().port},browser:async()=>{browsers++;}}),e=>e.code==='EADDRINUSE');assert.equal(browsers,0);assert.match(launcher.diagnose({code:'EADDRINUSE'}),/Порт 3211/);
});
test('Windows launcher uses an explicit start command and reports OS browser errors without crashing',async()=>{
 const calls=[];const ok=await launcher.openBrowser('http://127.0.0.1:3211','win32',(cmd,args)=>{calls.push([cmd,args]);const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',0));return child;});assert.equal(ok,true);assert.equal(calls[0][0],'cmd.exe');assert.match(calls[0][1].at(-1),/start "" "http:\/\/127\.0\.0\.1:3211"/);
 assert.equal(await launcher.openBrowser('http://127.0.0.1:3211','win32',()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('Blocked')));return child;}),false);
});
test('Windows CMD checks extraction and missing runtime and retains readable CRLF lines',async()=>{
 const bytes=await readFile(new URL('./start-way-market.cmd',import.meta.url));const source=bytes.toString('utf8');assert.ok(source.includes('\r\n'));assert.equal(source.replaceAll('\r\n','').includes('\n'),false);assert.match(source,/where node.exe/);assert.match(source,/if not exist/);assert.match(source,/pause/);
});
