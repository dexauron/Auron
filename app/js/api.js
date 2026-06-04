'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AURON FINANCE — Business Logic (browser port of Code.gs)
   All data lives in the user's own Google Drive / Sheets.
   Developer has zero access to any user data.
   ═══════════════════════════════════════════════════════════════════ */

const API = (() => {

  // ── Sheet names ──────────────────────────────────────────────────
  const SH_BASE      = 'БАЗА';
  const SH_ACCOUNTS  = 'СЧЕТА';
  const SH_SHIFTS    = 'СМЕНЫ';
  const SH_DEBTS     = 'ДОЛГИ';
  const SH_SETTINGS  = 'НАСТРОЙКИ';
  const SH_TRASH     = 'КОРЗИНА';
  const SH_TIMESHEET = 'ТАБЕЛЬ';
  const SH_RECURRING = 'РЕКУРРЕНТНЫЕ';
  const SH_PAYMENTS  = 'ВЫПЛАТЫ';
  const SH_PROFILE   = 'ПРОФИЛЬ';
  const SH_ORGS      = 'ОРГАНИЗАЦИИ';
  const PROFILE_NAME = 'Auron_Profile';
  const ORG_PREFIX   = 'Auron_';

  // ── Column indices (1-based → use idx-1 in arrays) ───────────────
  const B_ID=1,B_UUID=2,B_DATE=3,B_TYPE=4,B_CAT=5,B_AMT=6,B_ACC=7,
        B_EMP=8,B_CMT=9,B_REC=10,B_ZREF=11,B_LOCK=12,B_SHIFT=13,B_COLS=13;
  const D_ID=1,D_REP=2,D_TYPE=3,D_AMT=4,D_DATE=5,D_ACC=6,D_CMT=7,
        D_CREATED=8,D_INV=9,D_STATUS=10,D_COLS=10;
  const T_YEAR=1,T_MON=2,T_DAY=3,T_EMP=4,T_IN=5,T_OUT=6,
        T_STATUS=7,T_HRS=8,T_RATE=9,T_CMT=10,T_COLS=10;
  const PY_ID=1,PY_NAME=2,PY_AMT=3,PY_ACC=4,PY_DUE=5,PY_STATUS=6,
        PY_CAT=7,PY_CREATED=8,PY_PAID=9,PY_COLS=9;
  const RC_ID=1,RC_NAME=2,RC_CAT=3,RC_AMT=4,RC_ACC=5,RC_DAY=6,
        RC_ACTIVE=7,RC_CREATED=8,RC_COLS=8;
  const TR_COLS = 14;

  // ── In-memory cache ───────────────────────────────────────────────
  const _cache = new Map();
  const _sheetIds = {};   // ssId:sheetName → numeric sheetId

  // ── Helpers ───────────────────────────────────────────────────────

  function _s(v) { return String(v || '').replace(/[<>"'`]/g, '').trim().slice(0, 500); }
  function _uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c==='x'?r:r&0x3|0x8).toString(16); }); }
  function _now() { return new Date().toISOString(); }
  function _bool(v) { return v === true || v === 'true' || v === '1'; }

  function _toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    // Google Sheets serial number (days since Dec 30, 1899)
    if (typeof v === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30));
      d.setUTCDate(d.getUTCDate() + Math.floor(v));
      if (v % 1) d.setUTCSeconds(d.getUTCSeconds() + Math.round((v % 1) * 86400));
      return d;
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function _iso(v) {
    const d = _toDate(v);
    return d ? d.toISOString() : '';
  }

  function _period(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from = null, to = null;
    if (period === 'today') { from = today.getTime(); to = today.getTime() + 86399999; }
    else if (period === 'week') {
      const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      from = mon.getTime(); to = now.getTime();
    }
    else if (period === 'month') { from = new Date(today.getFullYear(), today.getMonth(), 1).getTime(); to = now.getTime(); }
    else if (period === 'year') { from = new Date(today.getFullYear(), 0, 1).getTime(); to = now.getTime(); }
    else if (period === 'prev_month') {
      const pm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      from = pm.getTime(); to = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999).getTime();
    }
    else if (period === 'prev_week') {
      const dow = (today.getDay() + 6) % 7;
      const monThisWeek = new Date(today); monThisWeek.setDate(today.getDate() - dow);
      const monPrevWeek = new Date(monThisWeek); monPrevWeek.setDate(monThisWeek.getDate() - 7);
      const sunPrevWeek = new Date(monThisWeek); sunPrevWeek.setDate(monThisWeek.getDate() - 1); sunPrevWeek.setHours(23,59,59,999);
      from = monPrevWeek.getTime(); to = sunPrevWeek.getTime();
    }
    else if (period && period.startsWith('custom:')) {
      const parts = period.split(':');
      if (parts.length >= 3) { from = new Date(parts[1]).getTime(); to = new Date(parts[2]).getTime() + 86399999; }
    }
    return { from, to };
  }

  function _inPeriod(dateVal, pd) {
    if (!pd.from && !pd.to) return true;
    const d = _toDate(dateVal);
    if (!d) return false;
    const ms = d.getTime();
    if (pd.from && ms < pd.from) return false;
    if (pd.to && ms > pd.to) return false;
    return true;
  }

  // ── Sheets row helpers ────────────────────────────────────────────

  async function _rows(ssId, sheet) {
    const data = await SHEETS.getRange(ssId, `${sheet}!A2:ZZ`);
    return data || [];
  }

  function _pad(row, n) {
    const r = row.slice();
    while (r.length < n) r.push('');
    return r;
  }

  function _clean(row) {
    return row.map(v => {
      if (v instanceof Date) return v.toISOString();
      if (v === null || v === undefined) return '';
      return v;
    });
  }

  async function _append(ssId, sheet, row) {
    await SHEETS.append(ssId, `${sheet}!A:ZZ`, [_clean(_pad(row, row.length))]);
  }

  async function _updateRow(ssId, sheet, arrIdx, row) {
    const n = arrIdx + 2;
    await SHEETS.update(ssId, `${sheet}!A${n}`, [_clean(_pad(row, row.length))]);
  }

  async function _deleteRow(ssId, sheet, arrIdx) {
    const key = ssId + ':' + sheet;
    if (_sheetIds[key] === undefined) await _loadMeta(ssId);
    const sheetId = _sheetIds[key];
    if (sheetId === undefined) throw new Error('Sheet not found: ' + sheet);
    // arrIdx 0 = first data row = sheet row 2 = 0-based index 1
    await SHEETS.deleteRows(ssId, sheetId, arrIdx + 1, arrIdx + 2);
    _cache.delete(ssId + ':' + sheet);
  }

  async function _loadMeta(ssId) {
    const meta = await SHEETS.getMeta(ssId);
    (meta.sheets || []).forEach(s => {
      _sheetIds[ssId + ':' + s.properties.title] = s.properties.sheetId;
    });
  }

  function _makeHeaderReq(sheetId, headers) {
    return {
      updateCells: {
        rows: [{ values: headers.map(h => ({ userEnteredValue: { stringValue: String(h) } })) }],
        fields: 'userEnteredValue',
        start: { sheetId, rowIndex: 0, columnIndex: 0 }
      }
    };
  }

  // ── Profile SS helpers ────────────────────────────────────────────

  function _profileSsId() { return localStorage.getItem('auron_ssid') || null; }
  function _setProfileSsId(id) { localStorage.setItem('auron_ssid', id); }

  // ── ensureSheets: create any missing sheets ───────────────────────
  const SHEET_HEADERS = {
    [SH_BASE]:      ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена'],
    [SH_ACCOUNTS]:  ['ID','Название','Нач_Баланс','Статус','Иконка','Цвет'],
    [SH_SHIFTS]:    ['ID','Дата','Смена','Кассир','Rows_JSON','Wyplatas_JSON','Расхождение','Создано'],
    [SH_DEBTS]:     ['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','Создано','Накладная','Статус'],
    [SH_TIMESHEET]: ['Год','Месяц','День','Сотрудник','Приход','Уход','Статус','Часы','Ставка','Комментарий'],
    [SH_SETTINGS]:  ['Ключ','Значение'],
    [SH_TRASH]:     ['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','Сотрудник','Комментарий','Чек','Z_Ref','Locked','Смена','Удалено'],
    [SH_RECURRING]: ['ID','Название','Категория','Сумма','Счёт','День','Активна','Создано'],
    [SH_PAYMENTS]:  ['ID','Контрагент','Сумма','Комментарий','Дата','Статус','Назначение','Создано','Оплачено']
  };

  async function ensureSheets(ssId) {
    const meta = await SHEETS.getMeta(ssId);
    const existing = new Set((meta.sheets || []).map(s => s.properties.title));
    (meta.sheets || []).forEach(s => {
      _sheetIds[ssId + ':' + s.properties.title] = s.properties.sheetId;
    });
    for (const [name, hdrs] of Object.entries(SHEET_HEADERS)) {
      if (!existing.has(name)) {
        const res = await SHEETS.addSheet(ssId, name);
        const sheetId = res.replies[0].addSheet.properties.sheetId;
        _sheetIds[ssId + ':' + name] = sheetId;
        await SHEETS.update(ssId, `${name}!A1`, [hdrs]);
      }
    }
  }

  // ── Module: AUTH ──────────────────────────────────────────────────

  async function _findProfileInDrive() {
    try {
      const files = await DRIVE.findByName(PROFILE_NAME);
      if (files.length > 0) {
        _setProfileSsId(files[0].id);
        return files[0].id;
      }
    } catch (_) {}
    return null;
  }

  async function initUserApp() {
    let ssId = _profileSsId();
    // If not cached locally, search the user's Drive — works cross-device / after cache clear
    if (!ssId) ssId = await _findProfileInDrive();
    if (!ssId) return { isNew: true };
    try {
      const [profRows, orgRows] = await SHEETS.batchGet(ssId, [
        `${SH_PROFILE}!A2:B2`,
        `${SH_ORGS}!A2:C`
      ]);
      const profile = profRows[0] ? { name: String(profRows[0][0] || ''), phone: String(profRows[0][1] || '') } : {};
      const orgs = (orgRows || []).filter(r => r[0] && r[2]).map(r => ({
        id: String(r[0]), name: String(r[1] || ''), ssId: String(r[2])
      }));
      return { isNew: false, profile, orgs };
    } catch (e) {
      // Profile file exists but sheets are not set up (partial/failed registration).
      // Return isNew:true so the onboarding shows and registerUser can fix the profile.
      const msg = (e.message || '').toLowerCase();
      // Only re-throw auth errors — everything else is a broken/partial profile
      if (msg.includes('session expired') || msg.includes('401')) throw e;
      return { isNew: true };
    }
  }

  async function registerUser(p) {
    const name = _s(p.name), phone = _s(p.phone), orgName0 = _s(p.orgName || '') || 'Мой магазин';

    let profileSsId = _profileSsId() || await _findProfileInDrive();

    if (profileSsId) {
      // Profile file found — try fast path first
      let d;
      try { d = await initUserApp(); } catch (_) { d = null; }
      if (d && !d.isNew) {
        if (d.orgs && d.orgs.length) return { ssId: d.orgs[0].ssId, orgName: d.orgs[0].name };
        const res = await _createOrgSS(orgName0, profileSsId);
        return { ssId: res.ssId, orgName: orgName0 };
      }
      // Sheets are missing/broken — repair below
    } else {
      // Brand new user: create profile with both sheets in one API call
      const ss = await SHEETS.create({
        properties: { title: PROFILE_NAME },
        sheets: [
          { properties: { title: SH_PROFILE } },
          { properties: { title: SH_ORGS } }
        ]
      });
      profileSsId = ss.spreadsheetId;
      _setProfileSsId(profileSsId);
      const profSheetId = ss.sheets[0].properties.sheetId;
      const orgsSheetId = ss.sheets[1].properties.sheetId;
      await SHEETS.batchUpdate(profileSsId, [
        _makeHeaderReq(profSheetId, ['Имя', 'Телефон']),
        _makeHeaderReq(orgsSheetId, ['ID', 'Название', 'SS_ID'])
      ]);
      await SHEETS.append(profileSsId, `${SH_PROFILE}!A:B`, [[name, phone]]);
      const res = await _createOrgSS(orgName0, profileSsId);
      return { ssId: res.ssId, orgName: orgName0 };
    }

    // Repair: profile file exists but sheets are missing/malformed
    const meta = await SHEETS.getMeta(profileSsId);
    const existing = new Set((meta.sheets || []).map(s => s.properties.title));
    (meta.sheets || []).forEach(s => {
      _sheetIds[profileSsId + ':' + s.properties.title] = s.properties.sheetId;
    });

    if (!existing.has(SH_PROFILE)) {
      const defaultSheet = meta.sheets && meta.sheets[0];
      const sheetId = defaultSheet ? defaultSheet.properties.sheetId : null;
      const reqs = [];
      if (sheetId && defaultSheet.properties.title !== SH_PROFILE) {
        reqs.push({ updateSheetProperties: { properties: { sheetId, title: SH_PROFILE }, fields: 'title' } });
      }
      if (sheetId) reqs.push(_makeHeaderReq(sheetId, ['Имя', 'Телефон']));
      if (reqs.length) await SHEETS.batchUpdate(profileSsId, reqs);
      await SHEETS.append(profileSsId, `${SH_PROFILE}!A:B`, [[name, phone]]);
    }

    if (!existing.has(SH_ORGS)) {
      const res2 = await SHEETS.addSheet(profileSsId, SH_ORGS);
      const orgsSheetId = res2.replies[0].addSheet.properties.sheetId;
      await SHEETS.batchUpdate(profileSsId, [_makeHeaderReq(orgsSheetId, ['ID', 'Название', 'SS_ID'])]);
    } else {
      const orgRows = await SHEETS.getRange(profileSsId, `${SH_ORGS}!A2:C`);
      const validOrgs = (orgRows || []).filter(r => r[0] && r[2]);
      if (validOrgs.length) return { ssId: String(validOrgs[0][2]), orgName: String(validOrgs[0][1] || orgName0) };
    }

    const res = await _createOrgSS(orgName0, profileSsId);
    return { ssId: res.ssId, orgName: orgName0 };
  }

  async function _createOrgSS(name, profileSsId) {
    const sheetNames = Object.keys(SHEET_HEADERS);
    // Create org spreadsheet with all 9 sheets in one API call
    const ss = await SHEETS.create({
      properties: { title: ORG_PREFIX + name.replace(/[\/\\:*?"<>|]/g, '_') },
      sheets: sheetNames.map(t => ({ properties: { title: t } }))
    });
    const orgSsId = ss.spreadsheetId;
    const orgId = _uuid();
    // Cache sheet IDs from creation response
    (ss.sheets || []).forEach(s => {
      _sheetIds[orgSsId + ':' + s.properties.title] = s.properties.sheetId;
    });
    // Write all headers in one batch call
    const headerReqs = (ss.sheets || []).map(s => {
      const hdrs = SHEET_HEADERS[s.properties.title];
      return hdrs ? _makeHeaderReq(s.properties.sheetId, hdrs) : null;
    }).filter(Boolean);
    if (headerReqs.length) await SHEETS.batchUpdate(orgSsId, headerReqs);
    // Register org in profile
    await SHEETS.append(profileSsId, `${SH_ORGS}!A:C`, [[orgId, name, orgSsId]]);
    // Default accounts
    await SHEETS.append(orgSsId, `${SH_ACCOUNTS}!A:F`, [
      [_uuid(), 'Наличные', 0, 'active', '💵', '#10B981'],
      [_uuid(), 'Карта',    0, 'active', '💳', '#6366F1'],
      [_uuid(), 'СБП',      0, 'active', '📱', '#8B5CF6']
    ]);
    return { orgId, ssId: orgSsId };
  }

  async function createOrg(p) {
    const name = _s(p.name);
    const profileSsId = _profileSsId();
    if (!profileSsId) return { __error: 'Профиль не найден' };
    try {
      const res = await _createOrgSS(name, profileSsId);
      return { ssId: res.ssId, orgName: name };
    } catch (e) { return { __error: e.message }; }
  }

  async function deleteOrg(p) {
    const profileSsId = _profileSsId();
    if (!profileSsId) return { __error: 'Профиль не найден' };
    try {
      const rows = await _rows(profileSsId, SH_ORGS);
      const idx = rows.findIndex(r => String(r[2] || '') === String(p.ssId));
      if (idx < 0) return { __error: 'Не найдено' };
      await _deleteRow(profileSsId, SH_ORGS, idx);
      if (p.trash) await DRIVE.trashFile(p.ssId).catch(() => {});
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  function logoutUser() {
    AUTH.signOut();
    return { ok: true };
  }

  // ── Module: ACCOUNTS ─────────────────────────────────────────────

  async function getAccounts(p) {
    const ssId = p.ssId || p;
    try {
      const [accRows, baseRows] = await SHEETS.batchGet(ssId, [`${SH_ACCOUNTS}!A2:F`, `${SH_BASE}!A2:G`]);
      const accounts = (accRows || []).filter(r => r[0] && String(r[3] || '') !== 'archived').map(r => ({
        id: String(r[0]), name: String(r[1] || ''), startBalance: parseFloat(r[2]) || 0,
        status: String(r[3] || 'active'), icon: String(r[4] || '💰'), color: String(r[5] || '#6366F1'), balance: parseFloat(r[2]) || 0
      }));
      const bals = {};
      accounts.forEach(a => { bals[a.name] = a.startBalance; });
      (baseRows || []).forEach(r => {
        const t = String(r[B_TYPE - 1] || ''), amt = parseFloat(r[B_AMT - 1]) || 0, acc = String(r[B_ACC - 1] || '');
        if (!bals.hasOwnProperty(acc)) bals[acc] = 0;
        if (t === 'Доход') bals[acc] += amt;
        else if (t === 'Расход') bals[acc] -= amt;
      });
      accounts.forEach(a => { a.balance = Math.round(bals[a.name] || 0); });
      return accounts;
    } catch (e) { return []; }
  }

  async function getAccountsAll(p) {
    const ssId = p.ssId || p;
    try {
      const [accRows, baseRows] = await SHEETS.batchGet(ssId, [`${SH_ACCOUNTS}!A2:F`, `${SH_BASE}!A2:G`]);
      const accounts = (accRows || []).filter(r => r[0]).map(r => ({
        id: String(r[0]), name: String(r[1] || ''), startBalance: parseFloat(r[2]) || 0,
        status: String(r[3] || 'active'), icon: String(r[4] || '💰'), color: String(r[5] || '#6366F1'), balance: parseFloat(r[2]) || 0
      }));
      const bals = {};
      accounts.forEach(a => { bals[a.name] = a.startBalance; });
      (baseRows || []).forEach(r => {
        const t = String(r[B_TYPE - 1] || ''), amt = parseFloat(r[B_AMT - 1]) || 0, acc = String(r[B_ACC - 1] || '');
        if (!bals.hasOwnProperty(acc)) bals[acc] = 0;
        if (t === 'Доход') bals[acc] += amt;
        else if (t === 'Расход') bals[acc] -= amt;
      });
      accounts.forEach(a => { a.balance = Math.round(bals[a.name] || 0); });
      return accounts;
    } catch (e) { return []; }
  }

  async function saveAccount(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      await ensureSheets(ssId);
      const id = d.id || _uuid();
      const row = [id, _s(d.name), parseFloat(d.startBalance) || 0, 'active', d.icon || '💰', d.color || '#6366F1'];
      if (d.id) {
        const rows = await _rows(ssId, SH_ACCOUNTS);
        const idx = rows.findIndex(r => String(r[0] || '') === String(d.id));
        if (idx >= 0) { await _updateRow(ssId, SH_ACCOUNTS, idx, row); return { ok: true }; }
      }
      await _append(ssId, SH_ACCOUNTS, row);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function deleteAccount(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_ACCOUNTS);
      const idx = rows.findIndex(r => String(r[0] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const row = _pad(rows[idx].slice(), 6);
      row[3] = 'archived';
      await _updateRow(ssId, SH_ACCOUNTS, idx, row);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function toggleAccountVisibility(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_ACCOUNTS);
      const idx = rows.findIndex(r => String(r[0] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const row = _pad(rows[idx].slice(), 6);
      row[3] = row[3] === 'hidden' ? 'active' : 'hidden';
      await _updateRow(ssId, SH_ACCOUNTS, idx, row);
      return { ok: true, status: row[3] };
    } catch (e) { return { __error: e.message }; }
  }

  async function adjustBalance(p) {
    const ssId = p.ssId, d = p.data || {};
    const amt = Math.round(parseFloat(d.amount) || 0);
    if (!amt) return { __error: 'Сумма не указана' };
    return saveQuickEntry({ ssId, data: {
      uuid: _uuid(), date: _now(),
      type: amt > 0 ? 'Доход' : 'Расход', category: 'Корректировка',
      account: _s(d.account), amount: Math.abs(amt), comment: _s(d.comment || 'Корректировка баланса')
    }});
  }

  // ── Module: TRANSACTIONS ─────────────────────────────────────────

  async function saveQuickEntry(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      await ensureSheets(ssId);
      const uid = d.uuid || _uuid();
      // Idempotency check
      if (d.uuid) {
        const existing = await _rows(ssId, SH_BASE);
        if (existing.some(r => String(r[B_UUID - 1] || '') === uid)) return { ok: true, duplicate: true };
      }
      const id = _uuid();
      const dt = d.date ? d.date : _now();
      const row = [id, uid, dt, _s(d.type), _s(d.category || ''),
        Math.round(parseFloat(d.amount) || 0), _s(d.account || ''), _s(d.employee || ''),
        _s(d.comment || ''), _s(d.receiptUrl || ''), d.zRef || '', d.locked ? 'true' : 'false', _s(d.shift || '')];
      await _append(ssId, SH_BASE, row);
      _cache.delete(ssId + ':home');
      return { ok: true, id };
    } catch (e) { return { __error: e.message }; }
  }

  async function saveTransfer(p) {
    const ssId = p.ssId, d = p.data || {};
    const ref = _uuid();
    const r1 = await saveQuickEntry({ ssId, data: {
      uuid: d.uuid + '_out', date: d.date, type: 'Расход', category: 'Перевод',
      account: d.account, amount: d.amount, comment: d.comment || ('→ ' + d.toAccount), zRef: ref, shift: d.shift
    }});
    if (r1.__error) return r1;
    const r2 = await saveQuickEntry({ ssId, data: {
      uuid: d.uuid + '_in', date: d.date, type: 'Доход', category: 'Перевод',
      account: d.toAccount, amount: d.amount, comment: d.comment || ('← ' + d.account), zRef: ref, shift: d.shift
    }});
    if (r2.__error) {
      await deleteTransaction({ ssId, id: r1.id }).catch(() => {});
      return r2;
    }
    return r2;
  }

  async function deleteTransaction(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_BASE);
      const idx = rows.findIndex(r => String(r[B_ID - 1] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const row = rows[idx];
      if (_bool(row[B_LOCK - 1])) return { __error: 'Запись заблокирована Z-отчётом' };
      // Move to trash
      const trashRow = _pad(row.slice(), TR_COLS);
      trashRow[TR_COLS - 1] = _now();
      await _append(ssId, SH_TRASH, trashRow);
      await _deleteRow(ssId, SH_BASE, idx);
      _cache.delete(ssId + ':home');
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function editTransaction(p) {
    const ssId = p.ssId, id = p.id, d = p.data || {};
    try {
      const rows = await _rows(ssId, SH_BASE);
      const idx = rows.findIndex(r => String(r[B_ID - 1] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const existing = _pad(rows[idx].slice(), B_COLS);
      if (_bool(existing[B_LOCK - 1])) return { __error: 'Запись заблокирована Z-отчётом' };
      if (d.date !== undefined) existing[B_DATE - 1] = d.date;
      if (d.type !== undefined) existing[B_TYPE - 1] = _s(d.type);
      if (d.category !== undefined) existing[B_CAT - 1] = _s(d.category);
      if (d.amount !== undefined) existing[B_AMT - 1] = Math.round(parseFloat(d.amount) || 0);
      if (d.account !== undefined) existing[B_ACC - 1] = _s(d.account);
      if (d.employee !== undefined) existing[B_EMP - 1] = _s(d.employee);
      if (d.comment !== undefined) existing[B_CMT - 1] = _s(d.comment);
      if (d.shift !== undefined) existing[B_SHIFT - 1] = _s(d.shift);
      await _updateRow(ssId, SH_BASE, idx, existing);
      _cache.delete(ssId + ':home');
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  function _txObj(r) {
    const d = r[B_DATE - 1];
    const type = String(r[B_TYPE - 1] || ''), cat = String(r[B_CAT - 1] || ''), cmt = String(r[B_CMT - 1] || '');
    let toAccount = null;
    if (type === 'Расход' && cat === 'Перевод') { const m = cmt.match(/^→\s*(.+)/); if (m) toAccount = m[1].trim(); }
    return {
      id: String(r[B_ID - 1] || ''), date: _iso(d),
      type, category: cat, account: String(r[B_ACC - 1] || ''),
      amount: parseFloat(r[B_AMT - 1]) || 0, comment: cmt,
      employee: String(r[B_EMP - 1] || ''), receipt: String(r[B_REC - 1] || ''),
      shift: String(r[B_SHIFT - 1] || ''), locked: _bool(r[B_LOCK - 1]),
      toAccount
    };
  }

  async function getHomeSummary(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const cKey = ssId + ':home:' + period;
      if (_cache.has(cKey)) return _cache.get(cKey);
      const [accRows, baseRows, shiftRows] = await SHEETS.batchGet(ssId, [
        `${SH_ACCOUNTS}!A2:F`, `${SH_BASE}!A2:M`, `${SH_SHIFTS}!A2:H`
      ]);
      // Build accounts with balances
      const accounts = (accRows || []).filter(r => r[0] && String(r[3] || '') !== 'archived').map(r => ({
        id: String(r[0]), name: String(r[1] || ''), startBalance: parseFloat(r[2]) || 0,
        status: String(r[3] || 'active'), balance: parseFloat(r[2]) || 0
      }));
      const bals = {};
      accounts.forEach(a => { bals[a.name] = a.startBalance; });
      const pd = _period(period);
      const totals = {};
      accounts.forEach(a => { totals[a.name] = { income: 0, expense: 0 }; });
      let sumInc = 0, sumExp = 0, txCnt = 0;
      const allBase = baseRows || [];
      allBase.forEach(r => {
        const acc = String(r[B_ACC - 1] || '');
        const t = String(r[B_TYPE - 1] || ''), amt = parseFloat(r[B_AMT - 1]) || 0;
        if (!bals.hasOwnProperty(acc)) bals[acc] = 0;
        if (t === 'Доход') bals[acc] += amt;
        else if (t === 'Расход') bals[acc] -= amt;
        if (_inPeriod(r[B_DATE - 1], pd)) {
          if (!totals[acc]) totals[acc] = { income: 0, expense: 0 };
          if (t === 'Доход') { totals[acc].income += amt; sumInc += amt; txCnt++; }
          else if (t === 'Расход') { totals[acc].expense += amt; sumExp += amt; txCnt++; }
        }
      });
      accounts.forEach(a => { a.balance = Math.round(bals[a.name] || 0); });
      // Z-report revenue
      let shiftRev = 0;
      (shiftRows || []).forEach(sr => {
        if (!_inPeriod(sr[1], pd)) return;
        try { JSON.parse(sr[4] || '[]').forEach(row => { shiftRev += parseFloat(row.zAmount || 0); }); } catch (e) {}
      });
      // Last 60 transactions
      const txs = allBase.slice().reverse().slice(0, 60).map(_txObj);
      const res = { accounts, totals, transactions: txs, summary: { income: sumInc, expense: sumExp, count: txCnt, shiftRevenue: shiftRev } };
      _cache.set(cKey, res);
      setTimeout(() => _cache.delete(cKey), 60000);
      return res;
    } catch (e) { return { accounts: [], totals: {}, transactions: [], summary: { income: 0, expense: 0, count: 0, shiftRevenue: 0 }, __error: e.message }; }
  }

  async function getAllTransactions(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_BASE);
      return rows.map(_txObj).reverse();
    } catch (e) { return []; }
  }

  async function searchTransactions(p) {
    const ssId = p.ssId, q = String(p.query || '').toLowerCase();
    try {
      const rows = await _rows(ssId, SH_BASE);
      return rows.filter(r => {
        return String(r[B_AMT - 1] || '').includes(q) ||
               String(r[B_CMT - 1] || '').toLowerCase().includes(q) ||
               String(r[B_CAT - 1] || '').toLowerCase().includes(q) ||
               String(r[B_EMP - 1] || '').toLowerCase().includes(q);
      }).map(_txObj).reverse().slice(0, 50);
    } catch (e) { return []; }
  }

  async function getTrash(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_TRASH);
      return rows.map(r => ({
        id: String(r[0] || ''), date: _iso(r[2]),
        type: String(r[3] || ''), category: String(r[4] || ''),
        amount: parseFloat(r[5]) || 0, account: String(r[6] || ''),
        comment: String(r[8] || ''), deletedAt: _iso(r[TR_COLS - 1])
      })).reverse();
    } catch (e) { return []; }
  }

  async function cleanTrash(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_TRASH);
      const cutoff = Date.now() - 30 * 86400000;
      const toDelete = [];
      rows.forEach((r, i) => {
        const d = _toDate(r[TR_COLS - 1]);
        if (d && d.getTime() < cutoff) toDelete.push(i);
      });
      for (let i = toDelete.length - 1; i >= 0; i--) await _deleteRow(ssId, SH_TRASH, toDelete[i]);
      return { ok: true, removed: toDelete.length };
    } catch (e) { return { __error: e.message }; }
  }

  async function restoreFromTrash(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_TRASH);
      const idx = rows.findIndex(r => String(r[0] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const row = _pad(rows[idx].slice(0, B_COLS), B_COLS);
      await _append(ssId, SH_BASE, row);
      await _deleteRow(ssId, SH_TRASH, idx);
      _cache.delete(ssId + ':home');
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: SETTINGS ─────────────────────────────────────────────

  const SETT_DEFAULTS = {
    CATS:          '[]', CASHIERS: '[]',
    PAY_TYPES:     '["Наличные","Карта","СБП","Безналичный"]',
    REP_STATUSES:  '["✅ Оплачено","❌ Не оплачено","⛔ Отменён","🔄 Перенесён"]',
    EMPLOYEES: '[]', SHIFTS: '["Смена 1","Смена 2","Смена 3"]',
    SUPPLIERS: '[]', SHOW_KASSA_BALANCE: 'true'
  };

  async function getSettings(p) {
    const ssId = p.ssId || p;
    try {
      await ensureSheets(ssId);
      const rows = await _rows(ssId, SH_SETTINGS);
      const map = {};
      rows.forEach(r => { if (r[0]) map[String(r[0])] = String(r[1] || ''); });
      const gj = k => { try { return JSON.parse(map[k] || SETT_DEFAULTS[k] || 'null') || []; } catch (e) { return []; } };
      const gb = (k, def) => { const v = map[k]; if (!v) return def; return v === 'true' || v === '1'; };
      return {
        cats: gj('CATS'), cashiers: gj('CASHIERS'), payTypes: gj('PAY_TYPES'),
        repStatuses: gj('REP_STATUSES'), employees: gj('EMPLOYEES'), shifts: gj('SHIFTS'),
        suppliers: gj('SUPPLIERS'), showKassaBalance: gb('SHOW_KASSA_BALANCE', true)
      };
    } catch (e) {
      return { cats: [], cashiers: [], payTypes: ['Наличные', 'Карта', 'СБП'], repStatuses: [], employees: [], shifts: ['Смена 1', 'Смена 2'], suppliers: [], showKassaBalance: true };
    }
  }

  async function saveSettings(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      const save = {
        CATS: JSON.stringify(d.cats || []), CASHIERS: JSON.stringify(d.cashiers || []),
        PAY_TYPES: JSON.stringify(d.payTypes || []), REP_STATUSES: JSON.stringify(d.repStatuses || []),
        EMPLOYEES: JSON.stringify(d.employees || []), SHIFTS: JSON.stringify(d.shifts || []),
        SUPPLIERS: JSON.stringify(d.suppliers || []),
        SHOW_KASSA_BALANCE: d.showKassaBalance === false ? 'false' : 'true'
      };
      const rows = await _rows(ssId, SH_SETTINGS);
      const keyRow = {};
      rows.forEach((r, i) => { if (r[0]) keyRow[String(r[0])] = i; });
      for (const [k, v] of Object.entries(save)) {
        if (keyRow[k] !== undefined) await _updateRow(ssId, SH_SETTINGS, keyRow[k], [k, v]);
        else await _append(ssId, SH_SETTINGS, [k, v]);
      }
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: Z-REPORT ─────────────────────────────────────────────

  async function saveKassa(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      await ensureSheets(ssId);
      const dt = d.date || _now();
      const zRef = _uuid();
      const rows = d.rows || [], wyplatas = d.wyplatas || [];
      let zTotal = 0, factTotal = 0;
      const baseEntries = [];
      rows.forEach(row => {
        const z = parseFloat(row.zAmount) || 0, f = parseFloat(row.factAmount) || 0;
        zTotal += z; factTotal += f;
        if (z > 0) baseEntries.push([_uuid(), _uuid(), dt, 'Доход', 'Z-отчёт',
          Math.round(z), _s(row.account), _s(d.cashier || ''), '', '', zRef, 'true', _s(d.shift || '')]);
      });
      wyplatas.forEach(w => {
        const amt = parseFloat(w.amount) || 0; if (!amt) return;
        baseEntries.push([_uuid(), _uuid(), dt, 'Расход', _s(w.category || 'Выплата'),
          Math.round(amt), _s(w.account || 'Наличные'), _s(d.cashier || ''), _s(w.desc || 'Выплата'), '', zRef, 'true', _s(d.shift || '')]);
      });
      if (baseEntries.length) await SHEETS.append(ssId, `${SH_BASE}!A:M`, baseEntries);
      const disc = Math.round(factTotal - zTotal);
      const shiftId = _uuid();
      await _append(ssId, SH_SHIFTS, [
        shiftId, dt, _s(d.shift || ''), _s(d.cashier || ''),
        JSON.stringify(rows), JSON.stringify(wyplatas), disc, _now()
      ]);
      _cache.delete(ssId + ':home');
      return { ok: true, shiftId, discrepancy: disc };
    } catch (e) { return { __error: e.message }; }
  }

  async function getShifts(p) {
    const ssId = p.ssId, limit = parseInt(p.limit) || 50;
    try {
      const rows = await _rows(ssId, SH_SHIFTS);
      return rows.map(r => {
        let rj = []; try { rj = JSON.parse(r[4] || '[]'); } catch (e) {}
        let wyp = []; try { wyp = JSON.parse(r[5] || '[]'); } catch (e) {}
        const rev = rj.reduce((s, x) => s + (parseFloat(x.zAmount) || 0), 0);
        return { id: String(r[0] || ''), date: _iso(r[1]), shift: String(r[2] || ''),
                 cashier: String(r[3] || ''), revenue: Math.round(rev),
                 discrepancy: parseFloat(r[6]) || 0, rows: rj, wyplatas: wyp };
      }).reverse().slice(0, limit);
    } catch (e) { return []; }
  }

  async function cancelShift(p) {
    const ssId = p.ssId, shiftId = p.shiftId;
    try {
      // Unlock base entries with matching zRef
      const baseRows = await _rows(ssId, SH_BASE);
      const shiftRows = await _rows(ssId, SH_SHIFTS);
      const shIdx = shiftRows.findIndex(r => String(r[0] || '') === String(shiftId));
      if (shIdx < 0) return { __error: 'Смена не найдена' };
      // Find zRef for this shift
      const shiftRow = shiftRows[shIdx];
      // Unlock only base entries whose zRef matches this shift row's ID
      const shiftZRef = String(shiftRow[0] || '');
      for (let i = 0; i < baseRows.length; i++) {
        const zRef = String(baseRows[i][B_ZREF - 1] || '');
        if (_bool(baseRows[i][B_LOCK - 1]) && zRef === shiftZRef) {
          const row = _pad(baseRows[i].slice(), B_COLS);
          row[B_LOCK - 1] = 'false';
          await _updateRow(ssId, SH_BASE, i, row);
        }
      }
      await _deleteRow(ssId, SH_SHIFTS, shIdx);
      _cache.delete(ssId + ':home');
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: DEBTS ────────────────────────────────────────────────

  async function getDebts(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_DEBTS);
      const map = {};
      rows.forEach(r => {
        const rep = String(r[D_REP - 1] || ''), type = String(r[D_TYPE - 1] || '');
        const amt = parseFloat(r[D_AMT - 1]) || 0, status = String(r[D_STATUS - 1] || '');
        const id = String(r[D_ID - 1] || '');
        if (!map[rep]) map[rep] = { id: rep, name: rep, debt: 0, totalBuy: 0, totalPay: 0, txCount: 0 };
        if (status !== 'отменён' && status !== 'cancelled') {
          if (type === 'закупка' || type === 'начальный_долг') { map[rep].debt += amt; map[rep].totalBuy += amt; }
          else if (type === 'оплата') { map[rep].debt -= amt; map[rep].totalPay += amt; }
          map[rep].txCount++;
        }
      });
      return Object.values(map).map(r => ({ ...r, debt: Math.round(r.debt), totalBuy: Math.round(r.totalBuy), totalPay: Math.round(r.totalPay) }));
    } catch (e) { return []; }
  }

  async function saveRep(p) {
    const ssId = p.ssId, d = p.data || {};
    const name = _s(d.name);
    if (!name) return { __error: 'Название обязательно' };
    try {
      if (parseFloat(d.initialDebt) > 0) {
        await _append(ssId, SH_DEBTS, [_uuid(), name, 'начальный_долг', Math.round(parseFloat(d.initialDebt) || 0), _now(), '', _s(d.comment || ''), _now(), '', 'активен']);
      }
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function saveDebtEntry(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      await _append(ssId, SH_DEBTS, [_uuid(), _s(d.repName || d.repId || ''), _s(d.type || 'закупка'),
        Math.round(parseFloat(d.amount) || 0), d.date || _now(), _s(d.account || ''),
        _s(d.comment || ''), _now(), _s(d.invoice || ''), d.status || 'активен']);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function updateDebtEntry(p) {
    const ssId = p.ssId, id = p.id, d = p.data || {};
    try {
      const rows = await _rows(ssId, SH_DEBTS);
      const idx = rows.findIndex(r => String(r[D_ID - 1] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      const row = _pad(rows[idx].slice(), D_COLS);
      if (d.amount !== undefined) row[D_AMT - 1] = Math.round(parseFloat(d.amount) || 0);
      if (d.comment !== undefined) row[D_CMT - 1] = _s(d.comment);
      if (d.invoice !== undefined) row[D_INV - 1] = _s(d.invoice);
      if (d.status !== undefined) row[D_STATUS - 1] = _s(d.status);
      if (d.account !== undefined) row[D_ACC - 1] = _s(d.account);
      await _updateRow(ssId, SH_DEBTS, idx, row);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function deleteDebtEntry(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_DEBTS);
      const idx = rows.findIndex(r => String(r[D_ID - 1] || '') === String(id));
      if (idx < 0) return { __error: 'not found' };
      await _deleteRow(ssId, SH_DEBTS, idx);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function getRepDebt(p) {
    const ssId = p.ssId, repId = String(p.repId || '');
    try {
      const rows = await _rows(ssId, SH_DEBTS);
      return rows.filter(r => String(r[D_REP - 1] || '') === repId).map(r => ({
        id: String(r[D_ID - 1] || ''), repId: String(r[D_REP - 1] || ''),
        type: String(r[D_TYPE - 1] || ''), amount: parseFloat(r[D_AMT - 1]) || 0,
        date: _iso(r[D_DATE - 1]), account: String(r[D_ACC - 1] || ''),
        comment: String(r[D_CMT - 1] || ''), invoice: String(r[D_INV - 1] || ''),
        status: String(r[D_STATUS - 1] || '')
      })).reverse();
    } catch (e) { return []; }
  }

  async function updateDebtStatus(p) {
    return updateDebtEntry({ ssId: p.ssId, id: p.id, data: { status: p.status } });
  }

  // ── Module: TIMESHEET ────────────────────────────────────────────

  async function getTimesheetMonth(p) {
    const ssId = p.ssId, year = parseInt(p.year), month = parseInt(p.month);
    try {
      const rows = await _rows(ssId, SH_TIMESHEET);
      const days = rows.filter(r => parseInt(r[0]) === year && parseInt(r[1]) === month).map(r => ({
        year: parseInt(r[0]), month: parseInt(r[1]), day: parseInt(r[2]),
        employee: String(r[3] || ''), timeIn: String(r[4] || ''), timeOut: String(r[5] || ''),
        status: String(r[6] || 'П'), hours: parseFloat(r[7]) || 0, rate: parseFloat(r[8]) || 0, comment: String(r[9] || '')
      }));
      return { year, month, days };
    } catch (e) { return { year: 0, month: 0, days: [] }; }
  }

  async function saveTimesheetEntry(p) {
    const ssId = p.ssId, year = parseInt(p.year), month = parseInt(p.month), day = parseInt(p.day);
    const d = p.data || {};
    try {
      const rows = await _rows(ssId, SH_TIMESHEET);
      const idx = rows.findIndex(r => parseInt(r[0]) === year && parseInt(r[1]) === month && parseInt(r[2]) === day);
      const row = [year, month, day, _s(d.employee || ''), _s(d.timeIn || ''), _s(d.timeOut || ''),
        _s(d.status || 'П'), parseFloat(d.hours) || 0, parseFloat(d.rate) || 0, _s(d.comment || '')];
      if (idx >= 0) await _updateRow(ssId, SH_TIMESHEET, idx, row);
      else await _append(ssId, SH_TIMESHEET, row);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: ANALYTICS ────────────────────────────────────────────

  async function getAnalytics(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const rows = await _rows(ssId, SH_BASE);
      const pd = _period(period);
      let income = 0, expense = 0;
      const catMap = {}, dayMap = {}, hm = [0,0,0,0,0,0,0];
      rows.forEach(r => {
        if (!_inPeriod(r[B_DATE - 1], pd)) return;
        const d = _toDate(r[B_DATE - 1]);
        const t = String(r[B_TYPE - 1] || ''), cat = String(r[B_CAT - 1] || ''), amt = parseFloat(r[B_AMT - 1]) || 0;
        const dk = d ? d.toISOString().substring(0, 10) : '';
        if (!dayMap[dk]) dayMap[dk] = { income: 0, expense: 0 };
        if (t === 'Доход') {
          income += amt; dayMap[dk].income += amt;
          if (d) { const dow = d.getDay(); hm[dow === 0 ? 6 : dow - 1] += amt; }
          if (cat !== 'Перевод') { if (!catMap[cat]) catMap[cat] = { total: 0, type: 'income' }; catMap[cat].total += amt; }
        } else if (t === 'Расход') {
          expense += amt; dayMap[dk].expense += amt;
          if (cat !== 'Перевод') { if (!catMap[cat]) catMap[cat] = { total: 0, type: 'expense' }; catMap[cat].total += amt; }
        }
      });
      const byCategory = Object.entries(catMap).map(([k, v]) => ({ category: k, total: Math.round(v.total), type: v.type })).sort((a, b) => b.total - a.total);
      const timeline = Object.entries(dayMap).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ date: k, income: Math.round(v.income), expense: Math.round(v.expense) }));
      const heatmap = hm.map((a, i) => ({ dow: i + 1, amount: Math.round(a) }));
      const debts = await getDebts({ ssId });
      return { income: Math.round(income), expense: Math.round(expense), profit: Math.round(income - expense), byCategory, timeline, heatmap, totalDebt: debts.reduce((s, d) => s + (d.debt || 0), 0) };
    } catch (e) { return { income: 0, expense: 0, profit: 0, byCategory: [], timeline: [], heatmap: [], totalDebt: 0 }; }
  }

  async function getGrowthData(p) {
    const ssId = p.ssId;
    try {
      const [mCur, mPrev, wCur, wPrev] = await Promise.all([
        getAnalytics({ ssId, period: 'month' }), getAnalytics({ ssId, period: 'prev_month' }),
        getAnalytics({ ssId, period: 'week' }),  getAnalytics({ ssId, period: 'prev_week' })
      ]);
      const pct = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : null;
      return {
        month: { income: mCur.income, expense: mCur.expense, profit: mCur.profit, incomePct: pct(mCur.income, mPrev.income), expensePct: pct(mCur.expense, mPrev.expense), profitPct: pct(mCur.profit, mPrev.profit) },
        week:  { income: wCur.income, expense: wCur.expense, profit: wCur.profit, incomePct: pct(wCur.income, wPrev.income), expensePct: pct(wCur.expense, wPrev.expense) }
      };
    } catch (e) { return { month: {}, week: {} }; }
  }

  async function getCashierAnalytics(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const rows = await _rows(ssId, SH_SHIFTS);
      const pd = _period(period);
      const map = {};
      rows.forEach(r => {
        if (!_inPeriod(r[1], pd)) return;
        const c = String(r[3] || ''); if (!c) return;
        if (!map[c]) map[c] = { name: c, revenue: 0, shifts: 0, discrepancy: 0 };
        let rj = []; try { rj = JSON.parse(r[4] || '[]'); } catch (e) {}
        const rev = rj.reduce((s, x) => s + (parseFloat(x.zAmount) || 0), 0);
        map[c].revenue += rev; map[c].shifts++; map[c].discrepancy += parseFloat(r[6]) || 0;
      });
      const list = Object.values(map).map(c => ({ ...c, revenue: Math.round(c.revenue), discrepancy: Math.round(c.discrepancy) })).sort((a, b) => b.revenue - a.revenue);
      const hm = [0,0,0,0,0,0,0];
      rows.forEach(r => {
        if (!_inPeriod(r[1], pd)) return;
        const d = _toDate(r[1]); if (!d) return;
        let rj = []; try { rj = JSON.parse(r[4] || '[]'); } catch (e) {}
        const rev = rj.reduce((s, x) => s + (parseFloat(x.zAmount) || 0), 0);
        const dow = d.getDay(); hm[dow === 0 ? 6 : dow - 1] += rev;
      });
      return { list, heatmap: hm.map((a, i) => ({ dow: i + 1, amount: Math.round(a) })) };
    } catch (e) { return { list: [], heatmap: [] }; }
  }

  async function getCashierShifts(p) {
    const ssId = p.ssId, cashier = String(p.cashier || '');
    try {
      const rows = await _rows(ssId, SH_SHIFTS);
      return rows.filter(r => String(r[3] || '') === cashier).map(r => {
        let rj = []; try { rj = JSON.parse(r[4] || '[]'); } catch (e) {}
        const rev = rj.reduce((s, x) => s + (parseFloat(x.zAmount) || 0), 0);
        return { id: String(r[0] || ''), date: _iso(r[1]), shift: String(r[2] || ''), revenue: Math.round(rev), discrepancy: parseFloat(r[6]) || 0 };
      }).reverse();
    } catch (e) { return []; }
  }

  async function getShiftAnalytics(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const rows = await _rows(ssId, SH_SHIFTS);
      const pd = _period(period);
      const shiftMap = {};
      let total = 0, totalDisc = 0;
      const byDay = {};
      rows.forEach(r => {
        if (!_inPeriod(r[1], pd)) return;
        const sn = String(r[2] || 'Смена');
        let rj = []; try { rj = JSON.parse(r[4] || '[]'); } catch (e) {}
        const rev = rj.reduce((s, x) => s + (parseFloat(x.zAmount) || 0), 0);
        const disc = parseFloat(r[6]) || 0;
        total += rev; totalDisc += disc;
        if (!shiftMap[sn]) shiftMap[sn] = { name: sn, revenue: 0, count: 0, discrepancy: 0 };
        shiftMap[sn].revenue += rev; shiftMap[sn].count++; shiftMap[sn].discrepancy += disc;
        const dk = _iso(r[1]).substring(0, 10);
        if (!byDay[dk]) byDay[dk] = 0;
        byDay[dk] += rev;
      });
      const byShift = Object.values(shiftMap).map(s => ({ ...s, revenue: Math.round(s.revenue), discrepancy: Math.round(s.discrepancy), avgRevenue: s.count > 0 ? Math.round(s.revenue / s.count) : 0 })).sort((a, b) => b.revenue - a.revenue);
      const byDayArr = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: k.substring(5), revenue: Math.round(v) }));
      return { total: Math.round(total), totalDisc: Math.round(totalDisc), byShift, byDay: byDayArr };
    } catch (e) { return { total: 0, totalDisc: 0, byShift: [], byDay: [] }; }
  }

  async function getSupplierAnalytics(p) {
    const ssId = p.ssId;
    try {
      const debts = await getDebts({ ssId });
      const total = debts.reduce((s, d) => s + d.totalBuy, 0);
      const totalPay = debts.reduce((s, d) => s + d.totalPay, 0);
      const totalDebt = debts.reduce((s, d) => s + d.debt, 0);
      const suppliers = debts.sort((a, b) => b.totalBuy - a.totalBuy).slice(0, 10).map(d => ({
        id: d.id, name: d.name, totalBuy: d.totalBuy, totalPay: d.totalPay, debt: d.debt,
        txCount: d.txCount, payRatio: d.totalBuy > 0 ? Math.round(d.totalPay / d.totalBuy * 100) : 0
      }));
      return { suppliers, totalBuy: Math.round(total), totalPay: Math.round(totalPay), totalDebt: Math.round(totalDebt) };
    } catch (e) { return { suppliers: [], totalBuy: 0, totalPay: 0, totalDebt: 0 }; }
  }

  async function getAccountFlow(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const rows = await _rows(ssId, SH_BASE);
      const pd = _period(period);
      const map = {};
      rows.forEach(r => {
        if (!_inPeriod(r[B_DATE - 1], pd)) return;
        const acc = String(r[B_ACC - 1] || ''), t = String(r[B_TYPE - 1] || ''), amt = parseFloat(r[B_AMT - 1]) || 0;
        if (!map[acc]) map[acc] = { name: acc, income: 0, expense: 0, txCount: 0 };
        if (t === 'Доход') map[acc].income += amt;
        else if (t === 'Расход') map[acc].expense += amt;
        map[acc].txCount++;
      });
      const accounts = Object.values(map).map(a => ({ ...a, income: Math.round(a.income), expense: Math.round(a.expense), net: Math.round(a.income - a.expense) })).sort((a, b) => b.income - a.income);
      return { accounts };
    } catch (e) { return { accounts: [] }; }
  }

  async function getDebtAnalytics(p) {
    const ssId = p.ssId;
    try {
      const debts = await getDebts({ ssId });
      const totalDebt = debts.reduce((s, d) => s + d.debt, 0);
      const totalBuy = debts.reduce((s, d) => s + d.totalBuy, 0);
      const totalPay = debts.reduce((s, d) => s + d.totalPay, 0);
      return { totalDebt: Math.round(totalDebt), totalBuy: Math.round(totalBuy), totalPay: Math.round(totalPay), count: debts.length, topReps: debts.filter(d => d.debt > 0).sort((a, b) => b.debt - a.debt).slice(0, 5) };
    } catch (e) { return { totalDebt: 0, totalBuy: 0, totalPay: 0, count: 0, topReps: [] }; }
  }

  async function getTrendData(p) { return getGrowthData(p); }

  // ── Module: BUDGET ────────────────────────────────────────────────

  async function getBudget(p) {
    const ssId = p.ssId, period = p.period;
    try {
      const [settings, an] = await Promise.all([getSettings({ ssId }), getAnalytics({ ssId, period })]);
      const budgetMap = {};
      const rows = await _rows(ssId, SH_SETTINGS);
      rows.forEach(r => { if (String(r[0] || '') === 'BUDGET_MAP') { try { Object.assign(budgetMap, JSON.parse(r[1] || '{}')); } catch (e) {} } });
      const allCats = ['ЗП','Аренда','Закупка','Хозрасходы','Коммуналка','Реклама','Прочий расход','Налоги'].concat(settings.cats || []);
      const items = allCats.map(cat => {
        const found = an.byCategory.find(c => c.category === cat && c.type === 'expense');
        const actual = found ? found.total : 0;
        const planned = budgetMap[cat] || 0;
        return { category: cat, actual, planned, over: planned > 0 && actual > planned };
      }).filter(i => i.actual > 0 || i.planned > 0);
      return { budgetMap, items };
    } catch (e) { return { budgetMap: {}, items: [] }; }
  }

  async function saveBudget(p) {
    const ssId = p.ssId, budgetMap = p.budgetMap || {};
    try {
      const rows = await _rows(ssId, SH_SETTINGS);
      const idx = rows.findIndex(r => String(r[0] || '') === 'BUDGET_MAP');
      if (idx >= 0) await _updateRow(ssId, SH_SETTINGS, idx, ['BUDGET_MAP', JSON.stringify(budgetMap)]);
      else await _append(ssId, SH_SETTINGS, ['BUDGET_MAP', JSON.stringify(budgetMap)]);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: RECURRING ─────────────────────────────────────────────

  async function getRecurring(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_RECURRING);
      return rows.filter(r => r[0]).map(r => ({
        id: String(r[RC_ID-1]||''), name: String(r[RC_NAME-1]||''), category: String(r[RC_CAT-1]||''),
        amount: parseFloat(r[RC_AMT-1])||0, account: String(r[RC_ACC-1]||''), day: parseInt(r[RC_DAY-1])||1,
        active: _bool(r[RC_ACTIVE-1]), created: _iso(r[RC_CREATED-1])
      }));
    } catch (e) { return []; }
  }

  async function saveRecurring(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      const id = d.id || _uuid();
      const baseRow = [id, _s(d.name||''), _s(d.category||''), Math.round(parseFloat(d.amount)||0), _s(d.account||''), parseInt(d.day)||1, d.active!==false?'true':'false'];
      if (d.id) {
        const rows = await _rows(ssId, SH_RECURRING);
        const idx = rows.findIndex(r => String(r[0]||'')===String(d.id));
        if (idx >= 0) {
          const existing = _pad(rows[idx].slice(), RC_COLS);
          const row = [...baseRow, existing[RC_CREATED-1] || _now()];
          await _updateRow(ssId, SH_RECURRING, idx, row); return {ok:true};
        }
      }
      await _append(ssId, SH_RECURRING, [...baseRow, _now()]);
      return { ok: true, id };
    } catch (e) { return { __error: e.message }; }
  }

  async function deleteRecurring(p) {
    const ssId = p.ssId, id = p.id;
    try {
      const rows = await _rows(ssId, SH_RECURRING);
      const idx = rows.findIndex(r => String(r[0]||'')===String(id));
      if (idx < 0) return { __error: 'not found' };
      await _deleteRow(ssId, SH_RECURRING, idx);
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  async function applyRecurring(p) {
    const ssId = p.ssId;
    try {
      const recs = await getRecurring({ssId});
      const active = recs.filter(r => r.active);
      let applied = 0;
      for (const rec of active) {
        const res = await saveQuickEntry({ssId, data:{
          uuid:'rec_'+rec.id+'_'+new Date().toISOString().substring(0,7),
          date: new Date().toISOString(), type:'Расход', category:rec.category,
          account:rec.account, amount:rec.amount, comment:rec.name
        }});
        if (!res.__error) applied++;
      }
      return { applied };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: PAYMENTS ─────────────────────────────────────────────

  async function getPayments(p) {
    const ssId = p.ssId;
    try {
      const rows = await _rows(ssId, SH_PAYMENTS);
      return rows.filter(r => r[0]).map(r => ({
        id: String(r[PY_ID-1]||''), name: String(r[PY_NAME-1]||''), amount: parseFloat(r[PY_AMT-1])||0,
        account: String(r[PY_ACC-1]||''), due: _iso(r[PY_DUE-1]), status: String(r[PY_STATUS-1]||''),
        category: String(r[PY_CAT-1]||''), created: _iso(r[PY_CREATED-1]), paid: _iso(r[PY_PAID-1])
      })).reverse();
    } catch (e) { return []; }
  }

  async function savePayment(p) {
    const ssId = p.ssId, d = p.data || {};
    try {
      const id = d.id || _uuid();
      const row = [id, _s(d.name||''), Math.round(parseFloat(d.amount)||0), _s(d.account||''),
        d.due||_now(), d.status||'открыт', _s(d.category||''), d.id?undefined:_now(), ''].filter(v=>v!==undefined);
      if (d.id) {
        const rows = await _rows(ssId, SH_PAYMENTS);
        const idx = rows.findIndex(r=>String(r[0]||'')===String(d.id));
        if (idx>=0) { await _updateRow(ssId, SH_PAYMENTS, idx, [...row.slice(0,8), rows[idx][PY_PAID-1]||'']); return {ok:true}; }
      }
      await _append(ssId, SH_PAYMENTS, [...row.slice(0,8), '']);
      return { ok:true, id };
    } catch (e) { return { __error: e.message }; }
  }

  async function updatePayment(p) {
    const ssId = p.ssId, id = p.id, action = p.action;
    try {
      const rows = await _rows(ssId, SH_PAYMENTS);
      const idx = rows.findIndex(r=>String(r[0]||'')===String(id));
      if (idx<0) return {__error:'not found'};
      const row = _pad(rows[idx].slice(), PY_COLS);
      if (action==='pay') { row[PY_STATUS-1]='оплачен'; row[PY_PAID-1]=_now(); }
      else if (action==='postpone') { row[PY_STATUS-1]='перенесён'; if(p.newDue)row[PY_DUE-1]=p.newDue; }
      else if (action==='cancel') { row[PY_STATUS-1]='отменён'; }
      else if (action==='restore') { row[PY_STATUS-1]='открыт'; row[PY_PAID-1]=''; }
      await _updateRow(ssId, SH_PAYMENTS, idx, row);
      return { ok:true };
    } catch (e) { return { __error: e.message }; }
  }

  async function markPaymentPaid(p) {
    const ssId = p.ssId, id = p.id;
    const r1 = await updatePayment({ssId, id, action:'pay'});
    if (r1.__error) return r1;
    const rows = await _rows(ssId, SH_PAYMENTS);
    const pr = rows.find(r=>String(r[0]||'')===String(id));
    if (!pr) return r1;
    await saveQuickEntry({ssId, data:{
      uuid:'pay_'+id, date:_now(), type:'Расход', category:String(pr[PY_CAT-1]||'Выплата'),
      account:String(pr[PY_ACC-1]||''), amount:parseFloat(pr[PY_AMT-1])||0, comment:String(pr[PY_NAME-1]||'')
    }});
    return r1;
  }

  async function payEmployeeSalary(p) {
    return saveQuickEntry({ssId:p.ssId, data:{
      uuid:_uuid(), date:_now(), type:'Расход', category:'ЗП',
      account:_s(p.account), amount:Math.round(parseFloat(p.amount)||0), employee:_s(p.employee), comment:'Зарплата: '+_s(p.employee)
    }});
  }

  // ── Module: FILES ────────────────────────────────────────────────

  async function uploadReceipt(p) {
    try {
      const folderId = await DRIVE.getOrCreateFolder('Auron_Receipts');
      const file = await DRIVE.uploadFile(p.name || 'receipt.jpg', p.mimeType || 'image/jpeg', p.base64, folderId);
      const viewUrl = await DRIVE.makePublic(file.id);
      return { ok: true, viewUrl };
    } catch (e) { return { __error: e.message }; }
  }

  async function exportTransactions(p) {
    const ssId = p.ssId, period = p.period || 'month';
    try {
      const rows = await _rows(ssId, SH_BASE);
      const pd = _period(period);
      let csv = 'Дата;Тип;Категория;Сумма;Счёт;Сотрудник;Комментарий\n';
      rows.filter(r => _inPeriod(r[B_DATE - 1], pd)).forEach(r => {
        const d = _toDate(r[B_DATE - 1]);
        const dateStr = d ? d.toLocaleDateString('ru', {day:'2-digit',month:'2-digit',year:'numeric'}) : '';
        csv += [dateStr, r[B_TYPE-1]||'', r[B_CAT-1]||'', Math.round(parseFloat(r[B_AMT-1])||0), r[B_ACC-1]||'', r[B_EMP-1]||'', r[B_CMT-1]||'']
          .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';') + '\n';
      });
      return { csv };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Module: DEMO DATA ────────────────────────────────────────────

  async function seedDemoData(p) {
    const ssId = p.ssId;
    try {
      const accounts = await getAccounts({ssId});
      const accNames = accounts.map(a => a.name);
      const acc = accNames[0] || 'Наличные';
      const acc2 = accNames[1] || 'Карта';
      const entries = [
        {type:'Доход',  category:'Z-отчёт',     account:acc,  amount:62000, comment:'Выручка за день'},
        {type:'Расход', category:'Закупка',      account:acc,  amount:15000, comment:'Молочная продукция'},
        {type:'Доход',  category:'Z-отчёт',     account:acc2, amount:48000, comment:'Карта'},
        {type:'Расход', category:'Аренда',       account:acc,  amount:45000, comment:'Аренда июнь'},
        {type:'Расход', category:'ЗП',           account:acc,  amount:25000, comment:'Иванова А.'},
        {type:'Расход', category:'Коммуналка',   account:acc,  amount:8500,  comment:'Электроэнергия'},
        {type:'Доход',  category:'Продажи',      account:acc2, amount:31000, comment:'Розница'},
        {type:'Расход', category:'Хозрасходы',   account:acc,  amount:3200,  comment:'Упаковка'},
      ];
      let d = new Date(); d.setDate(d.getDate() - 7);
      for (const e of entries) {
        d.setDate(d.getDate() + 1);
        await saveQuickEntry({ssId, data:{...e, uuid:_uuid(), date:d.toISOString()}});
      }
      return { ok: true };
    } catch (e) { return { __error: e.message }; }
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    initUserApp, registerUser, createOrg, deleteOrg, logoutUser,
    getAccounts, getAccountsAll, saveAccount, deleteAccount, toggleAccountVisibility, adjustBalance,
    saveQuickEntry, saveTransfer, deleteTransaction, editTransaction,
    getAllTransactions, searchTransactions, getTrash, cleanTrash, restoreFromTrash,
    saveKassa, getShifts, cancelShift,
    getDebts, saveRep, saveDebtEntry, updateDebtEntry, deleteDebtEntry, getRepDebt, updateDebtStatus,
    getTimesheetMonth, saveTimesheetEntry,
    getSettings, saveSettings,
    getHomeSummary, getAnalytics, getGrowthData, getTrendData, getCashierAnalytics, getCashierShifts,
    getShiftAnalytics, getSupplierAnalytics, getAccountFlow, getDebtAnalytics,
    getBudget, saveBudget,
    getRecurring, saveRecurring, deleteRecurring, applyRecurring,
    getPayments, savePayment, updatePayment, markPaymentPaid, payEmployeeSalary,
    uploadReceipt, exportTransactions, seedDemoData,
    ensureSheets
  };
})();

window.API = API;
