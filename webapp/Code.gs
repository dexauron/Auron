// ═══════════════════════════════════════════════════════════════════════
//  AURON FINANCE v3.0 — Production-Ready Backend
//  Google Apps Script · Execute as: USER_ACCESSING · Access: ANYONE
// ═══════════════════════════════════════════════════════════════════════

var PROFILE_NAME  = 'Auron_Profile';
var ORG_PREFIX    = 'Auron_';
var REG_WEBHOOK   = '';   // optional: POST url for registration stats

// Sheet names
var SH_BASE      = 'БАЗА';
var SH_ACCOUNTS  = 'СЧЕТА';
var SH_SHIFTS    = 'СМЕНЫ';
var SH_DEBTS     = 'ДОЛГИ';
var SH_SETTINGS  = 'НАСТРОЙКИ';
var SH_TRASH     = 'КОРЗИНА';
var SH_TIMESHEET = 'ТАБЕЛЬ';
var SH_PROFILE   = 'ПРОФИЛЬ';
var SH_ORGS      = 'ОРГАНИЗАЦИИ';

// БАЗА columns (1-based)
var B_ID=1,B_UUID=2,B_DATE=3,B_TYPE=4,B_CAT=5,B_AMT=6,B_ACC=7,
    B_EMP=8,B_CMT=9,B_REC=10,B_ZREF=11,B_LOCK=12,B_SHIFT=13;
var B_COLS=13;

// ДОЛГИ columns
var D_ID=1,D_REP=2,D_TYPE=3,D_AMT=4,D_DATE=5,D_ACC=6,D_CMT=7,
    D_CREATED=8,D_INV=9,D_STATUS=10;
var D_COLS=10;

// ТАБЕЛЬ columns
var T_YEAR=1,T_MON=2,T_DAY=3,T_EMP=4,T_IN=5,T_OUT=6,
    T_STATUS=7,T_HRS=8,T_RATE=9,T_CMT=10;
var T_COLS=10;

// КОРЗИНА = БАЗА columns + deleted timestamp (col 14)
var TR_COLS=14;

// ─────────────────────────────────────────────────────────────────────
// doGet
// ─────────────────────────────────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Auron Finance')
    .addMetaTag('viewport','width=device-width,initial-scale=1,maximum-scale=1');
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: AUTH
// ═══════════════════════════════════════════════════════════════════════

function _props() { return PropertiesService.getUserProperties(); }

function _profileSS() {
  var id = _props().getProperty('PROFILE_SS_ID');
  if (!id) return null;
  try { return SpreadsheetApp.openById(id); } catch(e) { return null; }
}

function initUserApp() {
  try {
    var ss = _profileSS();
    if (!ss) return { isNew: true };
    var profSh = ss.getSheetByName(SH_PROFILE);
    var profile = {};
    if (profSh && profSh.getLastRow() >= 2) {
      var r = profSh.getRange(2,1,1,2).getValues()[0];
      profile = { name: String(r[0]), phone: String(r[1]) };
    }
    var orgsSh = ss.getSheetByName(SH_ORGS);
    var orgs = [];
    if (orgsSh && orgsSh.getLastRow() >= 2) {
      orgsSh.getRange(2,1,orgsSh.getLastRow()-1,3).getValues().forEach(function(r){
        if (r[0]&&r[2]) orgs.push({id:String(r[0]),name:String(r[1]),ssId:String(r[2])});
      });
    }
    return { isNew: false, profile: profile, orgs: orgs };
  } catch(e) { return { isNew: true, __error: e.message }; }
}

function registerUser(p) {
  var name=_s(p.name), phone=_s(p.phone);
  try {
    var lock = LockService.getUserLock(); lock.waitLock(10000);
    var ex = _profileSS();
    if (ex) {
      lock.releaseLock();
      var d = initUserApp();
      return { ssId:(d.orgs&&d.orgs[0])?d.orgs[0].ssId:'', orgName:(d.orgs&&d.orgs[0])?d.orgs[0].name:'' };
    }
    var ss = SpreadsheetApp.create(PROFILE_NAME);
    var sh = ss.getSheets()[0]; sh.setName(SH_PROFILE);
    sh.getRange(1,1,1,2).setValues([['Имя','Телефон']]);
    sh.appendRow([name, phone]);
    var orgsSh = ss.insertSheet(SH_ORGS);
    orgsSh.getRange(1,1,1,3).setValues([['ID','Название','SS_ID']]);
    _props().setProperty('PROFILE_SS_ID', ss.getId());
    var res = _mkOrg('Мой магазин', ss);
    lock.releaseLock();
    if (REG_WEBHOOK) {
      try { UrlFetchApp.fetch(REG_WEBHOOK,{method:'post',contentType:'application/json',
        muteHttpExceptions:true,payload:JSON.stringify({name:name,phone:phone,ts:new Date().toISOString()})}); } catch(e){}
    }
    return { ssId: res.ssId, orgName: 'Мой магазин' };
  } catch(e) { return { __error: e.message }; }
}

function createOrg(p) {
  var name = _s(p.name);
  try {
    var ss = _profileSS();
    if (!ss) return { __error: 'Профиль не найден' };
    var res = _mkOrg(name, ss);
    return { ssId: res.ssId, orgName: name };
  } catch(e) { return { __error: e.message }; }
}

function _mkOrg(name, profileSS) {
  var fn = ORG_PREFIX + name.replace(/[\/\\:*?"<>|]/g,'_');
  var orgSS = SpreadsheetApp.create(fn);
  var orgId = Utilities.getUuid();
  profileSS.getSheetByName(SH_ORGS).appendRow([orgId, name, orgSS.getId()]);
  ensureSheets(orgSS);
  // Default accounts
  orgSS.getSheetByName(SH_ACCOUNTS).getRange(2,1,3,6).setValues([
    [Utilities.getUuid(),'Наличные',0,'active','💵','#10B981'],
    [Utilities.getUuid(),'Карта',   0,'active','💳','#6366F1'],
    [Utilities.getUuid(),'СБП',     0,'active','📱','#8B5CF6']
  ]);
  return { orgId: orgId, ssId: orgSS.getId() };
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: SYSTEM
// ═══════════════════════════════════════════════════════════════════════

function ensureSheets(ss) {
  _mk(ss,SH_BASE,    ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена']);
  _mk(ss,SH_ACCOUNTS,['ID','Название','Нач_Баланс','Статус','Иконка','Цвет']);
  _mk(ss,SH_SHIFTS,  ['ID','Дата','Смена','Кассир','Rows_JSON','Wyplatas_JSON','Расхождение','Создано']);
  _mk(ss,SH_DEBTS,   ['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','Создано','Накладная','Статус']);
  _mk(ss,SH_TIMESHEET,['Год','Месяц','День','Сотрудник','Приход','Уход','Статус','Часы','Ставка','Комментарий']);
  _mk(ss,SH_SETTINGS,['Ключ','Значение']);
  _mk(ss,SH_TRASH,   ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена','Удалено']);
  var trash = ss.getSheetByName(SH_TRASH); if (trash) trash.hideSheet();
  _grow(ss,SH_BASE,   B_COLS);
  _grow(ss,SH_DEBTS,  D_COLS);
  _grow(ss,SH_TIMESHEET,T_COLS);
}

function _mk(ss, name, hdrs) {
  if (ss.getSheetByName(name)) return;
  var sh = ss.insertSheet(name);
  sh.getRange(1,1,1,hdrs.length).setValues([hdrs]).setFontWeight('bold')
    .setBackground('#1E1B4B').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

function _grow(ss, name, need) {
  var sh = ss.getSheetByName(name); if (!sh) return;
  var has = sh.getLastColumn();
  if (has < need) {
    var sh2 = ss.getSheetByName(name);
    var allHdrs = sh2.getRange(1,1,1,has).getValues()[0];
    // Re-read from definition to fill new headers
    var defs = {
      'БАЗА':    ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена'],
      'ДОЛГИ':   ['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','Создано','Накладная','Статус'],
      'ТАБЕЛЬ':  ['Год','Месяц','День','Сотрудник','Приход','Уход','Статус','Часы','Ставка','Комментарий']
    };
    var full = defs[name]; if (!full) return;
    sh.getRange(1,has+1,1,need-has).setValues([full.slice(has)])
      .setFontWeight('bold').setBackground('#1E1B4B').setFontColor('#FFFFFF');
  }
}

// Removes КОРЗИНА entries older than 30 days
function cleanTrash(p) {
  var ssId = p.ssId;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_TRASH);
    if (!sh || sh.getLastRow() < 2) return { ok:true, removed:0 };
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate()-30);
    var vals = sh.getRange(2,TR_COLS,sh.getLastRow()-1,1).getValues();
    var removed = 0;
    for (var i=vals.length-1;i>=0;i--) {
      var d = vals[i][0];
      if (d instanceof Date && d < cutoff) { sh.deleteRow(i+2); removed++; }
    }
    return { ok:true, removed:removed };
  } catch(e) { return { __error: e.message }; }
}

// Restores one entry from trash back to БАЗА
function restoreFromTrash(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(ssId);
    var trash = ss.getSheetByName(SH_TRASH);
    var base  = ss.getSheetByName(SH_BASE);
    if (!trash||trash.getLastRow()<2) { lock.releaseLock(); return { __error:'not found' }; }
    var vals = trash.getRange(2,1,trash.getLastRow()-1,TR_COLS).getValues();
    var rowNum=-1, rowData=null;
    for (var i=0;i<vals.length;i++) {
      if (String(vals[i][0])===String(id)) { rowNum=i+2; rowData=vals[i].slice(0,B_COLS); break; }
    }
    if (rowNum===-1) { lock.releaseLock(); return { __error:'not found' }; }
    base.appendRow(rowData);
    var nr=base.getLastRow();
    base.getRange(nr,B_DATE,1,1).setNumberFormat('dd.mm.yyyy');
    base.getRange(nr,B_AMT,1,1).setNumberFormat('#,##0');
    trash.deleteRow(rowNum);
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: SETTINGS
// ═══════════════════════════════════════════════════════════════════════

var SETT_DEFAULTS = {
  CATS:         JSON.stringify([]),
  CASHIERS:     JSON.stringify([]),
  PAY_TYPES:    JSON.stringify(['Наличные','Карта','СБП','Безналичный']),
  REP_STATUSES: JSON.stringify(['✅ Оплачено','❌ Не оплачено','⛔ Отменён','🔄 Перенесён','❓ Не пришёл']),
  EMPLOYEES:    JSON.stringify([]),
  SHIFTS:       JSON.stringify(['Смена 1','Смена 2','Смена 3'])
};

function getSettings(p) {
  var ssId = p&&p.ssId?p.ssId:p;
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_SETTINGS);
    var map = {};
    if (sh.getLastRow()>=2) {
      sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(function(r){
        if (r[0]) map[String(r[0])]=String(r[1]);
      });
    }
    function gj(k) {
      try { return JSON.parse(map[k]||SETT_DEFAULTS[k]||'null')||[]; }
      catch(e) { try { return JSON.parse(SETT_DEFAULTS[k])||[]; } catch(e2){return[];} }
    }
    return {
      cats:        gj('CATS'),
      cashiers:    gj('CASHIERS'),
      payTypes:    gj('PAY_TYPES'),
      repStatuses: gj('REP_STATUSES'),
      employees:   gj('EMPLOYEES'),
      shifts:      gj('SHIFTS')
    };
  } catch(e) {
    return { cats:[], cashiers:[], payTypes:['Наличные','Карта','СБП'], repStatuses:[], employees:[], shifts:[] };
  }
}

function saveSettings(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_SETTINGS);
    var save = {
      CATS:         JSON.stringify(d.cats||[]),
      CASHIERS:     JSON.stringify(d.cashiers||[]),
      PAY_TYPES:    JSON.stringify(d.payTypes||[]),
      REP_STATUSES: JSON.stringify(d.repStatuses||[]),
      EMPLOYEES:    JSON.stringify(d.employees||[]),
      SHIFTS:       JSON.stringify(d.shifts||[])
    };
    var keyRow = {};
    if (sh.getLastRow()>=2) {
      sh.getRange(2,1,sh.getLastRow()-1,1).getValues().forEach(function(r,i){
        if (r[0]) keyRow[String(r[0])]=i+2;
      });
    }
    Object.keys(save).forEach(function(k){
      if (keyRow[k]) sh.getRange(keyRow[k],2).setValue(save[k]);
      else sh.appendRow([k, save[k]]);
    });
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: ACCOUNTS
// ═══════════════════════════════════════════════════════════════════════

function getAccounts(p) {
  var ssId = p&&p.ssId?p.ssId:p;
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var accSh = ss.getSheetByName(SH_ACCOUNTS);
    var baseSh = ss.getSheetByName(SH_BASE);
    var accounts = [];
    if (accSh.getLastRow()>=2) {
      accSh.getRange(2,1,accSh.getLastRow()-1,6).getValues().forEach(function(r){
        if (r[0]&&String(r[3])!=='archived')
          accounts.push({id:String(r[0]),name:String(r[1]),startBalance:parseFloat(r[2])||0,icon:String(r[4]),color:String(r[5])});
      });
    }
    var bals = {};
    accounts.forEach(function(a){ bals[a.name]=a.startBalance; });
    if (baseSh.getLastRow()>=2) {
      baseSh.getRange(2,1,baseSh.getLastRow()-1,B_COLS).getValues().forEach(function(r){
        var t=String(r[B_TYPE-1]),amt=parseFloat(r[B_AMT-1])||0,acc=String(r[B_ACC-1]);
        if (!bals.hasOwnProperty(acc)) bals[acc]=0;
        if (t==='Доход') bals[acc]+=amt; else if (t==='Расход') bals[acc]-=amt;
      });
    }
    accounts.forEach(function(a){ a.balance=Math.round(bals[a.name]||0); });
    return accounts;
  } catch(e) { return []; }
}

function saveAccount(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_ACCOUNTS);
    var id=d.id||Utilities.getUuid();
    var row=[id,_s(d.name),parseFloat(d.startBalance)||0,'active',d.icon||'💰',d.color||'#6366F1'];
    if (d.id&&sh.getLastRow()>=2) {
      var vs=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
      for (var i=0;i<vs.length;i++) {
        if (String(vs[i][0])===String(d.id)) { sh.getRange(i+2,1,1,6).setValues([row]); return {ok:true}; }
      }
    }
    sh.appendRow(row);
    return {ok:true};
  } catch(e) { return {__error:e.message}; }
}

function deleteAccount(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_ACCOUNTS);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (var i=0;i<vs.length;i++) {
      if (String(vs[i][0])===String(id)) { sh.getRange(i+2,4).setValue('archived'); return {ok:true}; }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

// Manual balance correction — writes a Корректировка entry
function adjustBalance(p) {
  var ssId=p.ssId, d=p.data||{};
  var amt=Math.round(parseFloat(d.amount)||0);
  if (!amt) return {__error:'Сумма не указана'};
  return saveQuickEntry({ssId:ssId, data:{
    uuid:Utilities.getUuid(), date:new Date().toISOString(),
    type:amt>0?'Доход':'Расход', category:'Корректировка',
    account:_s(d.account), amount:Math.abs(amt), comment:_s(d.comment||'Корректировка баланса')
  }});
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════

function saveQuickEntry(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var uid=d.uuid||Utilities.getUuid();
    // Idempotency check
    if (d.uuid&&base.getLastRow()>=2) {
      var ex=base.getRange(2,B_UUID,base.getLastRow()-1,1).getValues();
      for (var i=0;i<ex.length;i++) {
        if (String(ex[i][0])===String(d.uuid)) { lock.releaseLock(); return {ok:true,duplicate:true}; }
      }
    }
    var id=Utilities.getUuid();
    var dt=d.date?new Date(d.date):new Date();
    var row=[id,uid,dt,_s(d.type),_s(d.category||''),
             Math.round(parseFloat(d.amount)||0),_s(d.account||''),_s(d.employee||''),
             _s(d.comment||''),_s(d.receiptUrl||''),d.zRef||'',d.locked?true:false,_s(d.shift||'')];
    base.appendRow(row);
    var nr=base.getLastRow();
    base.getRange(nr,B_DATE,1,1).setNumberFormat('dd.mm.yyyy');
    base.getRange(nr,B_AMT,1,1).setNumberFormat('#,##0');
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true,id:id};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

function saveTransfer(p) {
  var ssId=p.ssId, d=p.data||{};
  var ref=Utilities.getUuid();
  var r1=saveQuickEntry({ssId:ssId,data:{uuid:d.uuid+'_out',date:d.date,type:'Расход',
    category:'Перевод',account:d.account,amount:d.amount,
    comment:d.comment||('→ '+d.toAccount),zRef:ref,shift:d.shift}});
  if (r1.__error) return r1;
  return saveQuickEntry({ssId:ssId,data:{uuid:d.uuid+'_in',date:d.date,type:'Доход',
    category:'Перевод',account:d.toAccount,amount:d.amount,
    comment:d.comment||('← '+d.account),zRef:ref,shift:d.shift}});
}

function deleteTransaction(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var trash=ss.getSheetByName(SH_TRASH);
    if (!base||base.getLastRow()<2) { lock.releaseLock(); return {__error:'not found'}; }
    var vals=base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues();
    var rowNum=-1;
    for (var i=0;i<vals.length;i++) {
      if (String(vals[i][B_ID-1])===String(id)) { rowNum=i+2; break; }
    }
    if (rowNum===-1) { lock.releaseLock(); return {__error:'not found'}; }
    var row=vals[rowNum-2];
    if (row[B_LOCK-1]===true||row[B_LOCK-1]==='true') {
      lock.releaseLock(); return {__error:'Запись заблокирована Z-отчётом'};
    }
    trash.appendRow(row.concat([new Date()]));
    base.deleteRow(rowNum);
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

function _txObj(r) {
  var d=r[B_DATE-1];
  return {
    id:String(r[B_ID-1]), date:(d instanceof Date)?d.toISOString():'',
    type:String(r[B_TYPE-1]), category:String(r[B_CAT-1]),
    account:String(r[B_ACC-1]), amount:parseFloat(r[B_AMT-1])||0,
    comment:String(r[B_CMT-1]||''), employee:String(r[B_EMP-1]||''),
    receipt:String(r[B_REC-1]||''), shift:String(r[B_SHIFT-1]||''),
    locked:r[B_LOCK-1]===true||r[B_LOCK-1]==='true'
  };
}

function getHomeSummary(p) {
  var ssId=p.ssId, period=p.period;
  try {
    var cKey='dash_'+ssId+'_'+period;
    try { var c=CacheService.getScriptCache().get(cKey); if(c) return JSON.parse(c); } catch(e){}
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var base=ss.getSheetByName(SH_BASE);
    var tz=Session.getScriptTimeZone();
    var accounts=getAccounts({ssId:ssId});
    var pd=_period(period,tz);
    var allRows=base.getLastRow()>=2?base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues():[];
    var totals={};
    accounts.forEach(function(a){totals[a.name]={income:0,expense:0};});
    allRows.forEach(function(r){
      var dt=r[B_DATE-1]; if(!(dt instanceof Date)) return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from) return; if(pd.to&&ms>pd.to) return;
      var t=String(r[B_TYPE-1]),amt=parseFloat(r[B_AMT-1])||0,acc=String(r[B_ACC-1]);
      if(!totals[acc]) totals[acc]={income:0,expense:0};
      if(t==='Доход') totals[acc].income+=amt; else if(t==='Расход') totals[acc].expense+=amt;
    });
    var txs=allRows.slice().reverse().slice(0,60).map(_txObj);
    var res={accounts:accounts,totals:totals,transactions:txs};
    try { CacheService.getScriptCache().put(cKey,JSON.stringify(res),60); } catch(e){}
    return res;
  } catch(e) { return {accounts:[],totals:{},transactions:[],__error:e.message}; }
}

function getAllTransactions(p) {
  var ssId=p.ssId;
  try {
    var base=SpreadsheetApp.openById(ssId).getSheetByName(SH_BASE);
    if (!base||base.getLastRow()<2) return [];
    return base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues().map(_txObj).reverse();
  } catch(e) { return []; }
}

function searchTransactions(p) {
  var ssId=p.ssId, q=String(p.query||'').toLowerCase();
  try {
    var base=SpreadsheetApp.openById(ssId).getSheetByName(SH_BASE);
    if (!base||base.getLastRow()<2) return [];
    return base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues().filter(function(r){
      return String(r[B_AMT-1]).indexOf(q)!==-1||
             String(r[B_CMT-1]).toLowerCase().indexOf(q)!==-1||
             String(r[B_CAT-1]).toLowerCase().indexOf(q)!==-1||
             String(r[B_EMP-1]).toLowerCase().indexOf(q)!==-1;
    }).map(_txObj).reverse().slice(0,50);
  } catch(e) { return []; }
}

function getTrash(p) {
  var ssId=p.ssId;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_TRASH);
    if (!sh||sh.getLastRow()<2) return [];
    var tz=Session.getScriptTimeZone();
    return sh.getRange(2,1,sh.getLastRow()-1,TR_COLS).getValues().map(function(r){
      var d=r[B_DATE-1]; var del=r[TR_COLS-1];
      return {id:String(r[B_ID-1]),date:(d instanceof Date)?d.toISOString():'',
              type:String(r[B_TYPE-1]),category:String(r[B_CAT-1]),
              amount:parseFloat(r[B_AMT-1])||0,account:String(r[B_ACC-1]),
              comment:String(r[B_CMT-1]||''),
              deletedAt:(del instanceof Date)?del.toISOString():''};
    }).reverse();
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: Z-REPORT
// ═══════════════════════════════════════════════════════════════════════

function saveKassa(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var shiftsSh=ss.getSheetByName(SH_SHIFTS);
    var dt=new Date(d.date); var zRef=Utilities.getUuid();
    var rows=d.rows||[], wyplatas=d.wyplatas||[];
    var zTotal=0, factTotal=0, baseRows=[];
    rows.forEach(function(row){
      var z=parseFloat(row.zAmount)||0, f=parseFloat(row.factAmount)||0;
      zTotal+=z; factTotal+=f;
      if (z>0) baseRows.push([Utilities.getUuid(),Utilities.getUuid(),dt,'Доход','Z-отчёт',
        Math.round(z),_s(row.account),_s(d.cashier||''),'','',zRef,true,_s(d.shift||'')]);
    });
    wyplatas.forEach(function(w){
      var amt=parseFloat(w.amount)||0; if (!amt) return;
      baseRows.push([Utilities.getUuid(),Utilities.getUuid(),dt,'Расход',_s(w.category||'Выплата'),
        Math.round(amt),_s(w.account||'Наличные'),_s(d.cashier||''),_s(w.desc||'Выплата'),'',zRef,true,_s(d.shift||'')]);
    });
    if (baseRows.length) {
      var sr=base.getLastRow()+1;
      base.getRange(sr,1,baseRows.length,B_COLS).setValues(baseRows);
      base.getRange(sr,B_DATE,baseRows.length,1).setNumberFormat('dd.mm.yyyy');
      base.getRange(sr,B_AMT,baseRows.length,1).setNumberFormat('#,##0');
    }
    shiftsSh.appendRow([zRef,dt,_s(d.shift||'1'),_s(d.cashier||''),
      JSON.stringify(rows),JSON.stringify(wyplatas),Math.round(factTotal-zTotal),new Date()]);
    shiftsSh.getRange(shiftsSh.getLastRow(),2,1,1).setNumberFormat('dd.mm.yyyy');
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true, zRef:zRef};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

function getShifts(p) {
  var ssId=p.ssId, limit=parseInt(p.limit)||50;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_SHIFTS);
    var tz=Session.getScriptTimeZone();
    if (!sh||sh.getLastRow()<2) return [];
    return sh.getRange(2,1,sh.getLastRow()-1,8).getValues().map(function(r){
      var dt=r[1];
      var rows=[]; try{rows=JSON.parse(r[4]||'[]');}catch(e){}
      var wyp=[]; try{wyp=JSON.parse(r[5]||'[]');}catch(e){}
      var rev=0; rows.forEach(function(row){rev+=parseFloat(row.zAmount)||0;});
      return {id:String(r[0]),date:(dt instanceof Date)?Utilities.formatDate(dt,tz,'yyyy-MM-dd'):'',
              shift:String(r[2]),cashier:String(r[3]),revenue:Math.round(rev),
              discrepancy:parseFloat(r[6])||0,rows:rows,wyplatas:wyp};
    }).reverse().slice(0,limit);
  } catch(e) { return []; }
}

// Cancel a shift: unlocks all related BASE entries, deletes shift row
function cancelShift(p) {
  var ssId=p.ssId, shiftId=p.shiftId;
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var shiftsSh=ss.getSheetByName(SH_SHIFTS);
    // Unlock base entries
    if (base.getLastRow()>=2) {
      var bVals=base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues();
      bVals.forEach(function(r,i){
        if (String(r[B_ZREF-1])===String(shiftId)) {
          base.getRange(i+2,B_LOCK).setValue(false);
        }
      });
    }
    // Delete shift row
    if (shiftsSh.getLastRow()>=2) {
      var sVals=shiftsSh.getRange(2,1,shiftsSh.getLastRow()-1,1).getValues();
      for (var i=sVals.length-1;i>=0;i--) {
        if (String(sVals[i][0])===String(shiftId)) { shiftsSh.deleteRow(i+2); break; }
      }
    }
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: DEBTS / REPS
// ═══════════════════════════════════════════════════════════════════════

function getDebts(p) {
  var ssId=p.ssId;
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_DEBTS);
    if (!sh||sh.getLastRow()<2) return [];
    var map={};
    sh.getRange(2,1,sh.getLastRow()-1,D_COLS).getValues().forEach(function(r){
      var rep=String(r[D_REP-1]), type=String(r[D_TYPE-1]), amt=parseFloat(r[D_AMT-1])||0;
      if (!rep) return;
      if (!map[rep]) map[rep]={id:rep,name:rep,debt:0,totalBuy:0,totalPay:0};
      var m=map[rep];
      if (type==='zakupka'||type==='начальный_долг') { m.debt+=amt; m.totalBuy+=amt; }
      else if (type==='oplata') { m.debt-=amt; m.totalPay+=amt; }
    });
    return Object.keys(map).map(function(k){
      var m=map[k];
      return {id:m.id,name:m.name,debt:Math.round(m.debt),
              totalBuy:Math.round(m.totalBuy),totalPay:Math.round(m.totalPay)};
    });
  } catch(e) { return []; }
}

function saveRep(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_DEBTS);
    if (d.initDebt&&parseFloat(d.initDebt)>0) {
      sh.appendRow([Utilities.getUuid(),_s(d.name),'начальный_долг',
        Math.round(parseFloat(d.initDebt)),new Date(),'','Начальный долг',new Date(),'','']);
    }
    return {ok:true};
  } catch(e) { return {__error:e.message}; }
}

function saveDebtEntry(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_DEBTS);
    var id=Utilities.getUuid();
    var rep=_s(d.repId), type=_s(d.type), amt=Math.round(parseFloat(d.amount)||0);
    sh.appendRow([id,rep,type,amt,new Date(),_s(d.account||''),_s(d.comment||''),
                  new Date(),_s(d.invoice||''),_s(d.status||'')]);
    sh.getRange(sh.getLastRow(),5,1,1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(sh.getLastRow(),4,1,1).setNumberFormat('#,##0');
    if (type==='oplata'&&d.account&&amt>0) {
      saveQuickEntry({ssId:ssId,data:{uuid:id,date:new Date().toISOString(),type:'Расход',
        category:'Долг ТП',account:d.account,amount:amt,comment:'Оплата долга: '+rep,zRef:id}});
    }
    return {ok:true,id:id};
  } catch(e) { return {__error:e.message}; }
}

function updateDebtEntry(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_DEBTS);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (var i=0;i<vs.length;i++) {
      if (String(vs[i][0])===String(d.id)) {
        var row=i+2;
        if (d.amount!==undefined) sh.getRange(row,D_AMT).setValue(Math.round(parseFloat(d.amount)||0));
        if (d.comment!==undefined) sh.getRange(row,D_CMT).setValue(_s(d.comment));
        if (d.invoice!==undefined) sh.getRange(row,D_INV).setValue(_s(d.invoice));
        if (d.status!==undefined) sh.getRange(row,D_STATUS).setValue(_s(d.status));
        return {ok:true};
      }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

function deleteDebtEntry(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_DEBTS);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (var i=vs.length-1;i>=0;i--) {
      if (String(vs[i][0])===String(id)) { sh.deleteRow(i+2); return {ok:true}; }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

function getRepDebt(p) {
  var ssId=p.ssId, repId=String(p.repId);
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_DEBTS);
    if (!sh||sh.getLastRow()<2) return [];
    var tz=Session.getScriptTimeZone();
    return sh.getRange(2,1,sh.getLastRow()-1,D_COLS).getValues().filter(function(r){
      return String(r[D_REP-1])===repId;
    }).map(function(r){
      var dt=r[D_DATE-1];
      return {id:String(r[D_ID-1]),type:String(r[D_TYPE-1]),amount:parseFloat(r[D_AMT-1])||0,
              date:(dt instanceof Date)?Utilities.formatDate(dt,tz,'yyyy-MM-dd'):'',
              account:String(r[D_ACC-1]),comment:String(r[D_CMT-1]||''),
              invoice:String(r[D_INV-1]||''),status:String(r[D_STATUS-1]||'')};
    }).reverse();
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: TIMESHEET
// ═══════════════════════════════════════════════════════════════════════

function getTimesheetMonth(p) {
  var ssId=p.ssId, year=parseInt(p.year), month=parseInt(p.month);
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_TIMESHEET);
    var sett=getSettings({ssId:ssId});
    var empList=sett.employees||[];
    var summaryMap={};
    // Seed from employees list
    empList.forEach(function(e){
      var n=typeof e==='object'?e.name:e;
      summaryMap[n]={employee:n,daysP:0,daysO:0,daysB:0,daysOt:0,daysV:0,totalHours:0,totalSalary:0};
    });
    if (!empList.length) {
      (sett.cashiers||[]).forEach(function(c){
        summaryMap[c]={employee:c,daysP:0,daysO:0,daysB:0,daysOt:0,daysV:0,totalHours:0,totalSalary:0};
      });
    }
    var days=[];
    if (sh.getLastRow()>=2) {
      var cols=Math.min(sh.getLastColumn(),T_COLS);
      sh.getRange(2,1,sh.getLastRow()-1,cols).getValues().forEach(function(r){
        var y=parseInt(r[T_YEAR-1]),m=parseInt(r[T_MON-1]),d=parseInt(r[T_DAY-1]),emp=String(r[T_EMP-1]);
        if (y!==year||m!==month||!d||!emp) return;
        var timeIn=String(r[T_IN-1]||''),timeOut=String(r[T_OUT-1]||'');
        var status=String(r[T_STATUS-1]||'П'),hours=parseFloat(r[T_HRS-1])||0;
        var rate=parseFloat(r[T_RATE-1])||0,cmt=String(r[T_CMT-1]||'');
        days.push({day:d,employee:emp,timeIn:timeIn,timeOut:timeOut,status:status,hours:hours,rate:rate,comment:cmt});
        if (!summaryMap[emp]) summaryMap[emp]={employee:emp,daysP:0,daysO:0,daysB:0,daysOt:0,daysV:0,totalHours:0,totalSalary:0};
        var s=summaryMap[emp];
        if (status==='П') s.daysP++; else if (status==='О') s.daysO++;
        else if (status==='Б') s.daysB++; else if (status==='Отп') s.daysOt++;
        else if (status==='В') s.daysV++;
        s.totalHours+=hours; s.totalSalary+=rate;
      });
    }
    var summary=Object.keys(summaryMap).map(function(k){return summaryMap[k];});
    return {days:days,summary:summary,employees:empList};
  } catch(e) { return {days:[],summary:[],employees:[]}; }
}

function saveTimesheetEntry(p) {
  var ssId=p.ssId,year=parseInt(p.year),month=parseInt(p.month),day=parseInt(p.day);
  var emp=_s(p.employee||''),timeIn=_s(p.timeIn||''),timeOut=_s(p.timeOut||'');
  var status=_s(p.status||'П'),hours=parseFloat(p.hours)||0,rate=parseFloat(p.rate)||0,cmt=_s(p.comment||'');
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_TIMESHEET);
    var rowNum=-1;
    if (sh.getLastRow()>=2) {
      var vs=sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
      for (var i=0;i<vs.length;i++) {
        if (parseInt(vs[i][0])===year&&parseInt(vs[i][1])===month&&parseInt(vs[i][2])===day) {rowNum=i+2;break;}
      }
    }
    if (!emp) { if (rowNum>0) sh.deleteRow(rowNum); return {ok:true}; }
    var row=[year,month,day,emp,timeIn,timeOut,status,hours,rate,cmt];
    if (rowNum>0) sh.getRange(rowNum,1,1,T_COLS).setValues([row]);
    else sh.appendRow(row);
    return {ok:true};
  } catch(e) { return {__error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════

function getAnalytics(p) {
  var ssId=p.ssId, period=p.period;
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var tz=Session.getScriptTimeZone();
    if (!base||base.getLastRow()<2) return {income:0,expense:0,byCategory:[],timeline:[],heatmap:_emptyHm(),totalDebt:0};
    var pd=_period(period,tz);
    var rows=base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues();
    var income=0,expense=0,catMap={},dayMap={};
    var hm=[0,0,0,0,0,0,0]; // Mon-Sun
    rows.forEach(function(r){
      var dt=r[B_DATE-1]; if(!(dt instanceof Date)) return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from) return; if(pd.to&&ms>pd.to) return;
      var t=String(r[B_TYPE-1]),cat=String(r[B_CAT-1]),amt=parseFloat(r[B_AMT-1])||0;
      var dk=Utilities.formatDate(dt,tz,'yyyy-MM-dd');
      if(!dayMap[dk]) dayMap[dk]={income:0,expense:0};
      if (t==='Доход') {
        income+=amt; dayMap[dk].income+=amt;
        var dow=dt.getDay(); hm[dow===0?6:dow-1]+=amt;
        if(cat!=='Перевод'){if(!catMap[cat])catMap[cat]={total:0,type:'income'};catMap[cat].total+=amt;}
      } else if (t==='Расход') {
        expense+=amt; dayMap[dk].expense+=amt;
        if(cat!=='Перевод'){if(!catMap[cat])catMap[cat]={total:0,type:'expense'};catMap[cat].total+=amt;}
      }
    });
    var byCategory=Object.keys(catMap).map(function(k){
      return{category:k,total:Math.round(catMap[k].total),type:catMap[k].type};
    }).sort(function(a,b){return b.total-a.total;});
    var timeline=Object.keys(dayMap).sort().map(function(dk){
      var p2=dk.split('-');var label=parseInt(p2[2])+'.'+parseInt(p2[1]);
      return{label:label,income:Math.round(dayMap[dk].income),expense:Math.round(dayMap[dk].expense)};
    });
    var heatmap=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(function(d,i){return{dow:i+1,label:d,amount:Math.round(hm[i])};});
    var totalDebt=0;
    try{getDebts({ssId:ssId}).forEach(function(d){if(d.debt>0)totalDebt+=d.debt;});}catch(e){}
    return {income:Math.round(income),expense:Math.round(expense),byCategory:byCategory,
            timeline:timeline,heatmap:heatmap,totalDebt:Math.round(totalDebt)};
  } catch(e) { return {income:0,expense:0,byCategory:[],timeline:[],heatmap:_emptyHm(),totalDebt:0}; }
}

function _emptyHm() {
  return ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(function(d,i){return{dow:i+1,label:d,amount:0};});
}

// Returns {current, previous} period comparison
function getTrendData(p) {
  var ssId=p.ssId;
  try {
    var cur=getAnalytics({ssId:ssId,period:'month'});
    var prev=getAnalytics({ssId:ssId,period:'prev_month'});
    function pct(a,b){ if(!b) return a>0?100:0; return Math.round((a-b)/b*100); }
    return {
      income:cur.income,prevIncome:prev.income,incomeChange:pct(cur.income,prev.income),
      expense:cur.expense,prevExpense:prev.expense,expenseChange:pct(cur.expense,prev.expense),
      profit:cur.income-cur.expense,prevProfit:prev.income-prev.expense,
      profitChange:pct(cur.income-cur.expense,Math.abs(prev.income-prev.expense))
    };
  } catch(e) { return {}; }
}

function getCashierAnalytics(p) {
  var ssId=p.ssId, period=p.period;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_SHIFTS);
    var tz=Session.getScriptTimeZone();
    if (!sh||sh.getLastRow()<2) return {list:[]};
    var pd=_period(period,tz);
    var map={};
    sh.getRange(2,1,sh.getLastRow()-1,8).getValues().forEach(function(r){
      var dt=r[1]; if(!(dt instanceof Date)) return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from) return; if(pd.to&&ms>pd.to) return;
      var cashier=String(r[3]); if(!cashier) return;
      var rj=[]; try{rj=JSON.parse(r[4]||'[]');}catch(e){}
      var rev=0; rj.forEach(function(row){rev+=parseFloat(row.zAmount)||0;});
      var disc=parseFloat(r[6])||0;
      if(!map[cashier]) map[cashier]={name:cashier,shifts:0,revenue:0,discrepancy:0};
      map[cashier].shifts++; map[cashier].revenue+=rev; map[cashier].discrepancy+=disc;
    });
    return {list:Object.keys(map).map(function(k){
      var c=map[k];
      return {name:c.name,shifts:c.shifts,revenue:Math.round(c.revenue),discrepancy:Math.round(c.discrepancy)};
    }).sort(function(a,b){return b.revenue-a.revenue;})};
  } catch(e) { return {list:[]}; }
}

function getCashierShifts(p) {
  var ssId=p.ssId, cashier=String(p.cashier||'');
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_SHIFTS);
    var tz=Session.getScriptTimeZone();
    if (!sh||sh.getLastRow()<2) return [];
    return sh.getRange(2,1,sh.getLastRow()-1,8).getValues().filter(function(r){
      return String(r[3])===cashier;
    }).map(function(r){
      var dt=r[1];
      var rj=[]; try{rj=JSON.parse(r[4]||'[]');}catch(e){}
      var rev=0; rj.forEach(function(row){rev+=parseFloat(row.zAmount)||0;});
      return {id:String(r[0]),date:(dt instanceof Date)?Utilities.formatDate(dt,tz,'yyyy-MM-dd'):'',
              shift:String(r[2]),revenue:Math.round(rev),discrepancy:parseFloat(r[6])||0};
    }).reverse();
  } catch(e) { return []; }
}

function getDebtAnalytics(p) {
  var ssId=p.ssId;
  try {
    var debts=getDebts({ssId:ssId});
    var totalDebt=0, totalBuy=0, totalPay=0;
    debts.forEach(function(d){ totalDebt+=d.debt; totalBuy+=d.totalBuy; totalPay+=d.totalPay; });
    var topReps=debts.filter(function(d){return d.debt>0;})
      .sort(function(a,b){return b.debt-a.debt;}).slice(0,5);
    return {totalDebt:Math.round(totalDebt),totalBuy:Math.round(totalBuy),totalPay:Math.round(totalPay),
            count:debts.length,topReps:topReps};
  } catch(e) { return {totalDebt:0,totalBuy:0,totalPay:0,count:0,topReps:[]}; }
}

// Pay employee salary — creates expense entry and optionally logs to timesheet
function payEmployeeSalary(p) {
  var ssId=p.ssId, d=p.data||{};
  return saveQuickEntry({ssId:ssId, data:{
    uuid:Utilities.getUuid(), date:d.date||new Date().toISOString(),
    type:'Расход', category:'ЗП', account:_s(d.account),
    amount:Math.round(parseFloat(d.amount)||0),
    employee:_s(d.employee), comment:_s(d.comment||('ЗП: '+d.employee))
  }});
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function _period(period, tz) {
  var now=new Date(), today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var from=null, to=null;
  if (period==='today') { from=today.getTime(); to=today.getTime()+86399999; }
  else if (period==='week') {
    var mon=new Date(today); mon.setDate(today.getDate()-((today.getDay()+6)%7));
    from=mon.getTime(); to=now.getTime();
  }
  else if (period==='month') { from=new Date(today.getFullYear(),today.getMonth(),1).getTime(); to=now.getTime(); }
  else if (period==='prev_month') {
    var pm=new Date(today.getFullYear(),today.getMonth()-1,1);
    from=pm.getTime(); to=new Date(today.getFullYear(),today.getMonth(),0,23,59,59,999).getTime();
  }
  else if (period==='year') { from=new Date(today.getFullYear(),0,1).getTime(); to=now.getTime(); }
  return {from:from,to:to};
}

function _s(v) { return String(v||'').replace(/[<>"'`]/g,'').trim().slice(0,500); }
