const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function load(file){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',value:'',hidden:false,style:{},dataset:{},addEventListener(){},setAttribute(){},classList:{toggle(){}}});return elements.get(id)};
 const context={document:{getElementById:get,addEventListener(){},querySelector(){return null},documentElement:{dataset:{}},body:{classList:{toggle(){}}}},window:{scrollTo(){},addEventListener(){}},location:{hash:''},Intl,setTimeout,clearTimeout,fetch(){throw Error('Mockup must not contact a backend')}};
 vm.createContext(context);const html=fs.readFileSync(path.join(__dirname,file),'utf8');
 vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]+';globalThis.api={S,go,selectRole,cashDemo,cashFigures,rubKopecks};',context);
 return {...context.api,context,get};
}

for(const file of ['index.html','mobile.html']){
 test(file+': every role view renders and links remain within allowed routes',()=>{
  const a=load(file);assert.equal(new Set(a.S.map(x=>x.id)).size,a.S.length);
  for(const role of ['buyer','employee','admin','rep','accountant','owner']){
   a.selectRole(role);for(const s of a.S.filter(x=>x.roles.includes(role))){a.go(s.id);const html=a.get('content').innerHTML;assert.ok(html.length>80,role+' '+s.id);for(const [,id]of html.matchAll(/data-go="([^"]+)"/g))assert.ok(a.S.some(x=>x.id===id&&x.roles.includes(role)),role+' '+s.id+' -> '+id)}
  }
  a.selectRole('buyer');a.go('riskCase');assert.notEqual(a.context.location.hash,'buyer/riskCase');
  a.go('aiAssistant');assert.doesNotMatch(a.get('content').innerHTML,/data-go="(?:riskCase|readiness|aiMemory|repPayments)"/);
  assert.doesNotMatch(a.get('mobileNav').innerHTML,/\$\{/,'Navigation must render SVG, not template source');
 });
 test(file+': cash math keeps declared, counted and expected amounts distinct',()=>{
  const a=load(file),v=a.cashFigures();assert.equal(v.expected,2500000);assert.equal(v.declaredDiff,-10000);assert.equal(v.handedDiff,-10000);assert.equal(v.actualDiff,-20000);
  a.cashDemo.accepted='';const pending=a.cashFigures();assert.equal(pending.expected,2500000);assert.equal(pending.actualDiff,null);assert.equal(pending.handedDiff,null);
  a.cashDemo.payments[0].source='card';assert.equal(a.cashFigures().expected,3250000);
  a.cashDemo.payments[0].source='cash';a.cashDemo.payments[0].confirmed=false;assert.equal(a.cashFigures().expected,3250000);
  a.cashDemo.payments[0].confirmed='unknown';assert.equal(a.cashFigures(),null);
 });
 test(file+': cash cancellation is exact even near the integer limit',()=>{
  const a=load(file);a.cashDemo.opening='90071992547409.91';a.cashDemo.zCash='0.02';a.cashDemo.otherIn='0';a.cashDemo.retained='0';a.cashDemo.claimed='';a.cashDemo.accepted='';a.cashDemo.payments=[{amount:'0.02',confirmed:true,source:'cash'}];
  assert.equal(a.cashFigures().expected,Number.MAX_SAFE_INTEGER);
  a.cashDemo.payments=[];assert.equal(a.cashFigures(),null);
  assert.equal(a.rubKopecks('12,34'),1234);assert.equal(a.rubKopecks('12.345'),null);assert.equal(a.rubKopecks(''),null);
 });
}
