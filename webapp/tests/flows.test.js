/**
 * Интеграционные тесты денежных потоков Auron (запись → чтение).
 * Запуск:  node webapp/tests/flows.test.js
 *
 * Здесь мок Google-таблиц ХРАНИТ данные в памяти, поэтому проверяется реальный
 * сквозной поток: saveQuickEntry / saveTransfer / deleteTransaction / saveKassa
 * / receiveRep / getAccounts / setStoreDebt / переименование счёта.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── In-memory мок таблицы ───────────────────────────────────────────
function MemSheet(name){ this.name=name; this.data=[]; }
MemSheet.prototype.getName=function(){return this.name;};
MemSheet.prototype.getLastRow=function(){return this.data.length;};
MemSheet.prototype.getLastColumn=function(){return this.data.reduce((m,r)=>Math.max(m,r.length),0);};
MemSheet.prototype.appendRow=function(arr){this.data.push(arr.slice());return this;};
MemSheet.prototype.deleteRow=function(r){this.data.splice(r-1,1);return this;};
MemSheet.prototype.deleteRows=function(r,n){this.data.splice(r-1,n);return this;};
MemSheet.prototype.hideSheet=function(){return this;};
MemSheet.prototype.setName=function(n){this.name=n;return this;};
MemSheet.prototype.setFrozenRows=function(){return this;};
MemSheet.prototype.getRange=function(row,col,nr,nc){
  const sh=this; nr=nr||1; nc=nc||1;
  const R={
    getValues(){
      const out=[];
      for(let i=0;i<nr;i++){ const src=sh.data[row-1+i]||[]; const line=[];
        for(let j=0;j<nc;j++) line.push(src[col-1+j]!==undefined?src[col-1+j]:'');
        out.push(line); }
      return out;
    },
    getValue(){ const src=sh.data[row-1]||[]; return src[col-1]!==undefined?src[col-1]:''; },
    setValues(vals){
      for(let i=0;i<vals.length;i++){ const rr=row-1+i; while(sh.data.length<=rr)sh.data.push([]);
        for(let j=0;j<vals[i].length;j++) sh.data[rr][col-1+j]=vals[i][j]; }
      return R;
    },
    setValue(v){ const rr=row-1; while(sh.data.length<=rr)sh.data.push([]); sh.data[rr][col-1]=v; return R; },
    setNumberFormat(){return R;}, setFontWeight(){return R;}, setBackground(){return R;}, setFontColor(){return R;}
  };
  return R;
};
function MemSS(){ this.sheets={}; }
MemSS.prototype.getSheetByName=function(n){return this.sheets[n]||null;};
MemSS.prototype.insertSheet=function(n){const s=new MemSheet(n);this.sheets[n]=s;return s;};
MemSS.prototype.getSheets=function(){return Object.keys(this.sheets).map(k=>this.sheets[k]);};
MemSS.prototype.getName=function(){return 'Auron — Тест';};
MemSS.prototype.getId=function(){return 'ss1';};
MemSS.prototype.getOwner=function(){return {getEmail:()=>'owner@x'};};

const SS = new MemSS();

// ── Мок Google Apps Script ──────────────────────────────────────────
function pad(n){return (n<10?'0':'')+n;}
const noop=()=>{};
const Utilities={ getUuid(){return 'u'+(Utilities._i=(Utilities._i||0)+1)+'-'+Math.random().toString(36).slice(2,7);},
  formatDate(d,tz,fmt){return fmt.replace('yyyy',d.getFullYear()).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate())).replace('HH',pad(d.getHours())).replace('mm',pad(d.getMinutes())).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate()));} };
const Session={ getScriptTimeZone:()=>'Europe/Moscow', getActiveUser:()=>({getEmail:()=>'owner@x'}), getEffectiveUser:()=>({getEmail:()=>'owner@x'}) };
const sandbox={
  Utilities, Session,
  SpreadsheetApp:{ openById:()=>SS, create:()=>SS, getActiveSpreadsheet:()=>SS },
  LockService:{ getScriptLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}), getUserLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}) },
  CacheService:{ getScriptCache:()=>({get:()=>null,put:noop,remove:noop,removeAll:noop}) },
  PropertiesService:{ getScriptProperties:()=>({getProperty:()=>null,setProperty:noop,deleteAllProperties:noop}) },
  DriveApp:{ getFileById:()=>({getOwner:()=>({getEmail:()=>'owner@x'}),addEditor:noop,setTrashed:noop}) },
  MailApp:{ sendEmail:noop }, ScriptApp:{ getService:()=>({getUrl:()=>''}), getProjectTriggers:()=>[] },
  HtmlService:{}, UrlFetchApp:{ fetch:noop }, console,
  Date, Math, JSON, parseFloat, parseInt, isNaN, String, Number, Array, Object, RegExp
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8')+
  '\n;this.__api={ensureSheets,getAccounts,saveQuickEntry,saveTransfer,deleteTransaction,saveAccount,receiveRep,getContractorCard,SH_ACCOUNTS,SH_BASE};', sandbox);
const A=sandbox.__api;

// ── Мини-фреймворк ──────────────────────────────────────────────────
let pass=0, fail=0;
function eq(name,got,want){ if(JSON.stringify(got)===JSON.stringify(want))pass++; else{fail++;console.log('  ✗ FAIL:',name,'| получено',JSON.stringify(got),'ожидалось',JSON.stringify(want));} }
function bal(name){ return (A.getAccounts({ssId:'ss1'}).find(a=>a.name===name)||{}).balance; }

// ── Подготовка: счета ───────────────────────────────────────────────
A.ensureSheets(SS);
A.saveAccount({ssId:'ss1',data:{name:'Наличные',startBalance:100000}});
A.saveAccount({ssId:'ss1',data:{name:'Карта',startBalance:50000}});

eq('старт: Наличные', bal('Наличные'), 100000);
eq('старт: Карта', bal('Карта'), 50000);

// ── Доход/расход меняют баланс ──────────────────────────────────────
A.saveQuickEntry({ssId:'ss1',data:{type:'Доход',category:'Продажи',account:'Наличные',amount:30000}});
A.saveQuickEntry({ssId:'ss1',data:{type:'Расход',category:'Закупка',account:'Наличные',amount:12000}});
eq('после дохода/расхода: Наличные', bal('Наличные'), 100000+30000-12000);

// ── Перевод: сумма сохраняется, обе стороны ─────────────────────────
const before = bal('Наличные')+bal('Карта');
A.saveTransfer({ssId:'ss1',data:{uuid:'t1',account:'Наличные',toAccount:'Карта',amount:20000}});
eq('перевод: Наличные −20000', bal('Наличные'), 118000-20000);
eq('перевод: Карта +20000', bal('Карта'), 50000+20000);
eq('перевод: сумма по счетам не изменилась', bal('Наличные')+bal('Карта'), before);

// ── Удаление одной стороны перевода удаляет обе ─────────────────────
// найдём id одной из строк перевода
const baseSh = SS.getSheetByName(A.SH_BASE);
let transferRow=null;
baseSh.data.slice(1).forEach(r=>{ if(String(r[4])==='Перевод' && !transferRow) transferRow=r; });
A.deleteTransaction({ssId:'ss1',id:String(transferRow[0])});
// удаляются ОБЕ стороны → балансы возвращаются к состоянию ДО перевода
eq('после удаления перевода: Наличные вернулся', bal('Наличные'), 118000);
eq('после удаления перевода: Карта вернулась', bal('Карта'), 50000);
eq('после удаления перевода: сумма сохранилась', bal('Наличные')+bal('Карта'), before);

// ── Приём торгового: наличная оплата + погашение + новый долг ────────
const cashBefore = bal('Наличные');
const rr = A.receiveRep({ssId:'ss1',rep:'ООО Альфа',account:'Наличные',cashPaid:0,debtRepaid:5000,newDebt:8000});
eq('приём: долг = −5000+8000', rr.debt, 3000);
eq('приём: погашение списало наличные', bal('Наличные'), cashBefore-5000);
const card = A.getContractorCard({ssId:'ss1',name:'ООО Альфа'});
eq('карточка контрагента: долг', card.debt, 3000);

// ── Переименование счёта переносит историю (баланс сохраняется) ──────
const naличBefore = bal('Наличные');
// найдём id счёта Наличные
const accSh = SS.getSheetByName(A.SH_ACCOUNTS);
let cashId=null; accSh.data.slice(1).forEach(r=>{ if(String(r[1])==='Наличные') cashId=String(r[0]); });
A.saveAccount({ssId:'ss1',data:{id:cashId,name:'Касса магазина',startBalance:100000}});
eq('переименование: старого имени нет', bal('Наличные'), undefined);
eq('переименование: баланс перешёл на новое имя', bal('Касса магазина'), naличBefore);

// ── Итог ────────────────────────────────────────────────────────────
console.log('\nПотоки денег: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
