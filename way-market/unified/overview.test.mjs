import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openWorkspace, emptySheet } from './workspace/workspace-store.mjs';
import { createWorkspaceServer } from './workspace/workspace-server.mjs';
import { overview } from './workspace/workspace-overview.mjs';

test('overview counts beyond list limits, keeps latest shifts, separates roles and denies anonymous HTTP', async () => {
 const w=openWorkspace(':memory:'), password='Isolated test password 123456789'; let server;
 try {
  await w.accounts.bootstrapOwner({login:'owner',name:'Owner',password});
  const owner=await w.accounts.login({login:'owner',password}), sessions={owner};
  for(const role of ['accountant','cashier','administrator','employee','representative']) {
   await w.accounts.createUser(owner.token,{login:role,name:role,role,password});sessions[role]=await w.accounts.login({login:role,password});
  }
  const cashier=sessions.cashier;
  for(let i=0;i<205;i++) w.taskSave(owner.token,{requestId:randomUUID(),expectedVersion:0,title:'Задача '+i,assigneeId:cashier.user.id,status:'open'});
  w.taskSave(owner.token,{requestId:randomUUID(),expectedVersion:0,title:'Private employee task',assigneeId:sessions.employee.user.id,status:'open'});
  for(let i=0;i<102;i++) {
   const input=emptySheet(); input.date='2026-10-18';input.shiftNo=String(i+1);
   for(const row of input.worksheet.settings.rows)input.worksheet.values[row.id]=row.enabled&&row.id!=='received'?'0':'';
   w.cashSave(cashier.token,{requestId:randomUUID(),expectedVersion:0,accept:false,input});
  }
  assert.equal(w.tasks(cashier.token).length,200);assert.equal(w.cashList(cashier.token).length,100);
  const state=w.overview(cashier.token);assert.equal(state.tasks.mineOpen,205);assert.equal(state.cash.pending,102);
  assert.equal(state.tasks.recent.length,5);assert.equal(state.cash.recent.length,5);assert.equal('finance' in state,false);
  assert.ok(state.tasks.recent.every(t=>t.assigneeId===cashier.user.id));
  assert.ok(state.cash.recent.every(c=>!('input' in c)&&!('result' in c)));
  const last=w.cashList(cashier.token)[0], input=structuredClone(last.input); input.worksheet.values.received='0';
  w.cashSave(owner.token,{requestId:randomUUID(),expectedVersion:last.version,id:last.id,accept:true,input,reason:'Пересчитано'});
  assert.equal(w.overview(owner.token).cash.pending,101);
  w.financeSave(owner.token,{kind:'account',expectedVersion:0,requestId:randomUUID(),refVersions:{},name:'Проверенная касса',type:'cash',openingDate:'2026-10-01',openingBalance:'1000.01',active:true});
  w.financeSave(owner.token,{kind:'obligation',expectedVersion:0,requestId:randomUUID(),refVersions:{},direction:'payable',party:'Проверенный поставщик',supplierId:null,receiptId:null,amount:'25.50',date:'2026-10-18',dueDate:'2026-10-25',basis:'Тестовое основание',status:'open'});
  for(const role of ['owner','accountant']) {const f=w.overview(sessions[role].token).finance;assert.equal(f.balance,100001);assert.equal(f.payable,2550);} 
  for(const role of ['administrator','employee','representative']) { const s=w.overview(sessions[role].token);assert.equal('cash' in s,false);assert.equal('finance' in s,false); }
  assert.equal(w.overview(sessions.employee.token).tasks.recent.length,1);
  assert.equal(w.overview(sessions.representative.token).tasks.recent.length,0);
  assert.throws(()=>w.overview(''));
  ({server}=createWorkspaceServer(w));server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/overview')).status,401);
  const response=await fetch(base+'/api/overview',{headers:{Cookie:'way_workspace='+cashier.token}});
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal('finance' in await response.json(),false);
 } finally {if(server)await new Promise(r=>server.close(r));w.close();}
});

test('overview uses unpaid open payable debts, not receivables, cancelled debts or scheduled sums; date is Moscow', () => {
 const db={prepare:()=>({all:()=>[]})},actor={id:'owner',role:'owner'};
 const debt=(id, direction, status, remaining, dueDate)=>({id,remaining,data:{party:id,direction,status,dueDate}});
 const finance={accounts:[{id:'cash',balance:120000,data:{name:'Касса',type:'cash',active:true}},{id:'bank',balance:-40000,data:{name:'Банк',type:'bank',active:false}}],obligations:[
  debt('paid','payable','open',0,'2026-10-01'), debt('cancelled','payable','cancelled',90000,'2026-10-01'),
  debt('receivable','receivable','open',90000,'2026-10-01'), debt('old','payable','open',45000,'2026-10-19'),
  debt('today','payable','open',35000,'2026-10-20'),debt('next','payable','open',10000,'2026-10-21')
 ]};
 const state=overview(db,actor,finance,Date.parse('2026-10-19T22:30:00Z'));
 assert.equal(state.date,'2026-10-20');assert.equal(state.finance.balance,80000);assert.equal(state.finance.accounts[1].active,false);assert.equal(state.finance.accounts[1].balance,-40000);assert.equal(state.finance.payable,90000);assert.equal(state.finance.overdueCount,1);
 assert.deepEqual(state.finance.upcoming.map(o=>o.id),['old','today','next']);
 assert.equal('finance' in overview(db,{id:'x',role:'cashier'},finance),false);
 const many={accounts:Array.from({length:6},(_,i)=>({id:String(i),balance:100,data:{name:'Счёт '+i,type:'bank',active:i<5}})),obligations:[]};
 const summary=overview(db,actor,many).finance;
 assert.equal(summary.accounts.length,4);assert.equal(summary.accountCount,6);assert.equal(summary.balance,600);
});
