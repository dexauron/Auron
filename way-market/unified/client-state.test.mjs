import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {preferenceValues,browserStorage,deviceIdentifier,rememberedModule,samePrincipal} from './unified/preferences.js';

test('corrupt cached preferences cannot introduce arbitrary values or fields',()=>{
 assert.deepEqual(preferenceValues({theme:'javascript',textSize:999,lastModule:'admin',_version:-1,password:'secret'}),{theme:'system',textSize:'normal',lastModule:'workspace',_version:0});
 assert.equal(preferenceValues({_version:21,theme:'dark'})._version,21);
});
test('blocked browser storage uses the server device identifier without crashing',()=>{
 const host={get localStorage(){throw Error('blocked');}},storage=browserStorage(host);
 assert.equal(storage.get('key'),null);assert.equal(storage.set('key','value'),false);assert.deepEqual(storage.keys(),[]);
 assert.equal(deviceIdentifier(storage,'a'.repeat(32),()=>{throw Error('must use server ID');}),'a'.repeat(32));
});
test('remembered module respects the role and explicit destination',()=>{
 const p={lastModule:'finance'};
 assert.equal(rememberedModule(p,{role:'owner'},new URL('http://localhost/')),'/finance/');
 assert.equal(rememberedModule(p,{role:'employee'},new URL('http://localhost/')),null);
 for(const suffix of ['?view=home','?account=1'])assert.equal(rememberedModule(p,{role:'owner'},new URL('http://localhost/'+suffix)),null);
 assert.equal(rememberedModule({lastModule:'catalog'},{role:'employee'},new URL('http://localhost/')),'/catalog/');
 assert.equal(samePrincipal({id:'x',version:1},{id:'x',version:2}),false);
});
async function financeFixture(){
 const state={user:{id:'owner-id',name:'Владелец',version:1},posts:[],payloads:[],redirects:[],failSession:false,failLogout:false};
 const context={URL,console,crypto:{randomUUID:()=> 'a'.repeat(36)},location:{href:'http://localhost/finance/',origin:'http://localhost',replace:url=>state.redirects.push(url)},fetch:async(input,options={})=>{
  const url=new URL(input,'http://localhost');
  if(url.pathname==='/api/unified/commands')return new Response(JSON.stringify({commands:state.pending?[{id:state.pending.requestId,payload:state.pending,status:'prepared'}]:[]}));
  if(url.pathname==='/api/unified/commands/prepare'){state.pending=JSON.parse(options.body);return new Response('{}');}
  if(url.pathname==='/api/unified/commands/dismiss'){state.pending=null;return new Response('{}');}
  if(url.pathname==='/api/unified/commands/execute'){state.posts.push('/api/unified/finance');state.payloads.push(state.pending);return new Response(JSON.stringify({ok:true,result:{id:'movement'}}));}
  if(url.pathname==='/api/session'){if(state.failSession)throw Error('offline');return new Response(JSON.stringify({csrf:'csrf',user:state.user}));}
  state.posts.push(url.pathname);if(options.body)state.payloads.push(JSON.parse(options.body));return new Response(JSON.stringify(url.pathname==='/api/logout'?{loggedOut:true}:{id:'movement'}),{status:state.failLogout?503:200});
 },API:{}};context.window=context;
 runInNewContext(await readFile(new URL('./unified/finance-adapter.js',import.meta.url),'utf8'),context);
 await context.AUTH.init();return {context,state};
}
test('an old Finance tab cannot silently submit under a different account',async()=>{
 const {context,state}=await financeFixture();state.user={id:'accountant-id',version:1};
 await assert.rejects(()=>context.API.saveTransaction('org',{type:'income',amountKopecks:1}),/Аккаунт изменился/);
 assert.deepEqual(state.posts,[]);assert.deepEqual(state.redirects,['/']);
});
test('Finance checks permission-version changes even when the user ID is unchanged',async()=>{
 const {context,state}=await financeFixture();state.user={...state.user,version:2};
 await assert.rejects(()=>context.API.saveTransfer('org',{amountKopecks:1}),/Аккаунт изменился/);assert.equal(state.posts.length,0);
});
test('a connection failure does not sign the user out or submit a financial operation',async()=>{
 const {context,state}=await financeFixture();state.failSession=true;
 await assert.rejects(()=>context.API.saveTransaction('org',{type:'income',amountKopecks:1}));
 assert.equal(context.AUTH.getUser().id,'owner-id');assert.equal(state.posts.length,0);assert.equal(state.redirects.length,0);
});
test('failed logout never reports success or navigates away',async()=>{
 const {context,state}=await financeFixture();state.failLogout=true;await assert.rejects(()=>context.AUTH.signOut(),/Выход не подтверждён/);
 assert.equal(context.AUTH.getUser().id,'owner-id');assert.equal(state.redirects.length,0);
});

test('original Finance floating-point conversion preserves exact whole kopecks without rounding real fractions',async()=>{
 const {context,state}=await financeFixture();
 await context.API.saveTransaction('org',{type:'income',amountKopecks:1.15*100});assert.equal(state.payloads[0].data.amountKopecks,115);
 await assert.rejects(()=>context.API.saveShift('org',{}),/Excel/);
 await context.API.saveTransaction('org',{type:'income',amountKopecks:1.5});assert.equal(state.payloads[1].data.amountKopecks,1.5);
});
