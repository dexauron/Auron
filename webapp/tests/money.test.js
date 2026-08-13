/**
 * Юнит-тесты денежной математики Auron.
 * Запуск:  node webapp/tests/money.test.js
 *
 * Идея: грузим реальный Code.gs в песочницу с мок-заглушками Google-сервисов
 * и проверяем ЧИСТЫЕ функции расчётов (без обращения к таблицам):
 *   _sliceMetrics — ядро дневного/месячного отчёта (доход/расход/долги/зРев)
 *   _gnum         — разбор чисел из 1С (русский формат)
 *   _parseDate    — разбор дат
 *   reconcileDiff — формула сверки кассы (проверяем инвариант)
 *
 * Тесты не трогают продакшн-код и не требуют интернета.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Мок Google Apps Script ──────────────────────────────────────────
function pad(n){return (n<10?'0':'')+n;}
const Utilities = {
  getUuid(){ return 'uuid-'+Math.random().toString(36).slice(2); },
  // Поддерживаем шаблоны, которые реально используются в расчётах
  formatDate(d, tz, fmt){
    const Y=d.getFullYear(), M=pad(d.getMonth()+1), D=pad(d.getDate());
    const h=pad(d.getHours()), m=pad(d.getMinutes());
    return fmt
      .replace('yyyy',Y).replace('MM',M).replace('dd',D)
      .replace('HH',h).replace('mm',m)
      .replace('MM',M).replace('dd',D); // на случай 'dd.MM'
  }
};
const Session = { getScriptTimeZone(){ return 'Europe/Moscow'; },
  getActiveUser(){ return {getEmail(){return 'test@x';}}; },
  getEffectiveUser(){ return {getEmail(){return 'test@x';}}; } };
const noop = ()=>{};
const stubSheet = { getLastRow:()=>0, getRange:()=>({getValues:()=>[],setValues:noop,setValue:noop,setNumberFormat:noop}),
  appendRow:noop, deleteRow:noop, getName:()=>'', hideSheet:noop, getLastColumn:()=>0, insertSheet:()=>stubSheet, setName:noop };
const stubSS = { getSheetByName:()=>stubSheet, getName:()=>'org', getId:()=>'id', insertSheet:()=>stubSheet,
  getSheets:()=>[stubSheet], getOwner:()=>({getEmail:()=>'test@x'}) };
const sandbox = {
  Utilities, Session,
  SpreadsheetApp:{ openById:()=>stubSS, create:()=>stubSS, getActiveSpreadsheet:()=>stubSS },
  LockService:{ getScriptLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}),
                getUserLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}) },
  CacheService:{ getScriptCache:()=>({get:()=>null,put:noop,remove:noop,removeAll:noop}) },
  PropertiesService:{ getScriptProperties:()=>({getProperty:()=>null,setProperty:noop,deleteAllProperties:noop}) },
  DriveApp:{ getFileById:()=>({getOwner:()=>({getEmail:()=>'test@x'}),addEditor:noop,setTrashed:noop}) },
  MailApp:{ sendEmail:noop }, ScriptApp:{ getService:()=>({getUrl:()=>''}), getProjectTriggers:()=>[] },
  HtmlService:{}, UrlFetchApp:{ fetch:noop }, console,
  // делим один и тот же Date с песочницей, иначе `dt instanceof Date` ложно
  Date, Math, JSON, parseFloat, parseInt, isNaN, String, Number, Array, Object, RegExp
};
vm.createContext(sandbox);
const code = fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
vm.runInContext(code + '\n;this.__api={_sliceMetrics,_gnum,_parseDate,B_ID,B_DATE,B_TYPE,B_CAT,B_AMT,B_ACC};', sandbox);
const A = sandbox.__api;

// ── Мини-фреймворк ──────────────────────────────────────────────────
let pass=0, fail=0;
function eq(name, got, want){
  const g=JSON.stringify(got), w=JSON.stringify(want);
  if(g===w){pass++; /*console.log('  ok', name);*/}
  else{fail++; console.log('  ✗ FAIL:', name, '\n      получено:', g, '\n      ожидалось:', w);}
}
function approx(name, got, want){ eq(name, Math.round(got), Math.round(want)); }

// helper: строка БАЗЫ
function row({date,type,cat,amt,acc='Наличные'}){
  const r=new Array(13).fill('');
  r[A.B_ID-1]='id'; r[A.B_DATE-1]=date; r[A.B_TYPE-1]=type; r[A.B_CAT-1]=cat; r[A.B_AMT-1]=amt; r[A.B_ACC-1]=acc;
  return r;
}

// ── Тесты: _gnum (разбор чисел 1С) ──────────────────────────────────
eq('_gnum целое', A._gnum('1234'), 1234);
eq('_gnum с пробелом-разрядом', A._gnum('1 234'), 1234);
eq('_gnum русская запятая', A._gnum('1234,56'), 1234.56);
eq('_gnum пробел+запятая', A._gnum('1 234,56'), 1234.56);
eq('_gnum рубли-символ', A._gnum('1 234,56 ₽'), 1234.56);
eq('_gnum пусто', A._gnum(''), 0);
eq('_gnum число', A._gnum(4200), 4200);

// ── Тесты: _parseDate ───────────────────────────────────────────────
eq('_parseDate dd.mm.yyyy', A._parseDate('05.03.2026').getTime(), new Date(2026,2,5).getTime());
eq('_parseDate yyyy-mm-dd', A._parseDate('2026-03-05').getTime(), new Date(2026,2,5).getTime());
eq('_parseDate dd.mm.yy', A._parseDate('05.03.26').getTime(), new Date(2026,2,5).getTime());
eq('_parseDate мусор', A._parseDate('не дата'), null);

// ── Тесты: _sliceMetrics (ядро отчётов) ─────────────────────────────
const d = new Date(2026,5,10,12,0,0);
const from = new Date(2026,5,10,0,0,0).getTime();
const to   = new Date(2026,5,10,23,59,59).getTime();
const rows = [
  row({date:d, type:'Доход',  cat:'Продажи',  amt:100000}),
  row({date:d, type:'Доход',  cat:'Z-отчёт',  amt:5000}),
  row({date:d, type:'Расход', cat:'Закупка',  amt:45000}),
  row({date:d, type:'Расход', cat:'ЗП',       amt:20000}),
  row({date:d, type:'Расход', cat:'Изъятие владельца', amt:30000}),
  row({date:d, type:'Расход', cat:'Долг ТП',  amt:15000}),
  // переводы между счетами — НЕ должны попасть в доход/расход
  row({date:d, type:'Доход',  cat:'Перевод',  amt:70000}),
  row({date:d, type:'Расход', cat:'Перевод',  amt:70000}),
  // вне периода — игнор
  row({date:new Date(2026,5,9,12,0), type:'Доход', cat:'Продажи', amt:999999}),
];
const m = A._sliceMetrics(rows, from, to);
approx('slice: доход без переводов', m.income, 105000);
approx('slice: расход без переводов', m.expense, 110000);
approx('slice: zРевеню (Z+Продажи)', m.zRevenue, 105000);
approx('slice: изъятия', m.izyatia, 30000);
approx('slice: закупка', m.zakupka, 45000);
approx('slice: ЗП', m.zp, 20000);
approx('slice: долг ТП', m.dolgTP, 15000);
eq('slice: число операций (без переводов)', m.txCount, 6);
approx('slice: прибыль = доход−расход', m.income-m.expense, -5000);

// ── Тест: инвариант сверки кассы ────────────────────────────────────
// reconDiff = (забрал + оплатил поставщикам + оставил) − выручка
function reconDiff(collect, supp, left, rev){ return (collect+supp+left)-rev; }
eq('сверка: сходится', reconDiff(80000,15000,5000,100000), 0);
eq('сверка: недостача (<0)', reconDiff(70000,15000,5000,100000), -10000);
eq('сверка: излишек (>0)', reconDiff(90000,15000,5000,100000), 10000);

// ── Тест: пересчёт долга представителя (zakupka +, oplata −) ────────
function repDebt(entries){ return entries.reduce((s,e)=> s + (e.type==='oplata'?-1:1)*e.amt, 0); }
eq('долг: начальный + закупка', repDebt([{type:'zakupka',amt:100},{type:'zakupka',amt:50}]), 150);
eq('долг: с погашением', repDebt([{type:'zakupka',amt:100},{type:'oplata',amt:30}]), 70);
eq('долг: приём торгового (100 −30 +50)', repDebt([{type:'zakupka',amt:100},{type:'oplata',amt:30},{type:'zakupka',amt:50}]), 120);

// ── Итог ────────────────────────────────────────────────────────────
console.log('\nДенежная математика: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
