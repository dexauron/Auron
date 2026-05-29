// ═══════════════════════════════════════════════════════════════════════
//  AURON FINANCE v2.0 — Google Apps Script Backend
//  Deploy: Execute as User accessing, Access: Anyone with Google account
// ═══════════════════════════════════════════════════════════════════════

var PROFILE_FILE_NAME = 'Auron_Profile';
var ORG_FILE_PREFIX   = 'Auron_';
var REG_WEBHOOK       = '';

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
var C_ID=1; var C_UUID=2; var C_DATE=3; var C_TYPE=4; var C_CAT=5;
var C_AMOUNT=6; var C_ACCOUNT=7; var C_EMPLOYEE=8; var C_COMMENT=9;
var C_RECEIPT=10; var C_ZREF=11; var C_LOCKED=12; var C_COLS=12;

// ── doGet ─────────────────────────────────────────────────────────────
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Auron Finance')
    .addMetaTag('viewport','width=device-width,initial-scale=1,maximum-scale=1');
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH — uses UserProperties to avoid DriveApp.getFilesByName (needs full drive scope)
// PropertiesService.getUserProperties() is per-user per-script — works across devices
// ═══════════════════════════════════════════════════════════════════════

function _getUserProps() { return PropertiesService.getUserProperties(); }

function _getProfileSS() {
  var props = _getUserProps();
  var ssId = props.getProperty('PROFILE_SS_ID');
  if (!ssId) return null;
  try { return SpreadsheetApp.openById(ssId); } catch(e) { return null; }
}

function initUserApp() {
  try {
    var profileSS = _getProfileSS();
    if (!profileSS) return { isNew: true };
    var profile = {};
    var profileSh = profileSS.getSheetByName(SH_PROFILE);
    if (profileSh && profileSh.getLastRow() >= 2) {
      var row = profileSh.getRange(2,1,1,3).getValues()[0];
      profile = { name: String(row[0]), phone: String(row[1]) };
    }
    var orgsSh = profileSS.getSheetByName(SH_ORGS);
    var orgs = [];
    if (orgsSh && orgsSh.getLastRow() >= 2) {
      orgsSh.getRange(2,1,orgsSh.getLastRow()-1,3).getValues().forEach(function(r){
        if (r[0] && r[2]) orgs.push({ id: String(r[0]), name: String(r[1]), ssId: String(r[2]) });
      });
    }
    return { isNew: false, profile: profile, orgs: orgs };
  } catch(e) { return { isNew: true, __error: e.message }; }
}

function registerUser(p) {
  var name = _s(p.name); var phone = _s(p.phone);
  try {
    var lock = LockService.getUserLock(); lock.waitLock(10000);
    // If profile already exists, return existing data
    var existingSS = _getProfileSS();
    if (existingSS) {
      lock.releaseLock();
      var r = initUserApp();
      return { ssId: (r.orgs && r.orgs[0]) ? r.orgs[0].ssId : '', orgName: (r.orgs && r.orgs[0]) ? r.orgs[0].name : '' };
    }
    // Create profile spreadsheet
    var profileSS = SpreadsheetApp.create(PROFILE_FILE_NAME);
    var profileSh = profileSS.getSheets()[0]; profileSh.setName(SH_PROFILE);
    profileSh.getRange(1,1,1,3).setValues([['Имя','Телефон','Создано']]);
    profileSh.appendRow([name, phone, new Date()]);
    var orgsSh = profileSS.insertSheet(SH_ORGS);
    orgsSh.getRange(1,1,1,3).setValues([['ID','Название','SS_ID']]);
    // Save profile SS ID to user properties (no DriveApp search needed later)
    _getUserProps().setProperty('PROFILE_SS_ID', profileSS.getId());
    var orgResult = _createOrgSpreadsheet('Мой магазин', profileSS);
    lock.releaseLock();
    if (REG_WEBHOOK) {
      try { UrlFetchApp.fetch(REG_WEBHOOK,{method:'post',contentType:'application/json',
        muteHttpExceptions:true,payload:JSON.stringify({name:name,phone:phone,date:new Date().toISOString()})}); } catch(ex){}
    }
    return { ssId: orgResult.ssId, orgName: 'Мой магазин' };
  } catch(e) { return { __error: e.message }; }
}

function createOrg(p) {
  var name = _s(p.name);
  try {
    var profileSS = _getProfileSS();
    if (!profileSS) return { __error: 'Профиль не найден. Пройдите регистрацию.' };
    var result = _createOrgSpreadsheet(name, profileSS);
    return { ssId: result.ssId, orgName: name };
  } catch(e) { return { __error: e.message }; }
}

function _createOrgSpreadsheet(orgName, profileSS) {
  var fileName = ORG_FILE_PREFIX + orgName.replace(/[\/\\:*?"<>|]/g,'_');
  var orgSS = SpreadsheetApp.create(fileName);
  var orgId = Utilities.getUuid(); var ssId = orgSS.getId();
  var orgsSh = profileSS.getSheetByName(SH_ORGS);
  orgsSh.appendRow([orgId, orgName, ssId]);
  ensureSheets(orgSS);
  var accSh = orgSS.getSheetByName(SH_ACCOUNTS);
  accSh.getRange(2,1,3,6).setValues([
    [Utilities.getUuid(),'Наличные',0,'active','💵','#10B981'],
    [Utilities.getUuid(),'Карта',   0,'active','💳','#6366F1'],
    [Utilities.getUuid(),'СБП',     0,'active','📱','#8B5CF6']
  ]);
  return { orgId: orgId, ssId: ssId };
}

// ═══════════════════════════════════════════════════════════════════════
// SYSTEM
// ═══════════════════════════════════════════════════════════════════════

function ensureSheets(ss) {
  _ensureSheet(ss, SH_BASE,     ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked']);
  _ensureSheet(ss, SH_ACCOUNTS, ['ID','Название','Нач_Баланс','Статус','Иконка','Цвет']);
  _ensureSheet(ss, SH_SHIFTS,   ['ID','Дата','Смена','Кассир','Rows_JSON','Wyplatas_JSON','Расхождение','Создано']);
  _ensureSheet(ss, SH_DEBTS,    ['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','Создано']);
  _ensureSheet(ss, SH_TIMESHEET,['Год','Месяц','День','Сотрудник']);
  _ensureSheet(ss, SH_SETTINGS, ['Ключ','Значение']);
  _ensureSheet(ss, SH_TRASH,    ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Удалено']);
  var trash = ss.getSheetByName(SH_TRASH); if (trash) trash.hideSheet();
}

function _ensureSheet(ss, name, headers) {
  if (!ss.getSheetByName(name)) {
    var sh = ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#1E1B4B').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS — {cats, cashiers}
// ═══════════════════════════════════════════════════════════════════════

function getSettings(p) {
  var ssId = p && p.ssId ? p.ssId : p;
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_SETTINGS);
    var map = {};
    if (sh.getLastRow() >= 2) sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(function(r){if(r[0])map[String(r[0])]=String(r[1]);});
    function gj(k,def){ try{return JSON.parse(map[k]||'null')||def;}catch(e){return def;} }
    return { cats: gj('CATS',[]), cashiers: gj('CASHIERS',[]) };
  } catch(e) { return { cats:[], cashiers:[] }; }
}

function saveSettings(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_SETTINGS);
    var toSave = { CATS: JSON.stringify(data.cats||[]), CASHIERS: JSON.stringify(data.cashiers||[]) };
    var last = sh.getLastRow(); var keys = {};
    if (last >= 2) sh.getRange(2,1,last-1,1).getValues().forEach(function(r,i){if(r[0])keys[String(r[0])]=i+2;});
    Object.keys(toSave).forEach(function(k){
      if (keys[k]) sh.getRange(keys[k],2).setValue(toSave[k]);
      else sh.appendRow([k,toSave[k]]);
    });
    return { ok: true };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNTS — returns array directly
// ═══════════════════════════════════════════════════════════════════════

function getAccounts(p) {
  var ssId = p && p.ssId ? p.ssId : p;
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var accSh = ss.getSheetByName(SH_ACCOUNTS);
    var baseSh = ss.getSheetByName(SH_BASE);
    var accounts = [];
    if (accSh.getLastRow() >= 2) {
      accSh.getRange(2,1,accSh.getLastRow()-1,6).getValues().forEach(function(r){
        if (r[0] && String(r[3]) !== 'archived') {
          accounts.push({ id: String(r[0]), name: String(r[1]), startBalance: parseFloat(r[2])||0, status: String(r[3]) });
        }
      });
    }
    var bals = {};
    accounts.forEach(function(a){ bals[a.name] = a.startBalance; });
    if (baseSh.getLastRow() >= 2) {
      baseSh.getRange(2,1,baseSh.getLastRow()-1,C_COLS).getValues().forEach(function(r){
        var type=String(r[C_TYPE-1]); var amt=parseFloat(r[C_AMOUNT-1])||0; var acc=String(r[C_ACCOUNT-1]);
        if (!bals.hasOwnProperty(acc)) bals[acc]=0;
        if (type==='Доход') bals[acc]+=amt;
        else if (type==='Расход') bals[acc]-=amt;
      });
    }
    accounts.forEach(function(a){ a.balance = Math.round(bals[a.name]||0); });
    return accounts;
  } catch(e) { return []; }
}

function saveAccount(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_ACCOUNTS);
    var id = data.id || Utilities.getUuid();
    var row = [id, _s(data.name), parseFloat(data.startBalance)||0, 'active', data.icon||'💰', data.color||'#6366F1'];
    if (data.id && sh.getLastRow() >= 2) {
      var vals = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
      for (var i=0;i<vals.length;i++) {
        if (String(vals[i][0])===String(data.id)) { sh.getRange(i+2,1,1,6).setValues([row]); return { ok:true }; }
      }
    }
    sh.appendRow(row);
    return { ok: true };
  } catch(e) { return { __error: e.message }; }
}

function deleteAccount(p) {
  var ssId = p.ssId; var id = p.id;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_ACCOUNTS);
    if (sh.getLastRow() < 2) return { __error: 'not found' };
    var vals = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (var i=0;i<vals.length;i++) {
      if (String(vals[i][0])===String(id)) { sh.getRange(i+2,4).setValue('archived'); return { ok:true }; }
    }
    return { __error: 'not found' };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════

function saveQuickEntry(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    var uid = data.uuid || Utilities.getUuid();
    if (data.uuid && base.getLastRow() >= 2) {
      var ex = base.getRange(2,C_UUID,base.getLastRow()-1,1).getValues();
      for (var i=0;i<ex.length;i++) { if (String(ex[i][0])===String(data.uuid)){ lock.releaseLock(); return { ok:true,duplicate:true }; } }
    }
    var id = Utilities.getUuid();
    var dt = data.date ? new Date(data.date) : new Date();
    var row = [id, uid, dt, _s(data.type), _s(data.category||''),
               Math.round(parseFloat(data.amount)||0), _s(data.account||''), _s(data.employee||''),
               _s(data.comment||''), '', data.zRef||'', data.locked?true:false];
    base.appendRow(row);
    var nr = base.getLastRow();
    base.getRange(nr,C_DATE,1,1).setNumberFormat('dd.mm.yyyy');
    base.getRange(nr,C_AMOUNT,1,1).setNumberFormat('#,##0');
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(ex){}
    lock.releaseLock();
    return { ok:true, id:id };
  } catch(e) { return { __error: e.message }; }
}

function saveTransfer(p) {
  var ssId = p.ssId; var data = p.data || {};
  var ref = Utilities.getUuid();
  var r1 = saveQuickEntry({ ssId:ssId, data:{ uuid:data.uuid+'_out', date:data.date, type:'Расход',
    category:'Перевод', account:data.account, amount:data.amount,
    comment:data.comment||('→ '+data.toAccount), zRef:ref } });
  if (r1.__error) return r1;
  return saveQuickEntry({ ssId:ssId, data:{ uuid:data.uuid+'_in', date:data.date, type:'Доход',
    category:'Перевод', account:data.toAccount, amount:data.amount,
    comment:data.comment||('← '+data.account), zRef:ref } });
}

function deleteTransaction(p) {
  var ssId = p.ssId; var id = p.id;
  try {
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    var trash = ss.getSheetByName(SH_TRASH);
    if (base.getLastRow() < 2) { lock.releaseLock(); return { __error:'not found' }; }
    var vals = base.getRange(2,1,base.getLastRow()-1,C_COLS).getValues();
    var rowNum = -1;
    for (var i=0;i<vals.length;i++) { if (String(vals[i][0])===String(id)){ rowNum=i+2; break; } }
    if (rowNum===-1) { lock.releaseLock(); return { __error:'not found' }; }
    var rowData = vals[rowNum-2];
    if (rowData[C_LOCKED-1]===true||rowData[C_LOCKED-1]==='true') {
      lock.releaseLock(); return { __error:'Запись заблокирована Z-отчётом' };
    }
    trash.appendRow(rowData.concat([new Date()]));
    base.deleteRow(rowNum);
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(ex){}
    lock.releaseLock();
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// Returns {accounts, totals, transactions}
function getHomeSummary(p) {
  var ssId = p.ssId; var period = p.period;
  try {
    var cKey = 'dash_'+ssId+'_'+period;
    try { var c = CacheService.getScriptCache().get(cKey); if(c) return JSON.parse(c); } catch(ex){}
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var base = ss.getSheetByName(SH_BASE);
    var tz = Session.getScriptTimeZone();
    var accounts = getAccounts({ssId:ssId});
    var pd = _periodDates(period,tz);
    var allRows = base.getLastRow()>=2 ? base.getRange(2,1,base.getLastRow()-1,C_COLS).getValues() : [];
    var totals = {};
    accounts.forEach(function(a){ totals[a.name]={income:0,expense:0}; });
    allRows.forEach(function(r){
      var d=r[C_DATE-1]; if(!(d instanceof Date)) return;
      var ms=d.getTime();
      if(pd.fromDate && ms<pd.fromDate) return;
      if(pd.toDate && ms>pd.toDate) return;
      var type=String(r[C_TYPE-1]); var amt=parseFloat(r[C_AMOUNT-1])||0; var acc=String(r[C_ACCOUNT-1]);
      if(!totals[acc]) totals[acc]={income:0,expense:0};
      if(type==='Доход') totals[acc].income+=amt;
      else if(type==='Расход') totals[acc].expense+=amt;
    });
    var txs = allRows.slice().reverse().slice(0,60).map(function(r){
      var d=r[C_DATE-1];
      return { id:String(r[C_ID-1]), date:(d instanceof Date)?d.toISOString():'',
               type:String(r[C_TYPE-1]), category:String(r[C_CAT-1]), account:String(r[C_ACCOUNT-1]),
               amount:parseFloat(r[C_AMOUNT-1])||0, comment:String(r[C_COMMENT-1]),
               locked:r[C_LOCKED-1]===true||r[C_LOCKED-1]==='true' };
    });
    var result = { accounts:accounts, totals:totals, transactions:txs };
    try { CacheService.getScriptCache().put(cKey,JSON.stringify(result),60); } catch(ex){}
    return result;
  } catch(e) { return { accounts:[], totals:{}, transactions:[], __error:e.message }; }
}

// Returns array directly
function getAllTransactions(p) {
  var ssId = p.ssId;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    var tz = Session.getScriptTimeZone();
    if (!base || base.getLastRow()<2) return [];
    return base.getRange(2,1,base.getLastRow()-1,C_COLS).getValues().map(function(r){
      var d=r[C_DATE-1];
      return { id:String(r[C_ID-1]), date:(d instanceof Date)?d.toISOString():'',
               type:String(r[C_TYPE-1]), category:String(r[C_CAT-1]), account:String(r[C_ACCOUNT-1]),
               amount:parseFloat(r[C_AMOUNT-1])||0, comment:String(r[C_COMMENT-1]),
               locked:r[C_LOCKED-1]===true||r[C_LOCKED-1]==='true' };
    }).reverse();
  } catch(e) { return []; }
}

// Returns array directly
function searchTransactions(p) {
  var ssId = p.ssId; var query = String(p.query||'').toLowerCase();
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    if (!base || base.getLastRow()<2) return [];
    return base.getRange(2,1,base.getLastRow()-1,C_COLS).getValues().filter(function(r){
      return String(r[C_AMOUNT-1]).indexOf(query)!==-1 ||
             String(r[C_COMMENT-1]).toLowerCase().indexOf(query)!==-1 ||
             String(r[C_CAT-1]).toLowerCase().indexOf(query)!==-1;
    }).map(function(r){
      var d=r[C_DATE-1];
      return { id:String(r[C_ID-1]), date:(d instanceof Date)?d.toISOString():'',
               type:String(r[C_TYPE-1]), category:String(r[C_CAT-1]), account:String(r[C_ACCOUNT-1]),
               amount:parseFloat(r[C_AMOUNT-1])||0, comment:String(r[C_COMMENT-1]) };
    }).reverse().slice(0,50);
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// Z-REPORT
// data: {date, shift, cashier, rows:[{account,zAmount,factAmount}], wyplatas:[{desc,amount,account}]}
// ═══════════════════════════════════════════════════════════════════════

function saveKassa(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    var shifts = ss.getSheetByName(SH_SHIFTS);
    var dt = new Date(data.date); var zRef = Utilities.getUuid();
    var rows = data.rows || []; var wyplatas = data.wyplatas || [];
    var zTotal=0; var factTotal=0; var baseRows=[];
    rows.forEach(function(row){
      var z=parseFloat(row.zAmount)||0; var f=parseFloat(row.factAmount)||0;
      zTotal+=z; factTotal+=f;
      if (z>0) {
        baseRows.push([Utilities.getUuid(),Utilities.getUuid(),dt,'Доход','Z-отчёт',
          Math.round(z),_s(row.account),_s(data.cashier||''),'','',zRef,true]);
      }
    });
    wyplatas.forEach(function(w){
      var amt=parseFloat(w.amount)||0; if(!amt) return;
      baseRows.push([Utilities.getUuid(),Utilities.getUuid(),dt,'Расход','Выплата',
        Math.round(amt),_s(w.account||'Наличные'),_s(data.cashier||''),_s(w.desc||'Выплата'),'',zRef,true]);
    });
    if (baseRows.length>0) {
      var sr = base.getLastRow()+1;
      base.getRange(sr,1,baseRows.length,C_COLS).setValues(baseRows);
      base.getRange(sr,C_DATE,baseRows.length,1).setNumberFormat('dd.mm.yyyy');
      base.getRange(sr,C_AMOUNT,baseRows.length,1).setNumberFormat('#,##0');
    }
    shifts.appendRow([zRef,dt,_s(data.shift||'1'),_s(data.cashier||''),
      JSON.stringify(rows),JSON.stringify(wyplatas),Math.round(factTotal-zTotal),new Date()]);
    shifts.getRange(shifts.getLastRow(),2,1,1).setNumberFormat('dd.mm.yyyy');
    try { CacheService.getScriptCache().remove('dash_'+ssId); } catch(ex){}
    lock.releaseLock();
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// DEBTS / REPS
// ДОЛГИ columns: ID | Представитель | Тип | Сумма | Дата | Счёт | Комментарий | Создано
// Тип: начальный_долг | zakupka | oplata
// ═══════════════════════════════════════════════════════════════════════

// Returns array: [{id, name, debt, totalBuy, totalPay}]
function getDebts(p) {
  var ssId = p.ssId;
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_DEBTS);
    var tz = Session.getScriptTimeZone();
    if (!sh || sh.getLastRow()<2) return [];
    var repMap = {};
    sh.getRange(2,1,sh.getLastRow()-1,8).getValues().forEach(function(r){
      var repName=String(r[1]); var type=String(r[2]); var amt=parseFloat(r[3])||0;
      if (!repName) return;
      if (!repMap[repName]) repMap[repName]={id:repName,name:repName,debt:0,totalBuy:0,totalPay:0};
      var rm=repMap[repName];
      if (type==='zakupka'||type==='начальный_долг') { rm.debt+=amt; rm.totalBuy+=amt; }
      else if (type==='oplata') { rm.debt-=amt; rm.totalPay+=amt; }
    });
    return Object.keys(repMap).map(function(k){
      var r=repMap[k]; r.debt=Math.round(r.debt); r.totalBuy=Math.round(r.totalBuy); r.totalPay=Math.round(r.totalPay);
      return r;
    });
  } catch(e) { return []; }
}

// Create new rep with optional initial debt
function saveRep(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_DEBTS);
    if (data.initDebt && data.initDebt>0) {
      var id = Utilities.getUuid();
      sh.appendRow([id,_s(data.name),'начальный_долг',Math.round(parseFloat(data.initDebt)||0),new Date(),'','Начальный долг',new Date()]);
    }
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// Add zakupka or oplata for a rep
function saveDebtEntry(p) {
  var ssId = p.ssId; var data = p.data || {};
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_DEBTS);
    var id = Utilities.getUuid();
    var repName = _s(data.repId); // repId is the rep name
    var type = _s(data.type);    // 'zakupka' or 'oplata'
    var amt = Math.round(parseFloat(data.amount)||0);
    sh.appendRow([id,repName,type,amt,new Date(),_s(data.account||''),_s(data.comment||''),new Date()]);
    sh.getRange(sh.getLastRow(),5,1,1).setNumberFormat('dd.mm.yyyy');
    sh.getRange(sh.getLastRow(),4,1,1).setNumberFormat('#,##0');
    // If oplata, also deduct from account in БАЗА
    if (type==='oplata' && data.account && amt>0) {
      saveQuickEntry({ssId:ssId,data:{uuid:id,date:new Date().toISOString(),type:'Расход',
        category:'Долг ТП',account:data.account,amount:amt,
        comment:'Оплата долга: '+repName,zRef:id}});
    }
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// Returns history for a rep: array of entries
function getRepDebt(p) {
  var ssId = p.ssId; var repId = String(p.repId);
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_DEBTS);
    if (!sh || sh.getLastRow()<2) return [];
    var tz = Session.getScriptTimeZone();
    return sh.getRange(2,1,sh.getLastRow()-1,8).getValues().filter(function(r){
      return String(r[1])===repId;
    }).map(function(r){
      var d=r[4];
      return { id:String(r[0]), type:String(r[2]), amount:parseFloat(r[3])||0,
               date:(d instanceof Date)?Utilities.formatDate(d,tz,'yyyy-MM-dd'):'',
               account:String(r[5]), comment:String(r[6]) };
    }).reverse();
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════════════════
// TIMESHEET
// ТАБЕЛЬ columns: Год | Месяц | День | Сотрудник
// ═══════════════════════════════════════════════════════════════════════

// Returns {days:[{day,employee}], summary:{[emp]:daysCount}}
function getTimesheetMonth(p) {
  var ssId = p.ssId; var year = parseInt(p.year); var month = parseInt(p.month);
  try {
    var ss = SpreadsheetApp.openById(ssId); ensureSheets(ss);
    var sh = ss.getSheetByName(SH_TIMESHEET);
    var days = [];
    var summary = {};
    if (sh.getLastRow()>=2) {
      sh.getRange(2,1,sh.getLastRow()-1,4).getValues().forEach(function(r){
        var y=parseInt(r[0]); var m=parseInt(r[1]); var d=parseInt(r[2]); var emp=String(r[3]);
        if (y===year && m===month && d && emp) {
          days.push({day:d,employee:emp});
          if (!summary[emp]) summary[emp]=0;
          summary[emp]++;
        }
      });
    }
    return { days:days, summary:summary };
  } catch(e) { return { days:[], summary:{} }; }
}

function saveTimesheetEntry(p) {
  var ssId = p.ssId; var year = parseInt(p.year); var month = parseInt(p.month);
  var day = parseInt(p.day); var employee = _s(p.employee||'');
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_TIMESHEET);
    // Find and update existing row or add
    var rowNum = -1;
    if (sh.getLastRow()>=2) {
      var vals = sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
      for (var i=0;i<vals.length;i++) {
        if (parseInt(vals[i][0])===year && parseInt(vals[i][1])===month && parseInt(vals[i][2])===day) {
          rowNum=i+2; break;
        }
      }
    }
    if (!employee) {
      // Remove entry (mark as empty)
      if (rowNum>0) sh.deleteRow(rowNum);
      return { ok:true };
    }
    if (rowNum>0) sh.getRange(rowNum,4).setValue(employee);
    else sh.appendRow([year,month,day,employee]);
    return { ok:true };
  } catch(e) { return { __error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════
// ANALYTICS
// Returns {income, expense, byCategory:[{category,total,type}], timeline:[{label,income,expense}], totalDebt}
// ═══════════════════════════════════════════════════════════════════════

function getAnalytics(p) {
  var ssId = p.ssId; var period = p.period;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var base = ss.getSheetByName(SH_BASE);
    var tz = Session.getScriptTimeZone();
    if (!base || base.getLastRow()<2) return { income:0, expense:0, byCategory:[], timeline:[], totalDebt:0 };
    var pd = _periodDates(period, tz);
    var allRows = base.getRange(2,1,base.getLastRow()-1,C_COLS).getValues();
    var income=0; var expense=0; var catMap={}; var dayMap={};
    var heatmap=[{dow:1,amount:0},{dow:2,amount:0},{dow:3,amount:0},{dow:4,amount:0},{dow:5,amount:0},{dow:6,amount:0},{dow:7,amount:0}];
    allRows.forEach(function(r){
      var d=r[C_DATE-1]; if(!(d instanceof Date)) return;
      var ms=d.getTime();
      if(pd.fromDate && ms<pd.fromDate) return;
      if(pd.toDate && ms>pd.toDate) return;
      var type=String(r[C_TYPE-1]); var cat=String(r[C_CAT-1]); var amt=parseFloat(r[C_AMOUNT-1])||0;
      var dk=Utilities.formatDate(d,tz,'yyyy-MM-dd');
      if(!dayMap[dk]) dayMap[dk]={income:0,expense:0};
      if(type==='Доход') {
        income+=amt; dayMap[dk].income+=amt;
        var dow=d.getDay(); heatmap[dow===0?6:dow-1].amount+=amt;
        if(cat!=='Перевод'){if(!catMap[cat])catMap[cat]={total:0,type:'income'};catMap[cat].total+=amt;}
      } else if(type==='Расход') {
        expense+=amt; dayMap[dk].expense+=amt;
        if(cat!=='Перевод'){if(!catMap[cat])catMap[cat]={total:0,type:'expense'};catMap[cat].total+=amt;}
      }
    });
    var byCategory = Object.keys(catMap).map(function(k){return{category:k,total:Math.round(catMap[k].total),type:catMap[k].type};})
      .sort(function(a,b){return b.total-a.total;});
    var timeline = Object.keys(dayMap).sort().map(function(dk){
      var parts=dk.split('-'); var label=parseInt(parts[2])+'.'+parseInt(parts[1]);
      return{label:label,income:Math.round(dayMap[dk].income),expense:Math.round(dayMap[dk].expense)};
    });
    var totalDebt = 0;
    try {
      var debts = getDebts({ssId:ssId});
      debts.forEach(function(d){if(d.debt>0)totalDebt+=d.debt;});
    } catch(ex){}
    return { income:Math.round(income), expense:Math.round(expense), byCategory:byCategory,
             timeline:timeline, heatmap:heatmap, totalDebt:Math.round(totalDebt) };
  } catch(e) { return { income:0, expense:0, byCategory:[], timeline:[], totalDebt:0 }; }
}

// Returns {list:[{name,shifts,revenue,discrepancy}]}
function getCashierAnalytics(p) {
  var ssId = p.ssId; var period = p.period;
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sh = ss.getSheetByName(SH_SHIFTS);
    var tz = Session.getScriptTimeZone();
    if (!sh || sh.getLastRow()<2) return { list:[] };
    var pd = _periodDates(period, tz);
    var map = {};
    sh.getRange(2,1,sh.getLastRow()-1,8).getValues().forEach(function(r){
      var d=r[1]; if(!(d instanceof Date)) return;
      var ms=d.getTime();
      if(pd.fromDate && ms<pd.fromDate) return;
      if(pd.toDate && ms>pd.toDate) return;
      var cashier=String(r[3]); if(!cashier) return;
      var rowsJson=[]; try{rowsJson=JSON.parse(r[4]||'[]');}catch(e){}
      var revenue=0; rowsJson.forEach(function(row){revenue+=parseFloat(row.zAmount)||0;});
      var disc=parseFloat(r[6])||0;
      if(!map[cashier]) map[cashier]={name:cashier,shifts:0,revenue:0,discrepancy:0};
      map[cashier].shifts++;
      map[cashier].revenue+=revenue;
      map[cashier].discrepancy+=disc;
    });
    var list = Object.keys(map).map(function(k){
      var c=map[k];
      return{name:c.name,shifts:c.shifts,revenue:Math.round(c.revenue),discrepancy:Math.round(c.discrepancy)};
    }).sort(function(a,b){return b.revenue-a.revenue;});
    return { list: list };
  } catch(e) { return { list:[] }; }
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function _periodDates(period, tz) {
  var now=new Date(); var today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var fromDate=null; var toDate=null;
  if (period==='today'){ fromDate=today.getTime(); toDate=today.getTime()+86399999; }
  else if(period==='week'){ var mon=new Date(today); mon.setDate(today.getDate()-((today.getDay()+6)%7)); fromDate=mon.getTime(); toDate=now.getTime(); }
  else if(period==='month'){ fromDate=new Date(today.getFullYear(),today.getMonth(),1).getTime(); toDate=now.getTime(); }
  else if(period==='year'){ fromDate=new Date(today.getFullYear(),0,1).getTime(); toDate=now.getTime(); }
  return { fromDate:fromDate, toDate:toDate };
}

function _s(val){ return String(val||'').replace(/[<>"'`]/g,'').trim().slice(0,500); }
