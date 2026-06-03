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
var SH_RECURRING = 'РЕКУРРЕНТНЫЕ';
var SH_PAYMENTS  = 'ВЫПЛАТЫ';

// РЕКУРРЕНТНЫЕ columns
var RC_ID=1,RC_NAME=2,RC_CAT=3,RC_AMT=4,RC_ACC=5,RC_DAY=6,RC_ACTIVE=7,RC_CREATED=8;
var RC_COLS=8;

// ВЫПЛАТЫ columns (PY_NAME=payee, PY_CAT=title, PY_ACC=comment, PY_PAID=amount paid so far)
var PY_ID=1,PY_NAME=2,PY_AMT=3,PY_ACC=4,PY_DUE=5,PY_STATUS=6,PY_CAT=7,PY_CREATED=8,PY_PAID=9;
var PY_COLS=9;

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
  var name=_s(p.name), phone=_s(p.phone), orgName0=_s(p.orgName||'')||'Мой магазин';
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
    var res = _mkOrg(orgName0, ss);
    lock.releaseLock();
    if (REG_WEBHOOK) {
      try { UrlFetchApp.fetch(REG_WEBHOOK,{method:'post',contentType:'application/json',
        muteHttpExceptions:true,payload:JSON.stringify({name:name,phone:phone,ts:new Date().toISOString()})}); } catch(e){}
    }
    return { ssId: res.ssId, orgName: orgName0 };
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

function deleteOrg(p) {
  var ssId = _s(p.ssId);
  if (!ssId) return { __error: 'ssId обязателен' };
  try {
    var profileSS = _profileSS();
    if (!profileSS) return { __error: 'Профиль не найден' };
    var orgsSh = profileSS.getSheetByName(SH_ORGS);
    if (!orgsSh) return { __error: 'Список организаций не найден' };
    var data = orgsSh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][2]) === ssId) {
        orgsSh.deleteRow(i + 1);
        if (p.trash) {
          try { DriveApp.getFileById(ssId).setTrashed(true); } catch(e2) {}
        }
        return { ok: true };
      }
    }
    return { __error: 'Организация не найдена в профиле' };
  } catch(e) { return { __error: e.message }; }
}

function logoutUser() {
  try { _props().deleteAllProperties(); } catch(e) {}
  return { ok: true };
}

function uploadReceipt(p) {
  var ssId=p.ssId, base64=p.base64, fileName=p.name||'photo.jpg', mime=p.mimeType||'image/jpeg';
  try {
    var folders=DriveApp.getFoldersByName('Auron_Receipts');
    var folder=folders.hasNext()?folders.next():DriveApp.createFolder('Auron_Receipts');
    var blob=Utilities.newBlob(Utilities.base64Decode(base64),mime,fileName);
    var file=folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    return {ok:true,viewUrl:'https://drive.google.com/file/d/'+file.getId()+'/view'};
  } catch(e){return{__error:e.message};}
}

function exportTransactions(p) {
  var ssId=p.ssId, period=p.period||'month';
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_BASE);
    if(!sh||sh.getLastRow()<2) return {csv:'Дата;Тип;Категория;Сумма;Счёт;Сотрудник;Комментарий\n'};
    var tz=Session.getScriptTimeZone();
    var pd=_period(period,tz);
    var rows=sh.getRange(2,1,sh.getLastRow()-1,B_COLS).getValues();
    var csv='Дата;Тип;Категория;Сумма;Счёт;Сотрудник;Комментарий\n';
    rows.forEach(function(r){
      var dt=r[B_DATE-1];if(!(dt instanceof Date))return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from)return;if(pd.to&&ms>pd.to)return;
      csv+=[Utilities.formatDate(dt,tz,'dd.MM.yyyy'),r[B_TYPE-1],r[B_CAT-1],
        Math.round(parseFloat(r[B_AMT-1])||0),r[B_ACC-1],r[B_EMP-1]||'',r[B_CMT-1]||'']
        .map(function(v){return'"'+String(v||'').replace(/"/g,'""')+'"';}).join(';')+'\n';
    });
    return {csv:csv};
  } catch(e){return{__error:e.message};}
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
  _mk(ss,SH_SETTINGS, ['Ключ','Значение']);
  _mk(ss,SH_TRASH,   ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена','Удалено']);
  _mk(ss,SH_RECURRING,['ID','Название','Категория','Сумма','Счёт','День','Активна','Создано']);
  _mk(ss,SH_PAYMENTS, ['ID','Контрагент','Сумма','Комментарий','Дата','Статус','Назначение','Создано','Оплачено']);
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
    function gb(k,def) {
      var v=map[k];
      if(v===undefined||v==='')return def;
      return v==='true'||v==='1';
    }
    return {
      cats:             gj('CATS'),
      cashiers:         gj('CASHIERS'),
      payTypes:         gj('PAY_TYPES'),
      repStatuses:      gj('REP_STATUSES'),
      employees:        gj('EMPLOYEES'),
      shifts:           gj('SHIFTS'),
      suppliers:        gj('SUPPLIERS'),
      showKassaBalance: gb('SHOW_KASSA_BALANCE', true)
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
      CATS:                JSON.stringify(d.cats||[]),
      CASHIERS:            JSON.stringify(d.cashiers||[]),
      PAY_TYPES:           JSON.stringify(d.payTypes||[]),
      REP_STATUSES:        JSON.stringify(d.repStatuses||[]),
      EMPLOYEES:           JSON.stringify(d.employees||[]),
      SHIFTS:              JSON.stringify(d.shifts||[]),
      SUPPLIERS:           JSON.stringify(d.suppliers||[]),
      SHOW_KASSA_BALANCE:  d.showKassaBalance===false?'false':'true'
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
  var r2=saveQuickEntry({ssId:ssId,data:{uuid:d.uuid+'_in',date:d.date,type:'Доход',
    category:'Перевод',account:d.toAccount,amount:d.amount,
    comment:d.comment||('← '+d.account),zRef:ref,shift:d.shift}});
  if (r2.__error) {
    // Rollback first entry to avoid balance corruption
    try { deleteTransaction({ssId:ssId,id:r1.id}); } catch(e) {}
    return r2;
  }
  return r2;
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
  var type=String(r[B_TYPE-1]),cat=String(r[B_CAT-1]),cmt=String(r[B_CMT-1]||'');
  var toAccount=null;
  if(type==='Расход'&&cat==='Перевод'){var m=cmt.match(/^→\s*(.+)/);if(m)toAccount=m[1].trim();}
  return {
    id:String(r[B_ID-1]), date:(d instanceof Date)?d.toISOString():'',
    type:type, category:cat,
    account:String(r[B_ACC-1]), amount:parseFloat(r[B_AMT-1])||0,
    comment:cmt, employee:String(r[B_EMP-1]||''),
    receipt:String(r[B_REC-1]||''), shift:String(r[B_SHIFT-1]||''),
    locked:r[B_LOCK-1]===true||r[B_LOCK-1]==='true',
    toAccount:toAccount
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

function getSupplierAnalytics(p) {
  var ssId=p.ssId;
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_DEBTS);
    if (!sh||sh.getLastRow()<2) return {suppliers:[],totalBuy:0,totalDebt:0,totalPay:0};
    var map={};
    sh.getRange(2,1,sh.getLastRow()-1,D_COLS).getValues().forEach(function(r){
      var rep=String(r[D_REP-1]),type=String(r[D_TYPE-1]),amt=parseFloat(r[D_AMT-1])||0;
      if (!rep) return;
      if (!map[rep]) map[rep]={name:rep,totalBuy:0,totalPay:0,debt:0,txCount:0};
      var m=map[rep]; m.txCount++;
      if (type==='zakupka'||type==='начальный_долг') { m.debt+=amt; m.totalBuy+=amt; }
      else if (type==='oplata') { m.debt-=amt; m.totalPay+=amt; }
    });
    var list=Object.keys(map).map(function(k){
      var m=map[k];
      return {name:m.name,totalBuy:Math.round(m.totalBuy),totalPay:Math.round(m.totalPay),
              debt:Math.round(m.debt),txCount:m.txCount,
              payRatio:m.totalBuy>0?Math.round(m.totalPay/m.totalBuy*100):0};
    }).sort(function(a,b){return b.totalBuy-a.totalBuy;});
    var totalBuy=list.reduce(function(s,x){return s+x.totalBuy;},0);
    var totalDebt=list.reduce(function(s,x){return s+Math.max(x.debt,0);},0);
    var totalPay=list.reduce(function(s,x){return s+x.totalPay;},0);
    return {suppliers:list,totalBuy:Math.round(totalBuy),totalDebt:Math.round(totalDebt),totalPay:Math.round(totalPay)};
  } catch(e) { return {suppliers:[],totalBuy:0,totalDebt:0,totalPay:0}; }
}

function getShiftAnalytics(p) {
  var ssId=p.ssId,period=p.period;
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_SHIFTS);
    var tz=Session.getScriptTimeZone();
    if (!sh||sh.getLastRow()<2) return {byShift:[],byDay:[],total:0,totalDisc:0};
    var pd=_period(period,tz);
    var shiftMap={},dayMap={};
    sh.getRange(2,1,sh.getLastRow()-1,8).getValues().forEach(function(r){
      var dt=r[1]; if(!(dt instanceof Date)) return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from) return; if(pd.to&&ms>pd.to) return;
      var shiftName=String(r[2]);
      var rj=[]; try{rj=JSON.parse(r[4]||'[]');}catch(e){}
      var rev=0; rj.forEach(function(row){rev+=parseFloat(row.zAmount||0);});
      var disc=parseFloat(r[6])||0;
      var dk=Utilities.formatDate(dt,tz,'yyyy-MM-dd');
      if(!shiftMap[shiftName]) shiftMap[shiftName]={name:shiftName,count:0,revenue:0,discrepancy:0};
      shiftMap[shiftName].count++; shiftMap[shiftName].revenue+=rev; shiftMap[shiftName].discrepancy+=disc;
      if(!dayMap[dk]) dayMap[dk]={label:dk,revenue:0,disc:0};
      dayMap[dk].revenue+=rev; dayMap[dk].disc+=disc;
    });
    var byShift=Object.keys(shiftMap).map(function(k){
      var s=shiftMap[k];
      return {name:s.name,count:s.count,revenue:Math.round(s.revenue),
              avgRevenue:s.count>0?Math.round(s.revenue/s.count):0,discrepancy:Math.round(s.discrepancy)};
    }).sort(function(a,b){return b.revenue-a.revenue;});
    var byDay=Object.keys(dayMap).sort().map(function(dk){
      var p2=dk.split('-');
      return {label:parseInt(p2[2])+'.'+parseInt(p2[1]),revenue:Math.round(dayMap[dk].revenue)};
    });
    var total=byShift.reduce(function(s,x){return s+x.revenue;},0);
    var totalDisc=byShift.reduce(function(s,x){return s+x.discrepancy;},0);
    return {byShift:byShift,byDay:byDay,total:Math.round(total),totalDisc:Math.round(totalDisc)};
  } catch(e) { return {byShift:[],byDay:[],total:0,totalDisc:0}; }
}

function getAccountFlow(p) {
  var ssId=p.ssId,period=p.period;
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var base=ss.getSheetByName(SH_BASE);
    var tz=Session.getScriptTimeZone();
    if (!base||base.getLastRow()<2) return {accounts:[]};
    var pd=_period(period,tz);
    var map={};
    base.getRange(2,1,base.getLastRow()-1,B_COLS).getValues().forEach(function(r){
      var dt=r[B_DATE-1]; if(!(dt instanceof Date)) return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from) return; if(pd.to&&ms>pd.to) return;
      var type=String(r[B_TYPE-1]),acc=String(r[B_ACC-1]||''),amt=parseFloat(r[B_AMT-1])||0;
      if(!acc||acc==='undefined'||acc==='') return;
      if(!map[acc]) map[acc]={name:acc,income:0,expense:0,txCount:0};
      map[acc].txCount++;
      if(type==='Доход') map[acc].income+=amt;
      else if(type==='Расход') map[acc].expense+=amt;
    });
    var accounts=Object.keys(map).map(function(k){
      var a=map[k];
      return {name:a.name,income:Math.round(a.income),expense:Math.round(a.expense),
              net:Math.round(a.income-a.expense),txCount:a.txCount};
    }).sort(function(a,b){return b.income-a.income;});
    return {accounts:accounts};
  } catch(e) { return {accounts:[]}; }
}

function getGrowthData(p) {
  var ssId=p.ssId;
  try {
    var cur=getAnalytics({ssId:ssId,period:'month'});
    var prev=getAnalytics({ssId:ssId,period:'prev_month'});
    var curW=getAnalytics({ssId:ssId,period:'week'});
    var prevW=getAnalytics({ssId:ssId,period:'prev_week'});
    var curC=getCashierAnalytics({ssId:ssId,period:'month'});
    function pct(a,b){if(!b)return a>0?100:0;return Math.round((a-b)/Math.abs(b)*100);}
    return {
      month:{
        income:cur.income,prevIncome:prev.income,incomeChange:pct(cur.income,prev.income),
        expense:cur.expense,prevExpense:prev.expense,expenseChange:pct(cur.expense,prev.expense),
        profit:cur.income-cur.expense,prevProfit:prev.income-prev.expense,
        profitChange:pct(cur.income-cur.expense,Math.abs(prev.income-prev.expense||1)),
        byCategory:cur.byCategory
      },
      week:{
        income:curW.income,prevIncome:prevW.income,incomeChange:pct(curW.income,prevW.income),
        expense:curW.expense,prevExpense:prevW.expense,expenseChange:pct(curW.expense,prevW.expense)
      },
      topCashier:curC.list&&curC.list[0]?curC.list[0]:null
    };
  } catch(e){return {month:{},week:{},topCashier:null};}
}

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
  else if (period==='prev_week') {
    var thisMon=new Date(today); thisMon.setDate(today.getDate()-((today.getDay()+6)%7));
    var prevMon=new Date(thisMon); prevMon.setDate(thisMon.getDate()-7);
    var prevSun=new Date(thisMon); prevSun.setDate(thisMon.getDate()-1);
    from=prevMon.getTime(); to=prevSun.getTime()+86399999;
  }
  return {from:from,to:to};
}

function _s(v) { return String(v||'').replace(/[<>"'`]/g,'').trim().slice(0,500); }

// ═══════════════════════════════════════════════════════════════════════
// MODULE: RECURRING EXPENSES (Ежемесячные расходы)
// ═══════════════════════════════════════════════════════════════════════

function getRecurring(p) {
  var ssId=p.ssId;
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_RECURRING);
    if (!sh||sh.getLastRow()<2) return [];
    return sh.getRange(2,1,sh.getLastRow()-1,RC_COLS).getValues().map(function(r){
      var dt=r[RC_CREATED-1];
      return {id:String(r[RC_ID-1]),name:String(r[RC_NAME-1]),category:String(r[RC_CAT-1]),
              amount:parseFloat(r[RC_AMT-1])||0,account:String(r[RC_ACC-1]),
              day:parseInt(r[RC_DAY-1])||1,active:r[RC_ACTIVE-1]===true||r[RC_ACTIVE-1]==='true',
              created:(dt instanceof Date)?dt.toISOString():''};
    });
  } catch(e) { return []; }
}

function saveRecurring(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_RECURRING);
    var id=d.id||Utilities.getUuid();
    var row=[id,_s(d.name),_s(d.category),Math.round(parseFloat(d.amount)||0),
             _s(d.account),parseInt(d.day)||1,d.active!==false,new Date()];
    if (d.id&&sh.getLastRow()>=2) {
      var vs=sh.getRange(2,RC_ID,sh.getLastRow()-1,1).getValues();
      for (var i=0;i<vs.length;i++) {
        if (String(vs[i][0])===String(d.id)) {
          sh.getRange(i+2,1,1,RC_COLS).setValues([row]); return {ok:true,id:id};
        }
      }
    }
    sh.appendRow(row);
    return {ok:true,id:id};
  } catch(e) { return {__error:e.message}; }
}

function deleteRecurring(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_RECURRING);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,RC_ID,sh.getLastRow()-1,1).getValues();
    for (var i=vs.length-1;i>=0;i--) {
      if (String(vs[i][0])===String(id)) { sh.deleteRow(i+2); return {ok:true}; }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

// Creates expense transactions for all active recurring templates for current month
function applyRecurring(p) {
  var ssId=p.ssId;
  try {
    var recs=getRecurring({ssId:ssId});
    var active=recs.filter(function(r){return r.active&&r.amount>0;});
    if (!active.length) return {ok:true,applied:0};
    var now=new Date();
    var applied=0;
    active.forEach(function(r){
      var dt=new Date(now.getFullYear(),now.getMonth(),Math.min(r.day,28));
      var res=saveQuickEntry({ssId:ssId,data:{
        uuid:'rc_'+r.id+'_'+now.getFullYear()+'_'+(now.getMonth()+1),
        date:dt.toISOString(),type:'Расход',category:r.category,
        account:r.account,amount:r.amount,comment:r.name
      }});
      if (res.ok&&!res.duplicate) applied++;
    });
    return {ok:true,applied:applied};
  } catch(e) { return {__error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: BUDGET (Планово/Фактически)
// ═══════════════════════════════════════════════════════════════════════

function getBudget(p) {
  var ssId=p.ssId, period=p.period||'month';
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_SETTINGS);
    var budgetMap={};
    if (sh.getLastRow()>=2) {
      sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(function(r){
        if (String(r[0])==='BUDGET') {
          try { budgetMap=JSON.parse(r[1])||{}; } catch(e){}
        }
      });
    }
    var an=getAnalytics({ssId:ssId,period:period});
    var actualMap={};
    (an.byCategory||[]).forEach(function(c){
      if (c.type==='expense'||c.type==='Расход') actualMap[c.category]=c.total;
    });
    var allCats=[];
    Object.keys(budgetMap).forEach(function(k){if(allCats.indexOf(k)<0)allCats.push(k);});
    Object.keys(actualMap).forEach(function(k){if(allCats.indexOf(k)<0)allCats.push(k);});
    var items=allCats.map(function(cat){
      var planned=parseFloat(budgetMap[cat])||0;
      var actual=parseFloat(actualMap[cat])||0;
      var pct=planned>0?Math.min(Math.round(actual/planned*100),100):0;
      return {category:cat,planned:planned,actual:actual,
              remaining:Math.max(planned-actual,0),pct:pct,over:actual>planned&&planned>0};
    }).sort(function(a,b){return (b.planned||b.actual)-(a.planned||a.actual);});
    return {items:items,totalPlanned:Math.round(an.expense||0),budgetMap:budgetMap};
  } catch(e) { return {items:[],totalPlanned:0,budgetMap:{}}; }
}

function saveBudget(p) {
  var ssId=p.ssId, budgetMap=p.budgetMap||{};
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_SETTINGS);
    var val=JSON.stringify(budgetMap);
    if (sh.getLastRow()>=2) {
      var vs=sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
      for (var i=0;i<vs.length;i++) {
        if (String(vs[i][0])==='BUDGET') { sh.getRange(i+2,2).setValue(val); return {ok:true}; }
      }
    }
    sh.appendRow(['BUDGET',val]);
    return {ok:true};
  } catch(e) { return {__error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: PAYMENTS (Записи на выплату)
// ═══════════════════════════════════════════════════════════════════════

function getPayments(p) {
  var ssId=p.ssId;
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_PAYMENTS);
    if (!sh||sh.getLastRow()<2) return [];
    var tz=Session.getScriptTimeZone();
    return sh.getRange(2,1,sh.getLastRow()-1,PY_COLS).getValues().map(function(r){
      var due=r[PY_DUE-1];
      var dueStr=(due instanceof Date)?Utilities.formatDate(due,tz,'yyyy-MM-dd'):'';
      var paidAmt=parseFloat(r[PY_PAID-1])||0;
      var status=String(r[PY_STATUS-1])||'open';
      // normalize legacy statuses
      if(status==='pending')status='open';
      if(status==='overdue')status='open';
      return {
        id:String(r[PY_ID-1]),
        payee:String(r[PY_NAME-1]),
        title:String(r[PY_CAT-1]),
        amount:parseFloat(r[PY_AMT-1])||0,
        paid:paidAmt,
        comment:String(r[PY_ACC-1]),
        date:dueStr,
        status:status,
        created:''
      };
    }).filter(function(r){return r.id&&r.id!=='';})
     .sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
  } catch(e) { return []; }
}

function savePayment(p) {
  var ssId=p.ssId, d=p.data||{};
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh=ss.getSheetByName(SH_PAYMENTS);
    var id=d.id||Utilities.getUuid();
    var date=d.date?new Date(d.date):(d.due?new Date(d.due):new Date());
    // PY: id, payee, amount, comment, date, status, title, created, paidAmt
    var paidAmt=parseFloat(d.paid)||0;
    var row=[id,_s(d.payee||d.name||''),Math.round(parseFloat(d.amount)||0),
             _s(d.comment||d.account||''),date,d.status||'open',
             _s(d.title||d.category||''),new Date(),paidAmt];
    if (d.id&&sh.getLastRow()>=2) {
      var vs=sh.getRange(2,PY_ID,sh.getLastRow()-1,1).getValues();
      for (var i=0;i<vs.length;i++) {
        if (String(vs[i][0])===String(d.id)) {
          sh.getRange(i+2,1,1,PY_COLS).setValues([row]);
          sh.getRange(i+2,PY_DUE,1,1).setNumberFormat('dd.mm.yyyy');
          return {ok:true,id:id};
        }
      }
    }
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(),PY_DUE,1,1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(sh.getLastRow(),PY_AMT,1,1).setNumberFormat('#,##0');
    return {ok:true,id:id};
  } catch(e) { return {__error:e.message}; }
}

// Update payment status: pay / postpone / cancel / restore
function updatePayment(p) {
  var ssId=p.ssId, d=p.data||{};
  var id=String(d.id||'');
  if (!id) return {__error:'no id'};
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_PAYMENTS);
    if (!sh||sh.getLastRow()<2) { lock.releaseLock(); return {__error:'not found'}; }
    var vs=sh.getRange(2,1,sh.getLastRow()-1,PY_COLS).getValues();
    var rowNum=-1, rowData=null;
    for (var i=0;i<vs.length;i++) {
      if (String(vs[i][PY_ID-1])===id) { rowNum=i+2; rowData=vs[i]; break; }
    }
    if (rowNum===-1) { lock.releaseLock(); return {__error:'not found'}; }
    if (d.action==='pay') {
      var paidBefore=parseFloat(rowData[PY_PAID-1])||0;
      var payAmt=parseFloat(d.amount)||0;
      var totalAmt=parseFloat(rowData[PY_AMT-1])||0;
      var newPaid=Math.min(paidBefore+payAmt,totalAmt);
      var newStatus=newPaid>=totalAmt?'paid':'open';
      sh.getRange(rowNum,PY_PAID).setValue(newPaid);
      sh.getRange(rowNum,PY_STATUS).setValue(newStatus);
      // write expense transaction
      if (payAmt>0&&d.account) {
        saveQuickEntry({ssId:ssId,data:{uuid:Utilities.getUuid(),date:new Date().toISOString(),
          type:'Расход',category:String(rowData[PY_CAT-1])||'Выплата поставщику',
          account:_s(d.account),amount:payAmt,comment:String(rowData[PY_NAME-1])+(d.comment?' — '+_s(d.comment):''),locked:false}});
      }
    } else if (d.action==='postpone') {
      sh.getRange(rowNum,PY_STATUS).setValue('postponed');
      if (d.date) sh.getRange(rowNum,PY_DUE).setValue(new Date(d.date));
    } else if (d.action==='cancel') {
      sh.getRange(rowNum,PY_STATUS).setValue('cancelled');
    } else if (d.action==='restore') {
      sh.getRange(rowNum,PY_STATUS).setValue('open');
    }
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

function markPaymentPaid(p) {
  var ssId=p.ssId, id=p.id, account=_s(p.account||'');
  try {
    var lock=LockService.getScriptLock(); lock.waitLock(10000);
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_PAYMENTS);
    if (!sh||sh.getLastRow()<2) { lock.releaseLock(); return {__error:'not found'}; }
    var vs=sh.getRange(2,1,sh.getLastRow()-1,PY_COLS).getValues();
    var rowNum=-1,rowData=null;
    for (var i=0;i<vs.length;i++) {
      if (String(vs[i][PY_ID-1])===String(id)) { rowNum=i+2; rowData=vs[i]; break; }
    }
    if (rowNum===-1) { lock.releaseLock(); return {__error:'not found'}; }
    sh.getRange(rowNum,PY_STATUS).setValue('paid');
    sh.getRange(rowNum,PY_PAID).setValue(parseFloat(rowData[PY_AMT-1])||0);
    if (account&&rowData) {
      var amt=parseFloat(rowData[PY_AMT-1])||0;
      var cat=String(rowData[PY_CAT-1])||'Выплата';
      var name=String(rowData[PY_NAME-1]);
      if (amt>0) {
        saveQuickEntry({ssId:ssId,data:{uuid:Utilities.getUuid(),date:new Date().toISOString(),
          type:'Расход',category:cat,account:account,amount:amt,comment:name}});
      }
    }
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(e){}
    lock.releaseLock();
    return {ok:true};
  } catch(e) { try{LockService.getScriptLock().releaseLock();}catch(e2){} return {__error:e.message}; }
}

function deletePayment(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_PAYMENTS);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,PY_ID,sh.getLastRow()-1,1).getValues();
    for (var i=vs.length-1;i>=0;i--) {
      if (String(vs[i][0])===String(id)) { sh.deleteRow(i+2); return {ok:true}; }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

// Toggle account visibility: active ↔ hidden
function toggleAccountVisibility(p) {
  var ssId=p.ssId, id=p.id;
  try {
    var sh=SpreadsheetApp.openById(ssId).getSheetByName(SH_ACCOUNTS);
    if (!sh||sh.getLastRow()<2) return {__error:'not found'};
    var vs=sh.getRange(2,1,sh.getLastRow()-1,4).getValues();
    for (var i=0;i<vs.length;i++) {
      if (String(vs[i][0])===String(id)) {
        var cur=String(vs[i][3]);
        var next=cur==='hidden'?'active':'hidden';
        sh.getRange(i+2,4).setValue(next);
        return {ok:true,status:next};
      }
    }
    return {__error:'not found'};
  } catch(e) { return {__error:e.message}; }
}

// Returns all accounts including hidden ones
function getAccountsAll(p) {
  var ssId=p&&p.ssId?p.ssId:p;
  try {
    var ss=SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var accSh=ss.getSheetByName(SH_ACCOUNTS);
    var baseSh=ss.getSheetByName(SH_BASE);
    var accounts=[];
    if (accSh.getLastRow()>=2) {
      accSh.getRange(2,1,accSh.getLastRow()-1,6).getValues().forEach(function(r){
        if (r[0])
          accounts.push({id:String(r[0]),name:String(r[1]),startBalance:parseFloat(r[2])||0,
                         status:String(r[3]||'active'),icon:String(r[4]),color:String(r[5])});
      });
    }
    var bals={};
    accounts.forEach(function(a){bals[a.name]=a.startBalance;});
    if (baseSh.getLastRow()>=2) {
      baseSh.getRange(2,1,baseSh.getLastRow()-1,B_COLS).getValues().forEach(function(r){
        var t=String(r[B_TYPE-1]),amt=parseFloat(r[B_AMT-1])||0,acc=String(r[B_ACC-1]);
        if (!bals.hasOwnProperty(acc)) bals[acc]=0;
        if (t==='Доход') bals[acc]+=amt; else if (t==='Расход') bals[acc]-=amt;
      });
    }
    accounts.forEach(function(a){a.balance=Math.round(bals[a.name]||0);});
    return accounts;
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE: SEED / DEMO DATA
// ═══════════════════════════════════════════════════════════════════════

function seedDemoData(p) {
  var ssId = _s(p.ssId);
  if (!ssId) return { __error: 'ssId required' };
  try {
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    var ss = SpreadsheetApp.openById(ssId);
    ensureSheets(ss);

    // helpers
    var now = new Date();
    function dt(daysAgo, h, m) {
      var x = new Date(now);
      x.setDate(x.getDate() - (daysAgo || 0));
      x.setHours(h || 10, m || 0, 0, 0);
      return x;
    }
    function uid() { return Utilities.getUuid(); }

    // --- clear sheets ---
    var sheets = [SH_BASE, SH_ACCOUNTS, SH_DEBTS, SH_SHIFTS, SH_PAYMENTS, SH_SETTINGS];
    sheets.forEach(function(n) {
      var sh = ss.getSheetByName(n);
      if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });

    // --- settings ---
    var settSh = ss.getSheetByName(SH_SETTINGS);
    var sett = [
      ['CATS',         JSON.stringify(['Продажи','Закупка','ЗП','Аренда','Хозрасходы','Коммуналка','Реклама','Налоги'])],
      ['CASHIERS',     JSON.stringify(['Иванова Анна','Петров Виктор','Сидорова Мария'])],
      ['PAY_TYPES',    JSON.stringify(['Наличные','Карта','СБП','Безналичный'])],
      ['REP_STATUSES', JSON.stringify(['✅ Оплачено','❌ Не оплачено','⛔ Отменён','🔄 Перенесён'])],
      ['EMPLOYEES',    JSON.stringify(['Иванова Анна','Петров Виктор','Сидорова Мария','Козлова Татьяна'])],
      ['SHIFTS',       JSON.stringify(['Утренняя','Дневная','Вечерняя'])]
    ];
    settSh.getRange(2, 1, sett.length, 2).setValues(sett);

    // --- accounts (starting balances = 0, real balance built from transactions) ---
    var accSh = ss.getSheetByName(SH_ACCOUNTS);
    accSh.getRange(2, 1, 3, 6).setValues([
      [uid(), 'Наличные', 0, 'active', '💵', '#10B981'],
      [uid(), 'Карта',    0, 'active', '💳', '#6366F1'],
      [uid(), 'СБП',      0, 'active', '📱', '#8B5CF6']
    ]);

    // --- transactions ---
    var rows = [];
    var cashiers = ['Иванова Анна', 'Петров Виктор', 'Сидорова Мария'];
    // daily sales data [daysAgo, нал, карта, СБП, cashier_idx]
    var sales = [
      [0,  24800, 48200, 18300, 0],
      [1,  21500, 52100, 15800, 1],
      [2,  28300, 45600, 22100, 2],
      [3,  19200, 41300, 16500, 0],
      [4,  32100, 56800, 24200, 1],
      [5,  25700, 48900, 19600, 2],
      [6,  18600, 38400, 14200, 0],
      [7,  27400, 51200, 21800, 1],
      [8,  22900, 44700, 17300, 2],
      [9,  30500, 58300, 23400, 0],
      [10, 24100, 46200, 18900, 1],
      [11, 16800, 35600, 13500, 2],
      [12, 29700, 53800, 22600, 0],
      [13, 23400, 47500, 19100, 1]
    ];
    function addRow(dAgo, h, type, cat, amt, acc, emp, cmt) {
      rows.push([0, uid(), dt(dAgo,h), type, cat, amt, acc, emp||'', cmt||'', '', '', false, '']);
    }
    sales.forEach(function(s) {
      var emp = cashiers[s[4]];
      if (s[1]) addRow(s[0],  9, 'Доход', 'Продажи', s[1], 'Наличные', emp, 'Z-отчёт наличные');
      if (s[2]) addRow(s[0], 10, 'Доход', 'Продажи', s[2], 'Карта',    emp, 'Z-отчёт карта');
      if (s[3]) addRow(s[0], 11, 'Доход', 'Продажи', s[3], 'СБП',      emp, 'Z-отчёт СБП');
    });
    // expenses
    var exps = [
      [0,  13, 'Расход', 'Закупка',    45000, 'Наличные', 'Иванова Анна',  'Закупка — ООО Альфа Трейд'],
      [1,  15, 'Расход', 'Хозрасходы', 2800,  'Наличные', '',              'Хозтовары, упаковка'],
      [2,  11, 'Расход', 'Закупка',    28500, 'Карта',    'Петров Виктор', 'Закупка — ИП Мухамедов'],
      [3,  16, 'Расход', 'Реклама',    8500,  'Карта',    '',              '2ГИС продвижение'],
      [5,  10, 'Расход', 'Закупка',    52000, 'Наличные', 'Иванова Анна',  'Закупка — оптовый склад'],
      [7,  11, 'Расход', 'Хозрасходы', 3200,  'Наличные', '',              'Пакеты, канцелярия'],
      [9,  10, 'Расход', 'Закупка',    38000, 'Карта',    'Сидорова Мария','Закупка — ООО Альфа Трейд'],
      [10,  9, 'Расход', 'Коммуналка', 12400, 'Карта',    '',              'Электричество и водоснабжение'],
      [12, 10, 'Расход', 'Аренда',     85000, 'Карта',    '',              'Аренда помещения за июнь'],
      [12, 11, 'Расход', 'ЗП',         35000, 'Наличные', '',              'ЗП — Иванова А.'],
      [12, 11, 'Расход', 'ЗП',         30000, 'Наличные', '',              'ЗП — Петров В.'],
      [12, 12, 'Расход', 'ЗП',         28000, 'Наличные', '',              'ЗП — Сидорова М.'],
      [13, 14, 'Расход', 'Закупка',    41000, 'Наличные', 'Петров Виктор', 'Закупка — Меркурий']
    ];
    exps.forEach(function(e) { addRow(e[0],e[1],e[2],e[3],e[4],e[5],e[6],e[7]); });

    // sort by date desc, re-number
    rows.sort(function(a,b){ return b[2]-a[2]; });
    rows.forEach(function(r,i){ r[0]=i+1; });

    var baseSh = ss.getSheetByName(SH_BASE);
    baseSh.getRange(2, 1, rows.length, B_COLS).setValues(rows);
    baseSh.getRange(2, B_DATE, rows.length, 1).setNumberFormat('dd.mm.yyyy');
    baseSh.getRange(2, B_AMT,  rows.length, 1).setNumberFormat('#,##0');

    // --- supplier debts ---
    var debtSh = ss.getSheetByName(SH_DEBTS);
    var debts = [
      [uid(),'ООО Альфа Трейд',   'начальный_долг', 47000, dt(30,10), 'Карта',    'Входящий остаток долга',  dt(30,10), 'НК-001', '❌ Не оплачено'],
      [uid(),'ООО Альфа Трейд',   'zakupka',        45000, dt(9,13),  'Наличные', 'Закупка товара',          dt(9,13),  'НК-018', '❌ Не оплачено'],
      [uid(),'ООО Альфа Трейд',   'oplata',         30000, dt(6,11),  'Карта',    'Частичная оплата',        dt(6,11),  '',       '✅ Оплачено'],
      [uid(),'ИП Мухамедов Р.А.', 'начальный_долг', 23500, dt(45,10), 'Карта',    '',                        dt(45,10), 'МУХ-12', '❌ Не оплачено'],
      [uid(),'ИП Мухамедов Р.А.', 'zakupka',        28500, dt(2,11),  'Карта',    'Закупка товара',          dt(2,11),  'МУХ-23', '❌ Не оплачено'],
      [uid(),'ИП Мухамедов Р.А.', 'oplata',         15000, dt(1,12),  'Наличные', 'Частичная оплата',        dt(1,12),  '',       '✅ Оплачено'],
      [uid(),'Оптовый склад Меркурий','начальный_долг',15000,dt(20,10),'Наличные','',                        dt(20,10), 'МЕР-07', '❌ Не оплачено'],
      [uid(),'Оптовый склад Меркурий','zakupka',     41000, dt(13,14), 'Наличные', 'Закупка товара',          dt(13,14), 'МЕР-15', '❌ Не оплачено'],
      [uid(),'Оптовый склад Меркурий','oplata',      41000, dt(5,9),   'Наличные', 'Полная оплата',           dt(5,9),   '',       '✅ Оплачено']
    ];
    debtSh.getRange(2, 1, debts.length, D_COLS).setValues(debts);

    // --- shifts ---
    var shiftSh = ss.getSheetByName(SH_SHIFTS);
    var shifts = [
      [uid(), dt(0,9),  'Утренняя', 'Иванова Анна',   JSON.stringify([{acc:'Наличные',z:24800,fact:24800},{acc:'Карта',z:48200,fact:48200},{acc:'СБП',z:18300,fact:18300}]), '[]',    0,   dt(0,20)],
      [uid(), dt(1,9),  'Утренняя', 'Петров Виктор',  JSON.stringify([{acc:'Наличные',z:21500,fact:21000},{acc:'Карта',z:52100,fact:52100},{acc:'СБП',z:15800,fact:15800}]), '[]', -500,   dt(1,20)],
      [uid(), dt(2,9),  'Утренняя', 'Сидорова Мария', JSON.stringify([{acc:'Наличные',z:28300,fact:28300},{acc:'Карта',z:45600,fact:45800},{acc:'СБП',z:22100,fact:22100}]), '[]',  200,   dt(2,20)],
      [uid(), dt(5,9),  'Утренняя', 'Петров Виктор',  JSON.stringify([{acc:'Наличные',z:25700,fact:25700},{acc:'Карта',z:48900,fact:48900},{acc:'СБП',z:19600,fact:19600}]), '[]',    0,   dt(5,20)],
      [uid(), dt(7,9),  'Утренняя', 'Иванова Анна',   JSON.stringify([{acc:'Наличные',z:27400,fact:27400},{acc:'Карта',z:51200,fact:51200},{acc:'СБП',z:21800,fact:21800}]), '[]',    0,   dt(7,20)]
    ];
    shiftSh.getRange(2, 1, shifts.length, 8).setValues(shifts);

    // --- supplier payment records (new format: payee, amount, comment, date, status, title, created, paidAmt) ---
    var paysSh = ss.getSheetByName(SH_PAYMENTS);
    var pays = [
      // id, payee, amount, comment, date, status, title, created, paidAmt
      [uid(), 'ИП Смирнов М.К.',    85000, '',  dt(-5,10),  'open',      'Аренда помещения',       dt(0,10), 0],
      [uid(), 'ООО Альфа-Трейд',   120000, '',  dt(-3,10),  'open',      'Поставка прод. №12',     dt(0,10), 0],
      [uid(), 'ООО Альфа-Трейд',    75000, '',  dt(2,10),   'open',      'Поставка прод. №13',     dt(0,10), 0],
      [uid(), 'ИП Захаров К.С.',    48000, '',  dt(-8,10),  'paid',      'Поставка косметики №7',  dt(0,10), 48000],
      [uid(), 'ИП Захаров К.С.',    62000, '',  dt(5,10),   'open',      'Поставка косметики №8',  dt(0,10), 0],
      [uid(), 'ГУП Горгаз',         12400, '',  dt(-2,10),  'open',      'Коммуналка',             dt(0,10), 0],
      [uid(), 'ООО Альфа-Трейд',    95000, '',  dt(7,10),   'open',      'Поставка прод. №14',     dt(0,10), 0],
      [uid(), 'ИП Смирнов М.К.',    85000, '',  dt(-35,10), 'paid',      'Аренда прошлый месяц',   dt(0,10), 85000]
    ];
    paysSh.getRange(2, 1, pays.length, PY_COLS).setValues(pays);

    try { CacheService.getScriptCache().remove('dash_' + ssId); } catch(e) {}
    lock.releaseLock();
    return { ok: true, txCount: rows.length };
  } catch(e) { return { __error: e.message }; }
}

function exportTransactions(p) {
  var ssId=p.ssId,period=p.period||'month';
  try {
    var ss=SpreadsheetApp.openById(ssId);
    var sh=ss.getSheetByName(SH_BASE);
    if(!sh||sh.getLastRow()<2) return {csv:'Нет данных\n'};
    var tz=Session.getScriptTimeZone();
    var pd=_period(period,tz);
    var rows=sh.getRange(2,1,sh.getLastRow()-1,B_COLS).getValues();
    var csv='Дата;Тип;Категория;Сумма;Счёт;Сотрудник;Комментарий\n';
    rows.forEach(function(r){
      var dt=r[B_DATE-1];if(!(dt instanceof Date))return;
      var ms=dt.getTime();
      if(pd.from&&ms<pd.from)return;if(pd.to&&ms>pd.to)return;
      csv+=[Utilities.formatDate(dt,tz,'dd.MM.yyyy'),r[B_TYPE-1],r[B_CAT-1],
        Math.round(parseFloat(r[B_AMT-1])||0),r[B_ACC-1],r[B_EMP-1],r[B_CMT-1]]
        .map(function(v){return'"'+String(v||'').replace(/"/g,'""')+'"';}).join(';')+'\n';
    });
    return {csv:csv};
  } catch(e){return{__error:e.message};}
}
