import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openWorkspace,emptySheet} from './workspace/workspace-store.mjs';
import {createUnifiedData,ORG} from './unified-data.mjs';
const date='2026-10-19',password='Проверка единой кассы длинная фраза 2026';
async function fixture(t){
 const w=openWorkspace(':memory:');t.after(()=>w.close());await w.accounts.bootstrapOwner({login:'owner',name:'Владелец',password});const owner=await w.accounts.login({login:'owner',password});
 const data=createUnifiedData(w),write=(method,d)=>data.financeWrite(owner.token,{requestId:randomUUID(),orgId:ORG,method,data:d});
 const account=w.financeSave(owner.token,{kind:'account',expectedVersion:0,requestId:randomUUID(),refVersions:{},name:'Наличные',type:'cash',openingDate:'2026-10-01',openingBalance:'0',active:true});
 const employeeId=write('saveEmployee',{fullName:'Кассир 1'}).id;
 const shift=(extra={})=>({date,register:'Касса 1',shiftNum:1,employeeId,zCash:10000,zCard:0,zSbp:0,factCash:10000,factCard:0,factSbp:0,withdrawals:[],...extra});
 const cash=(register='Касса 1',shiftNo='1')=>{const input=emptySheet();Object.assign(input,{date,register,shiftNo});input.worksheet.settings.register=register;for(const row of input.worksheet.settings.rows)input.worksheet.values[row.id]=row.enabled?'0':'';Object.assign(input.worksheet.values,{cashReport:'100',received:'100'});return w.cashSave(owner.token,{requestId:randomUUID(),expectedVersion:0,accept:true,input});};
 const handover=c=>w.financeSave(owner.token,{kind:'movement',expectedVersion:0,requestId:randomUUID(),refVersions:{[account.id]:account.version},type:'cash_handover',accountId:account.id,cashId:c.id,cashVersion:c.version,amount:'100',date,purpose:'Приём кассы',evidence:'Пересчитано',confirmed:true});
 return {w,owner,data,write,account,employeeId,shift,cash,handover,state:()=>w.finance(owner.token)};
}
test('cash integration: Z-report blocks cash inflow through the direct workspace endpoint',async t=>{
 const f=await fixture(t);f.write('saveShift',f.shift());const c=f.cash();const before=f.state();assert.throws(()=>f.handover(c),/Z-отчёту/);assert.equal(f.state().accounts[0].balance,10000);assert.equal(f.state().movements.length,before.movements.length);assert.equal(f.state().cashToPost[0].posting.status,'z_report');
});
test('cash integration: posted cash blocks a later Z-report with full rollback',async t=>{
 const f=await fixture(t);f.handover(f.cash());assert.throws(()=>f.write('saveShift',f.shift()),/кассовому листу/);assert.equal(f.state().accounts[0].balance,10000);assert.equal(f.data.financeRead(f.owner.token,'shifts',new URLSearchParams()).length,0);
});
test('cash integration: another employee cannot post the same physical shift twice',async t=>{
 const f=await fixture(t);f.write('saveShift',f.shift());const employeeId=f.write('saveEmployee',{fullName:'Кассир 2'}).id;assert.throws(()=>f.write('saveShift',f.shift({employeeId})),/Z-отчёту/);assert.equal(f.state().accounts[0].balance,10000);
});
test('cash integration: equivalent whitespace, case, Unicode and leading zero shift numbers are deduplicated',async t=>{
 const f=await fixture(t);f.write('saveShift',f.shift());const c=f.cash('  КАССА   １  ','００１');assert.throws(()=>f.handover(c),/Z-отчёту/);assert.throws(()=>f.cash('Касса 1','1'),/уже сохранены/);assert.equal(f.state().accounts[0].balance,10000);
});
test('cash integration: different registers and different shifts remain independent',async t=>{
 const f=await fixture(t);f.write('saveShift',f.shift());f.handover(f.cash('Касса 2'));f.write('saveShift',f.shift({shiftNum:2}));assert.equal(f.state().accounts[0].balance,30000);assert.equal(f.state().cashConflicts.length,0);
});
test('cash integration: cancelling a Z-report allows a single cash handover',async t=>{
 const f=await fixture(t),z=f.write('saveShift',f.shift()),c=f.cash();f.write('cancelShift',{id:z.id});assert.equal(f.state().cashToPost[0].posting,null);f.handover(c);assert.equal(f.state().accounts[0].balance,10000);assert.throws(()=>f.handover(c),/уже отражена/);assert.throws(()=>f.write('saveShift',f.shift()),/кассовому листу/);
});
test('cash integration: reversed handover allows Z-report and blocks its re-entry as cash',async t=>{
 const f=await fixture(t),c=f.cash(),m=f.handover(c);f.w.financeSave(f.owner.token,{kind:'reversal',expectedVersion:0,requestId:randomUUID(),movementId:m.id,refVersions:{[m.id]:m.version},date,reason:'Ошибочная проводка перед Z-отчётом',confirmed:true});f.write('saveShift',f.shift());assert.throws(()=>f.handover(c),/Z-отчёту/);assert.equal(f.state().accounts[0].balance,10000);
});
test('cash integration: legacy Z-report without register requires review across registers',async t=>{
 const f=await fixture(t),z=f.write('saveShift',f.shift());f.w.accounts.command(f.owner.token,'finance.manage',()=>({}),(db,actor,audit)=>{const row=db.prepare("SELECT detail FROM account_events WHERE kind='unified.shift' AND subject_id=? ORDER BY sequence DESC LIMIT 1").get(z.id),value=JSON.parse(row.detail).value;delete value.register;audit('unified.shift',z.id,{value});});
 const c=f.cash('Касса 2');assert.throws(()=>f.handover(c),/старый Z-отчёт/);assert.equal(f.state().cashToPost[0].posting.status,'legacy_review');assert.throws(()=>f.write('saveShift',f.shift({register:'Касса 2'})),/старый Z-отчёт/);
});
test('cash integration: historical double posting is reported without rewriting money',async t=>{
 const f=await fixture(t);f.handover(f.cash());f.w.accounts.command(f.owner.token,'finance.manage',()=>({}),(db,actor,audit)=>audit('unified.shift',randomUUID(),{value:{date,register:'Касса 1',shift_num:1,status:'closed',movements:[]}}));const state=f.state();assert.equal(state.cashConflicts.length,1);assert.equal(state.accounts[0].balance,10000);
});
test('cash integration: new Z-reports require an explicit physical register',async t=>{
 const f=await fixture(t),d=f.shift();delete d.register;assert.throws(()=>f.write('saveShift',d));assert.equal(f.state().movements.length,0);
});

test('cash integration: normalized duplicate cash sheets from an old database cannot both create inflow',async t=>{
 const f=await fixture(t),first=f.cash(),second={id:randomUUID(),version:1};
 f.w.accounts.command(f.owner.token,'finance.manage',()=>({}),db=>{const row=db.prepare('SELECT * FROM workspace_cash WHERE id=?').get(first.id),input=JSON.parse(row.input),result=JSON.parse(row.result);input.shiftNo='01';result.shiftNo='01';db.prepare('INSERT INTO workspace_cash VALUES (?,?,?,?,?,?,?,?,?,?)').run(second.id,1,JSON.stringify([input.date,input.register.toLowerCase(),'01']),row.cashier_id,row.actor_id,row.status,row.at_ms,JSON.stringify(input),JSON.stringify(result),'');});
 f.handover(first);assert.equal(f.state().cashToPost.find(c=>c.id===second.id).posting.status,'cash_sheet');assert.throws(()=>f.handover(second),/другому кассовому листу/);assert.equal(f.state().accounts[0].balance,10000);
});
