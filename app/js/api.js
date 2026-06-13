(() => {
  'use strict';

  // ── Core helpers ───────────────────────────────────────────────────────────
  function _base() { return window.SUPABASE_URL + '/rest/v1'; }
  function _key()  { return window.SUPABASE_ANON_KEY; }

  function _headers(extra) {
    const h = { apikey: _key(), 'Content-Type': 'application/json', Prefer: 'return=representation' };
    try { h['Authorization'] = 'Bearer ' + AUTH.getToken(); } catch (_) {}
    return Object.assign(h, extra || {});
  }

  async function _req(method, path, body, params) {
    let url = _base() + path;
    if (params) {
      const q = new URLSearchParams(params).toString();
      if (q) url += '?' + q;
    }
    const opts = { method, headers: _headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    let res, json;
    try {
      res  = await fetch(url, opts);
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error('Нет соединения с сервером');
    }
    if (!res.ok) {
      const msg = json?.message || json?.hint || json?.details || ('Ошибка ' + res.status);
      throw new Error(msg);
    }
    return json;
  }

  async function _rpc(fn, args) {
    return _req('POST', '/rpc/' + fn, args || {});
  }

  // PostgREST query builder (minimal subset)
  function _q(table) {
    const state = { _filters: [], _select: '*', _order: [], _limit: null, _offset: null };

    const q = {
      select(cols)        { state._select = cols; return q; },
      eq(col, val)        { state._filters.push(col + '=eq.' + encodeURIComponent(val)); return q; },
      neq(col, val)       { state._filters.push(col + '=neq.' + encodeURIComponent(val)); return q; },
      is(col, val)        { state._filters.push(col + '=is.' + val); return q; },
      gt(col, val)        { state._filters.push(col + '=gt.' + val); return q; },
      gte(col, val)       { state._filters.push(col + '=gte.' + encodeURIComponent(val)); return q; },
      lte(col, val)       { state._filters.push(col + '=lte.' + encodeURIComponent(val)); return q; },
      ilike(col, pat)     { state._filters.push(col + '=ilike.' + encodeURIComponent(pat)); return q; },
      order(col, desc)    { state._order.push(col + (desc ? '.desc' : '.asc')); return q; },
      limit(n)            { state._limit = n; return q; },
      offset(n)           { state._offset = n; return q; },
      isNull(col)         { state._filters.push(col + '=is.null'); return q; },
      notNull(col)        { state._filters.push(col + '=not.is.null'); return q; },

      _buildUrl() {
        let url = _base() + '/' + table + '?select=' + state._select;
        state._filters.forEach(f => url += '&' + f);
        if (state._order.length) url += '&order=' + state._order.join(',');
        if (state._limit)  url += '&limit=' + state._limit;
        if (state._offset) url += '&offset=' + state._offset;
        return url;
      },

      async get() {
        const url = this._buildUrl();
        const res = await fetch(url, { method: 'GET', headers: _headers({ Prefer: 'count=exact' }) });
        const text = await res.text();
        const data = text ? JSON.parse(text) : [];
        if (!res.ok) throw new Error(data?.message || ('Ошибка ' + res.status));
        return Array.isArray(data) ? data : [];
      },

      async one() {
        const rows = await this.limit(1).get();
        return rows[0] || null;
      },

      async insert(row) {
        return _req('POST', '/' + table, row);
      },

      async upsert(row, conflict) {
        const h = _headers({ Prefer: 'resolution=merge-duplicates,return=representation' });
        let url = _base() + '/' + table;
        if (conflict) url += '?on_conflict=' + conflict;
        const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(row) });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(data?.message || ('Ошибка ' + res.status));
        return data;
      },

      async update(patch) {
        let url = _base() + '/' + table + '?select=*';
        state._filters.forEach(f => url += '&' + f);
        const res = await fetch(url, { method: 'PATCH', headers: _headers(), body: JSON.stringify(patch) });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) throw new Error(data?.message || ('Ошибка ' + res.status));
        return data;
      },

      async delete() {
        let url = _base() + '/' + table;
        state._filters.forEach((f, i) => url += (i === 0 ? '?' : '&') + f);
        const res = await fetch(url, { method: 'DELETE', headers: _headers({ Prefer: 'return=minimal' }) });
        if (!res.ok) { const t = await res.text(); throw new Error(JSON.parse(t)?.message || ('Ошибка ' + res.status)); }
        return true;
      }
    };
    return q;
  }

  // ── Amount helpers ─────────────────────────────────────────────────────────
  function kopecks(v)  { return Math.round(Number(v) || 0); }
  function rub(kopek)  { return (kopek / 100).toFixed(2); }
  function rubInt(k)   { return Math.round(k / 100); }

  // ── UUID ───────────────────────────────────────────────────────────────────
  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // ── Period helpers ─────────────────────────────────────────────────────────
  function periodRange(period) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const today = ymd(now);
    if (period === 'today') return { from: today, to: today };
    if (period === 'week') {
      const d = new Date(now); d.setDate(now.getDate() - now.getDay() + 1);
      return { from: ymd(d), to: today };
    }
    if (period === 'month') return { from: `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`, to: today };
    if (period === 'year')  return { from: `${now.getFullYear()}-01-01`, to: today };
    return { from: today, to: today };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ORGANIZATIONS
  // ══════════════════════════════════════════════════════════════════════════

  async function getOrgs() {
    const uid = AUTH.getUser()?.id;
    if (!uid) return [];
    const rows = await _q('org_members')
      .select('org_id,role,organizations(id,name,type,logo_url,settings,created_at)')
      .eq('user_id', uid)
      .is('deleted_at', 'null')
      .get();
    return rows.map(r => ({
      id:        r.org_id,
      name:      r.organizations?.name || '',
      type:      r.organizations?.type || 'retail',
      logoUrl:   r.organizations?.logo_url || '',
      settings:  r.organizations?.settings || {},
      role:      r.role,
      createdAt: r.organizations?.created_at
    }));
  }

  async function createOrg(name, type) {
    const uid = AUTH.getUser()?.id;
    if (!uid) throw new Error('Не авторизован');
    const [org] = await _q('organizations').insert({ name: name.trim(), type: type || 'retail' });
    await _q('org_members').insert({ org_id: org.id, user_id: uid, role: 'owner' });
    await _ensureDefaultAccounts(org.id);
    await _ensureDefaultCategories(org.id);
    return org;
  }

  async function _ensureDefaultAccounts(orgId) {
    const defaults = [
      { name: 'Наличные',   icon: '💵', color: '#30D158', sort_order: 1 },
      { name: 'Карта/Банк', icon: '💳', color: '#0A84FF', sort_order: 2 },
      { name: 'СБП',        icon: '📱', color: '#5E5CE6', sort_order: 3 },
    ];
    for (const a of defaults) {
      await _q('accounts').insert({ org_id: orgId, ...a, balance_kopecks: 0 });
    }
  }

  async function _ensureDefaultCategories(orgId) {
    const defaults = [
      { name: 'Продажи',       type: 'income',  icon: '💰', color: '#30D158' },
      { name: 'Z-отчёт',       type: 'income',  icon: '🧾', color: '#5E5CE6' },
      { name: 'ЗП',            type: 'expense', icon: '👥', color: '#8B5CF6' },
      { name: 'Аренда',        type: 'expense', icon: '🏠', color: '#F59E0B' },
      { name: 'Закупка',       type: 'expense', icon: '🛒', color: '#0EA5E9' },
      { name: 'Хозрасходы',    type: 'expense', icon: '🔧', color: '#6B7280' },
      { name: 'Коммуналка',    type: 'expense', icon: '💡', color: '#EAB308' },
      { name: 'Реклама',       type: 'expense', icon: '📢', color: '#EC4899' },
      { name: 'Налоги',        type: 'expense', icon: '🏛',  color: '#DC2626' },
      { name: 'Прочий расход', type: 'expense', icon: '📋', color: '#64748B' },
      { name: 'Перевод',       type: 'income',  icon: '↔',   color: '#FF9F0A' },
      { name: 'Корректировка', type: 'income',  icon: '✏️',  color: '#94A3B8' },
      { name: 'Долг ТП',       type: 'expense', icon: '📝',  color: '#0EA5E9' },
    ];
    for (const c of defaults) {
      await _q('categories').insert({ org_id: orgId, ...c });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS
  // ══════════════════════════════════════════════════════════════════════════

  async function getAccounts(orgId) {
    const rows = await _q('accounts')
      .select('*')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .order('sort_order', false)
      .get();
    return rows.map(a => ({
      id:         a.id,
      name:       a.name,
      icon:       a.icon || '💰',
      color:      a.color || '#5E5CE6',
      balance:    a.balance_kopecks,
      balanceRub: rubInt(a.balance_kopecks),
      status:     a.status || 'active',
      sortOrder:  a.sort_order || 0
    }));
  }

  async function saveAccount(orgId, data) {
    const row = {
      org_id:    orgId,
      name:      data.name.trim(),
      icon:      data.icon || '💰',
      color:     data.color || '#5E5CE6',
      sort_order: data.sortOrder || 0
    };
    if (data.id) {
      const [r] = await _q('accounts').eq('id', data.id).eq('org_id', orgId).update(row);
      return r;
    }
    row.balance_kopecks = kopecks(data.initialBalance) || 0;
    const [r] = await _q('accounts').insert(row);
    return r;
  }

  async function deleteAccount(orgId, accountId) {
    await _q('accounts').eq('id', accountId).eq('org_id', orgId).update({
      deleted_at: new Date().toISOString(),
      status: 'archived'
    });
  }

  async function adjustBalance(orgId, accountId, newBalanceKopecks, comment) {
    const acc = await _q('accounts').select('balance_kopecks').eq('id', accountId).one();
    if (!acc) throw new Error('Счёт не найден');
    const delta = kopecks(newBalanceKopecks) - acc.balance_kopecks;
    if (delta === 0) return;
    const type = delta >= 0 ? 'income' : 'expense';
    await saveTransaction(orgId, {
      clientUuid:    uuid(),
      date:          new Date().toISOString().slice(0, 10),
      type,
      categoryName:  'Корректировка',
      accountId,
      amountKopecks: Math.abs(delta),
      comment:       comment || 'Корректировка остатка'
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORIES
  // ══════════════════════════════════════════════════════════════════════════

  async function getCategories(orgId, type) {
    const q = _q('categories').select('*').eq('org_id', orgId).is('deleted_at', 'null').order('name', false);
    if (type && type !== 'both') q.eq('type', type);
    return q.get();
  }

  async function saveCategory(orgId, data) {
    const row = { org_id: orgId, name: data.name.trim(), type: data.type, icon: data.icon || '📋', color: data.color || '#64748B' };
    if (data.id) {
      const [r] = await _q('categories').eq('id', data.id).eq('org_id', orgId).update(row);
      return r;
    }
    const [r] = await _q('categories').insert(row);
    return r;
  }

  async function deleteCategory(orgId, categoryId) {
    await _q('categories').eq('id', categoryId).eq('org_id', orgId).update({ deleted_at: new Date().toISOString() });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMPLOYEES
  // ══════════════════════════════════════════════════════════════════════════

  async function getEmployees(orgId) {
    return _q('employees')
      .select('*')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .order('full_name', false)
      .get();
  }

  async function saveEmployee(orgId, data) {
    const row = {
      org_id:     orgId,
      full_name:  data.fullName.trim(),
      short_name: data.shortName?.trim() || data.fullName.split(' ')[0],
      role:       data.role || 'cashier',
      phone:      data.phone || null,
      salary:     data.salary ? kopecks(data.salary * 100) : null
    };
    if (data.id) {
      const [r] = await _q('employees').eq('id', data.id).eq('org_id', orgId).update(row);
      return r;
    }
    const [r] = await _q('employees').insert(row);
    return r;
  }

  async function deleteEmployee(orgId, employeeId) {
    await _q('employees').eq('id', employeeId).eq('org_id', orgId).update({
      deleted_at: new Date().toISOString(),
      status: 'fired'
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  const TX_SELECT = [
    'id,client_uuid,date,type,amount_kopecks,comment,receipt_url,shift_id,locked,deleted_at,created_at',
    'category_id,account_id,employee_id',
    'categories(name,icon,color),accounts(name,icon),employees(short_name,full_name)'
  ].join(',');

  function _fmtTx(r) {
    return {
      id:            r.id,
      clientUuid:    r.client_uuid,
      date:          r.date,
      type:          r.type,
      categoryId:    r.category_id,
      categoryName:  r.categories?.name  || '',
      categoryIcon:  r.categories?.icon  || '💸',
      categoryColor: r.categories?.color || '#5E5CE6',
      accountId:     r.account_id,
      accountName:   r.accounts?.name    || '',
      accountIcon:   r.accounts?.icon    || '💰',
      amountKopecks: r.amount_kopecks,
      employeeId:    r.employee_id,
      employeeName:  r.employees?.short_name || r.employees?.full_name || '',
      comment:       r.comment     || '',
      receiptUrl:    r.receipt_url || '',
      shiftId:       r.shift_id,
      locked:        !!r.locked,
      deletedAt:     r.deleted_at,
      createdAt:     r.created_at
    };
  }

  async function saveTransaction(orgId, data) {
    const row = {
      org_id:         orgId,
      client_uuid:    data.clientUuid || uuid(),
      date:           data.date,
      type:           data.type,
      amount_kopecks: kopecks(data.amountKopecks),
      comment:        data.comment    || null,
      receipt_url:    data.receiptUrl || null,
      shift_id:       data.shiftId    || null,
      locked:         data.locked     || false
    };

    if (data.categoryId) {
      row.category_id = data.categoryId;
    } else if (data.categoryName) {
      const cat = await _q('categories').select('id').eq('org_id', orgId).eq('name', data.categoryName).one();
      row.category_id = cat?.id || null;
    }

    if (data.accountId)  row.account_id  = data.accountId;
    if (data.employeeId) row.employee_id = data.employeeId;

    const [tx] = await _q('transactions').insert(row);
    await _updateAccountBalance(tx.account_id, tx.type, tx.amount_kopecks);
    return _fmtTx(tx);
  }

  async function saveTransfer(orgId, data) {
    const pairId = uuid();
    const out = await saveTransaction(orgId, {
      clientUuid:    data.clientUuidOut || uuid(),
      date:          data.date,
      type:          'expense',
      categoryName:  'Перевод',
      accountId:     data.fromAccountId,
      amountKopecks: data.amountKopecks,
      comment:       data.comment || 'Перевод',
      shiftId:       data.shiftId || null
    });
    const inn = await saveTransaction(orgId, {
      clientUuid:    data.clientUuidIn || uuid(),
      date:          data.date,
      type:          'income',
      categoryName:  'Перевод',
      accountId:     data.toAccountId,
      amountKopecks: data.amountKopecks,
      comment:       data.comment || 'Перевод',
      shiftId:       data.shiftId || null
    });
    return { out, in: inn };
  }

  async function deleteTransaction(orgId, txId) {
    const tx = await _q('transactions')
      .select('type,amount_kopecks,account_id,locked')
      .eq('id', txId)
      .eq('org_id', orgId)
      .one();
    if (!tx) throw new Error('Операция не найдена');
    if (tx.locked) throw new Error('Операция заблокирована сменой — сначала отмените смену');

    await _q('transactions').eq('id', txId).eq('org_id', orgId).update({ deleted_at: new Date().toISOString() });
    const reverseType = tx.type === 'income' ? 'expense' : 'income';
    await _updateAccountBalance(tx.account_id, reverseType, tx.amount_kopecks);
  }

  async function _updateAccountBalance(accountId, type, amountKopecks) {
    if (!accountId) return;
    const delta = type === 'income' ? amountKopecks : -amountKopecks;
    await _rpc('increment_account_balance', { p_account_id: accountId, p_delta: delta });
  }

  async function getTransactions(orgId, opts) {
    opts = opts || {};
    const q = _q('transactions')
      .select(TX_SELECT)
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .order('date', true)
      .order('created_at', true)
      .limit(opts.limit || 50);

    if (opts.from)       q.gte('date', opts.from);
    if (opts.to)         q.lte('date', opts.to);
    if (opts.accountId)  q.eq('account_id', opts.accountId);
    if (opts.employeeId) q.eq('employee_id', opts.employeeId);
    if (opts.shiftId)    q.eq('shift_id', opts.shiftId);
    if (opts.type)       q.eq('type', opts.type);
    if (opts.offset)     q.offset(opts.offset);

    const rows = await q.get();
    return rows.map(_fmtTx);
  }

  async function searchTransactions(orgId, query) {
    if (!query || query.length < 2) return [];
    const rows = await _q('transactions')
      .select(TX_SELECT)
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .ilike('comment', '%' + query + '%')
      .order('date', true)
      .limit(30)
      .get();
    return rows.map(_fmtTx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HOME SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  async function getHomeSummary(orgId, period) {
    period = period || 'today';
    const { from, to } = periodRange(period);

    const [accounts, recentRows, periodRows] = await Promise.all([
      getAccounts(orgId),
      _q('transactions').select(TX_SELECT).eq('org_id', orgId).is('deleted_at', 'null').order('date', true).order('created_at', true).limit(30).get(),
      _q('transactions').select('type,amount_kopecks').eq('org_id', orgId).is('deleted_at', 'null').gte('date', from).lte('date', to).get()
    ]);

    let periodIncome = 0, periodExpense = 0;
    periodRows.forEach(r => {
      if (r.type === 'income')  periodIncome  += r.amount_kopecks;
      if (r.type === 'expense') periodExpense += r.amount_kopecks;
    });

    const groups = [];
    const seen   = {};
    recentRows.map(_fmtTx).forEach(tx => {
      if (!seen[tx.date]) {
        seen[tx.date] = { date: tx.date, items: [], income: 0, expense: 0 };
        groups.push(seen[tx.date]);
      }
      seen[tx.date].items.push(tx);
      if (tx.type === 'income')  seen[tx.date].income  += tx.amountKopecks;
      if (tx.type === 'expense') seen[tx.date].expense += tx.amountKopecks;
    });

    return { accounts, periodIncome, periodExpense, groups, period, from, to };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHIFTS (Z-REPORT)
  // ══════════════════════════════════════════════════════════════════════════

  function _fmtShift(r) {
    return {
      id:              r.id,
      date:            r.date,
      shiftNum:        r.shift_num,
      employeeId:      r.employee_id,
      employeeName:    r.employees?.short_name || r.employees?.full_name || '',
      zCashKopecks:    r.z_cash_kopecks   || 0,
      zCardKopecks:    r.z_card_kopecks   || 0,
      zSbpKopecks:     r.z_sbp_kopecks    || 0,
      zTotalKopecks:   r.z_total_kopecks  || 0,
      factCashKopecks: r.fact_cash_kopecks || 0,
      factCardKopecks: r.fact_card_kopecks || 0,
      factSbpKopecks:  r.fact_sbp_kopecks  || 0,
      diffKopecks:     r.diff_kopecks || 0,
      withdrawals:     r.withdrawals_json || [],
      status:          r.status || 'closed',
      createdAt:       r.created_at
    };
  }

  async function saveShift(orgId, data) {
    const zTotal    = kopecks(data.zCash)   + kopecks(data.zCard)   + kopecks(data.zSbp);
    const factTotal = kopecks(data.factCash) + kopecks(data.factCard) + kopecks(data.factSbp);
    const diff      = factTotal - zTotal;

    const [shift] = await _q('shifts').insert({
      org_id:            orgId,
      date:              data.date,
      shift_num:         data.shiftNum || 1,
      employee_id:       data.employeeId,
      z_cash_kopecks:    kopecks(data.zCash),
      z_card_kopecks:    kopecks(data.zCard),
      z_sbp_kopecks:     kopecks(data.zSbp),
      z_total_kopecks:   zTotal,
      fact_cash_kopecks: kopecks(data.factCash),
      fact_card_kopecks: kopecks(data.factCard),
      fact_sbp_kopecks:  kopecks(data.factSbp),
      diff_kopecks:      diff,
      withdrawals_json:  data.withdrawals || [],
      status:            'closed'
    });

    // Z-income transactions (locked)
    const incomeRows = [
      { accName: 'Наличные',   amount: kopecks(data.zCash) },
      { accName: 'Карта/Банк', amount: kopecks(data.zCard) },
      { accName: 'СБП',        amount: kopecks(data.zSbp)  }
    ].filter(r => r.amount > 0);

    for (const row of incomeRows) {
      const acc = await _q('accounts').select('id').eq('org_id', orgId).eq('name', row.accName).one();
      if (!acc) continue;
      await saveTransaction(orgId, {
        clientUuid: uuid(), date: data.date, type: 'income',
        categoryName: 'Z-отчёт', accountId: acc.id,
        amountKopecks: row.amount,
        comment: `Смена ${data.shiftNum || 1}`,
        shiftId: shift.id, locked: true, employeeId: data.employeeId
      });
    }

    // Withdrawals as locked expense transactions
    for (const w of (data.withdrawals || [])) {
      if (!w.amount || w.amount <= 0) continue;
      const acc = await _q('accounts').select('id').eq('org_id', orgId).eq('name', w.account || 'Наличные').one();
      if (!acc) continue;
      await saveTransaction(orgId, {
        clientUuid: uuid(), date: data.date, type: 'expense',
        categoryName: w.category || 'Прочий расход', accountId: acc.id,
        amountKopecks: kopecks(w.amount),
        comment: w.comment || 'Выплата из кассы',
        shiftId: shift.id, locked: true, employeeId: data.employeeId
      });
    }

    return _fmtShift(shift);
  }

  async function getShifts(orgId, opts) {
    opts = opts || {};
    const q = _q('shifts')
      .select('*,employees(short_name,full_name)')
      .eq('org_id', orgId)
      .order('date', true)
      .order('shift_num', true)
      .limit(opts.limit || 30);

    if (opts.from)       q.gte('date', opts.from);
    if (opts.to)         q.lte('date', opts.to);
    if (opts.employeeId) q.eq('employee_id', opts.employeeId);

    const rows = await q.get();
    return rows.map(_fmtShift);
  }

  async function cancelShift(orgId, shiftId) {
    await _q('transactions').eq('org_id', orgId).eq('shift_id', shiftId).update({
      deleted_at: new Date().toISOString(),
      locked: false
    });
    await _q('shifts').eq('id', shiftId).eq('org_id', orgId).update({ status: 'cancelled' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COUNTERPARTIES & DEBTS
  // ══════════════════════════════════════════════════════════════════════════

  async function getCounterparties(orgId) {
    return _q('counterparties').select('*').eq('org_id', orgId).is('deleted_at', 'null').order('name', false).get();
  }

  async function saveCounterparty(orgId, data) {
    const row = { org_id: orgId, name: data.name.trim(), type: data.type || 'supplier', phone: data.phone || null, note: data.note || null };
    if (data.id) { const [r] = await _q('counterparties').eq('id', data.id).eq('org_id', orgId).update(row); return r; }
    const [r] = await _q('counterparties').insert(row);
    return r;
  }

  async function getDebts(orgId) {
    const rows = await _q('debt_entries')
      .select('counterparty_id,type,amount_kopecks,counterparties(name,type)')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .get();

    const totals = {};
    rows.forEach(r => {
      const id = r.counterparty_id;
      if (!totals[id]) totals[id] = { id, name: r.counterparties?.name || '', type: r.counterparties?.type || 'supplier', debt: 0, paid: 0 };
      if (r.type === 'debt')    totals[id].debt += r.amount_kopecks;
      if (r.type === 'payment') totals[id].paid += r.amount_kopecks;
    });

    return Object.values(totals).map(t => ({ ...t, balance: t.debt - t.paid }));
  }

  async function getDebtEntries(orgId, counterpartyId, opts) {
    opts = opts || {};
    const q = _q('debt_entries')
      .select('*,accounts(name)')
      .eq('org_id', orgId)
      .eq('counterparty_id', counterpartyId)
      .is('deleted_at', 'null')
      .order('date', true)
      .limit(opts.limit || 50);
    if (opts.type) q.eq('type', opts.type);
    return q.get();
  }

  async function saveDebtEntry(orgId, data) {
    const [entry] = await _q('debt_entries').insert({
      org_id:          orgId,
      counterparty_id: data.counterpartyId,
      type:            data.type,
      amount_kopecks:  kopecks(data.amountKopecks),
      date:            data.date || new Date().toISOString().slice(0, 10),
      account_id:      data.accountId || null,
      comment:         data.comment   || null
    });

    if (data.type === 'payment' && data.accountId) {
      await saveTransaction(orgId, {
        clientUuid: uuid(), date: data.date || new Date().toISOString().slice(0, 10),
        type: 'expense', categoryName: 'Долг ТП', accountId: data.accountId,
        amountKopecks: kopecks(data.amountKopecks), comment: data.comment || 'Оплата ТП'
      });
    }

    return entry;
  }

  async function deleteDebtEntry(orgId, entryId) {
    await _q('debt_entries').eq('id', entryId).eq('org_id', orgId).update({ deleted_at: new Date().toISOString() });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYTICS
  // ══════════════════════════════════════════════════════════════════════════

  async function getAnalytics(orgId, period) {
    const { from, to } = periodRange(period || 'month');

    const rows = await _q('transactions')
      .select('type,amount_kopecks,date,category_id,account_id,employee_id,categories(name,icon,color),accounts(name),employees(short_name,full_name)')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .gte('date', from)
      .lte('date', to)
      .get();

    let totalIncome = 0, totalExpense = 0;
    const byCategory = {}, byAccount = {}, byEmployee = {}, daily = {};

    rows.forEach(r => {
      const amt = r.amount_kopecks;
      if (r.type === 'income')  totalIncome  += amt;
      if (r.type === 'expense') totalExpense += amt;

      const catKey = r.category_id || '_none';
      if (!byCategory[catKey]) byCategory[catKey] = { id: catKey, name: r.categories?.name || 'Без категории', icon: r.categories?.icon || '💸', color: r.categories?.color || '#94A3B8', income: 0, expense: 0 };
      byCategory[catKey][r.type] += amt;

      if (r.account_id) {
        if (!byAccount[r.account_id]) byAccount[r.account_id] = { id: r.account_id, name: r.accounts?.name || '', income: 0, expense: 0 };
        byAccount[r.account_id][r.type] += amt;
      }

      if (r.employee_id) {
        const name = r.employees?.short_name || r.employees?.full_name || '';
        if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { id: r.employee_id, name, income: 0, expense: 0, count: 0 };
        byEmployee[r.employee_id][r.type] += amt;
        byEmployee[r.employee_id].count++;
      }

      if (!daily[r.date]) daily[r.date] = { date: r.date, income: 0, expense: 0 };
      daily[r.date][r.type] += amt;
    });

    return {
      period, from, to,
      totalIncome, totalExpense,
      profit:     totalIncome - totalExpense,
      byCategory: Object.values(byCategory).sort((a, b) => b.expense - a.expense),
      byAccount:  Object.values(byAccount),
      byEmployee: Object.values(byEmployee).sort((a, b) => b.income - a.income),
      daily:      Object.values(daily).sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  async function getCashierAnalytics(orgId, period) {
    const { from, to } = periodRange(period || 'month');
    const shifts = await _q('shifts')
      .select('employee_id,z_total_kopecks,diff_kopecks,employees(short_name,full_name)')
      .eq('org_id', orgId)
      .gte('date', from)
      .lte('date', to)
      .get();

    const byEmp = {};
    shifts.forEach(s => {
      const eid  = s.employee_id;
      const name = s.employees?.short_name || s.employees?.full_name || '—';
      if (!byEmp[eid]) byEmp[eid] = { id: eid, name, income: 0, shifts: 0, diffTotal: 0, diffCount: 0 };
      byEmp[eid].income  += s.z_total_kopecks || 0;
      byEmp[eid].shifts++;
      if (s.diff_kopecks !== 0) { byEmp[eid].diffTotal += s.diff_kopecks; byEmp[eid].diffCount++; }
    });

    return Object.values(byEmp).sort((a, b) => b.income - a.income);
  }

  async function getHeatmap(orgId) {
    const now  = new Date();
    const from = new Date(now); from.setDate(now.getDate() - 90);
    const ymd  = d => d.toISOString().slice(0, 10);

    const rows = await _q('transactions')
      .select('date,amount_kopecks')
      .eq('org_id', orgId)
      .eq('type', 'income')
      .is('deleted_at', 'null')
      .gte('date', ymd(from))
      .lte('date', ymd(now))
      .get();

    const byDow = [0, 0, 0, 0, 0, 0, 0];
    rows.forEach(r => {
      const dow = (new Date(r.date + 'T12:00:00').getDay() + 6) % 7;
      byDow[dow] += r.amount_kopecks;
    });

    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return byDow.map((v, i) => ({ day: days[i], kopecks: v }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RECEIPTS
  // ══════════════════════════════════════════════════════════════════════════

  async function uploadReceipt(orgId, file) {
    const ext  = (file.name || 'photo').split('.').pop() || 'jpg';
    const path = `${orgId}/${Date.now()}-${uuid().slice(0, 8)}.${ext}`;
    const url  = `${window.SUPABASE_URL}/storage/v1/object/receipts/${path}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: _key(), Authorization: 'Bearer ' + AUTH.getToken(), 'Content-Type': file.type || 'image/jpeg' },
      body: file
    });
    if (!res.ok) throw new Error('Не удалось загрузить фото чека');
    return `${window.SUPABASE_URL}/storage/v1/object/public/receipts/${path}`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════

  async function getSetting(orgId, key, def) {
    const row = await _q('org_settings').select('value').eq('org_id', orgId).eq('key', key).one();
    return row ? row.value : def;
  }

  async function setSetting(orgId, key, value) {
    await _q('org_settings').upsert({ org_id: orgId, key, value, updated_at: new Date().toISOString() }, 'org_id,key');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC
  // ══════════════════════════════════════════════════════════════════════════

  window.API = {
    getOrgs, createOrg,
    getAccounts, saveAccount, deleteAccount, adjustBalance,
    getCategories, saveCategory, deleteCategory,
    getEmployees, saveEmployee, deleteEmployee,
    saveTransaction, saveTransfer, deleteTransaction, getTransactions, searchTransactions,
    getHomeSummary,
    saveShift, getShifts, cancelShift,
    getCounterparties, saveCounterparty,
    getDebts, getDebtEntries, saveDebtEntry, deleteDebtEntry,
    getAnalytics, getCashierAnalytics, getHeatmap,
    uploadReceipt,
    getSetting, setSetting,
    kopecks, rub, rubInt, uuid, periodRange
  };
})();
