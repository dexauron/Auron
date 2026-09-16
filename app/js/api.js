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
    // Отметка успешной связи с сервером — для индикатора «данные на HH:MM» в офлайне
    try { localStorage.setItem('auron_last_sync', String(Date.now())); } catch (_) {}
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
        // Путь A: без сети операция уходит в очередь и досылается при связи.
        // Клиентский id + client_uuid делают оптимистичный ответ и повтор идемпотентными.
        if (typeof navigator !== 'undefined' && navigator.onLine === false &&
            typeof window !== 'undefined' && window.OfflineQueue) {
          const r = Object.assign({}, row);
          if (!r.id) r.id = uuid();
          window.OfflineQueue.enqueue({
            table, method: 'POST', path: '/' + table, body: r,
            client_uuid: r.client_uuid || r.id
          });
          return [r]; // оптимистичный ответ — вызывающий код продолжает работать
        }
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
    // Офлайн: обновление баланса не пройдёт — баланс пересчитается при синхронизации
    // и следующей загрузке данных. Не роняем сохранение операции.
    try { await _updateAccountBalance(tx.account_id, tx.type, tx.amount_kopecks); }
    catch (e) { if (typeof navigator !== 'undefined' && navigator.onLine !== false) throw e; }
    return _fmtTx(tx);
  }

  async function saveTransfer(orgId, data) {
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
  // SHIFT WITHDRAWALS — выплаты с кассы
  // ══════════════════════════════════════════════════════════════════════════
  // Экран «Касса», блок «Выплаты с кассы». Каждая выплата — отдельная строка
  // со своей статьёй расходов, поэтому попадает в аналитику по категориям.
  // Расхождение по смене считается как (факт + выплаты) − Z-отчёт: выплаты
  // уже ушли из кассы, поэтому их прибавляют к остатку, а не вычитают.

  async function getShiftWithdrawals(orgId, shiftId) {
    return _q('shift_withdrawals')
      .select('*,categories(name,icon),accounts(name)')
      .eq('org_id', orgId)
      .eq('shift_id', shiftId)
      .eq('status', 'active')
      .order('created_at', false)
      .get();
  }

  async function saveShiftWithdrawal(orgId, shiftId, data) {
    const row = {
      org_id:         orgId,
      shift_id:       shiftId,
      name:           String(data.name || '').trim(),
      type:           data.type || 'other',
      category_id:    data.categoryId || null,
      account_id:     data.accountId || null,
      amount_kopecks: kopecks(data.amount)
    };
    if (!row.name)          throw new Error('Укажите, за что выплата');
    if (!row.amount_kopecks) throw new Error('Сумма выплаты не может быть нулевой');

    if (data.id) {
      const [r] = await _q('shift_withdrawals').eq('id', data.id).eq('org_id', orgId).update(row);
      return r;
    }
    const [r] = await _q('shift_withdrawals').insert(row);
    return r;
  }

  // Выплату не удаляем физически — помечаем отменённой, чтобы след остался в аудите
  async function cancelShiftWithdrawal(orgId, id) {
    const [r] = await _q('shift_withdrawals')
      .eq('id', id).eq('org_id', orgId)
      .update({ status: 'cancelled' });
    return r;
  }

  // Расхождение по смене: (факт + выплаты) − Z-отчёт.
  // Минус — недостача, плюс — излишек, ноль — сошлось.
  function shiftDiscrepancy(shift, withdrawals) {
    const z    = (shift.z_cash_kopecks || 0) + (shift.z_card_kopecks || 0) + (shift.z_sbp_kopecks || 0);
    const fact = (shift.fact_cash_kopecks || 0) + (shift.fact_card_kopecks || 0) + (shift.fact_sbp_kopecks || 0);
    const out  = (withdrawals || [])
      .filter(w => w.status !== 'cancelled')
      .reduce((s, w) => s + (w.amount_kopecks || 0), 0);
    return (fact + out) - z;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PURCHASE ORDERS — заказы поставщикам
  // ══════════════════════════════════════════════════════════════════════════

  async function getPurchaseOrders(orgId, opts) {
    opts = opts || {};
    const q = _q('purchase_orders')
      .select('*,counterparties(name,phone)')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .order('expected_date', false)
      .limit(opts.limit || 100);
    if (opts.status) q.eq('status', opts.status);
    return q.get();
  }

  async function savePurchaseOrder(orgId, data) {
    const row = {
      org_id:          orgId,
      counterparty_id: data.counterpartyId,
      department:      data.department || null,
      expected_date:   data.expectedDate || null,
      total_kopecks:   kopecks(data.total),
      notes:           data.notes || null
    };
    if (!row.counterparty_id) throw new Error('Выберите поставщика');

    if (data.id) {
      const [r] = await _q('purchase_orders').eq('id', data.id).eq('org_id', orgId).update(row);
      return r;
    }
    const [r] = await _q('purchase_orders').insert(row);
    return r;
  }

  // «Товар пришёл»: фиксируем фактическую сумму. Если брали в долг —
  // сразу создаём запись долга поставщику, чтобы не заводить её руками.
  async function receivePurchaseOrder(orgId, id, data) {
    const actual = kopecks(data.actual);
    const [order] = await _q('purchase_orders')
      .eq('id', id).eq('org_id', orgId)
      .update({
        status:         'received',
        actual_kopecks: actual,
        received_at:    new Date().toISOString()
      });

    if (data.onCredit && order) {
      await saveDebtEntry(orgId, {
        counterpartyId: order.counterparty_id,
        type:           'debt',
        amount:         data.actual,
        date:           (data.date || new Date().toISOString().slice(0, 10)),
        comment:        'Поставка' + (order.department ? ' · ' + order.department : '')
      });
    }
    return order;
  }

  async function cancelPurchaseOrder(orgId, id) {
    const [r] = await _q('purchase_orders')
      .eq('id', id).eq('org_id', orgId)
      .update({ status: 'cancelled' });
    return r;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GOALS — накопления и цели
  // ══════════════════════════════════════════════════════════════════════════
  // Одна таблица на две сущности: reserve_item — статья накоплений
  // (Аренда, ЗП, Налоги), goal — цель, которую ставит Владелец.

  async function getGoals(orgId, type) {
    const q = _q('goals')
      .select('*')
      .eq('org_id', orgId)
      .is('deleted_at', 'null')
      .order('sort_order', false);
    if (type) q.eq('type', type);
    const rows = await q.get();
    return rows.map(_withGoalProgress);
  }

  // Считает то, что видно на экране: сколько осталось, процент,
  // сколько нужно откладывать в день до дедлайна.
  function _withGoalProgress(g) {
    const target  = g.target_kopecks  || 0;
    const current = g.current_kopecks || 0;
    const left    = Math.max(0, target - current);
    const percent = target > 0 ? Math.min(100, Math.round(current / target * 100)) : 0;

    let daysLeft = null, perDay = 0;
    if (g.deadline) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const end   = new Date(g.deadline + 'T00:00:00');
      daysLeft = Math.max(0, Math.round((end - today) / 86400000));
      // в последний день делить на ноль нельзя — остаток нужен целиком сегодня
      perDay = daysLeft > 0 ? Math.ceil(left / daysLeft) : left;
    }

    // «Отстаём» — если к этому дню месяца должно быть отложено больше
    let behind = false;
    if (g.deadline && daysLeft !== null && target > 0) {
      const end     = new Date(g.deadline + 'T00:00:00');
      const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
      const totalDays  = Math.max(1, Math.round((end - monthStart) / 86400000));
      const passed     = Math.max(0, totalDays - daysLeft);
      behind = current < Math.round(target * passed / totalDays);
    }

    return { ...g, left_kopecks: left, percent, days_left: daysLeft, per_day_kopecks: perDay, behind };
  }

  async function saveGoal(orgId, data) {
    const row = {
      org_id:         orgId,
      name:           String(data.name || '').trim(),
      type:           data.type || 'reserve_item',
      target_kopecks: kopecks(data.target),
      deadline:       data.deadline || null,
      account_id:     data.accountId || null,
      sort_order:     data.sortOrder || 0
    };
    if (!row.name) throw new Error('Укажите название');

    if (data.id) {
      const [r] = await _q('goals').eq('id', data.id).eq('org_id', orgId).update(row);
      return _withGoalProgress(r);
    }
    const [r] = await _q('goals').insert(row);
    return _withGoalProgress(r);
  }

  // Пополнить накопление. Резервирует сумму из свободного остатка;
  // перевыполнение плана разрешено — предупреждает интерфейс, не API.
  async function contributeToGoal(orgId, id, amount) {
    const add = kopecks(amount);
    if (!add) throw new Error('Сумма пополнения не может быть нулевой');

    const goal = await _q('goals').select('*').eq('id', id).eq('org_id', orgId).one();
    if (!goal) throw new Error('Статья накоплений не найдена');

    const next   = (goal.current_kopecks || 0) + add;
    const patch  = { current_kopecks: next };
    // цель достигнута — закрываем сама, чтобы не висела в активных
    if (goal.type === 'goal' && goal.target_kopecks > 0 && next >= goal.target_kopecks) {
      patch.status = 'achieved';
    }
    const [r] = await _q('goals').eq('id', id).eq('org_id', orgId).update(patch);
    return _withGoalProgress(r);
  }

  async function deleteGoal(orgId, id) {
    await _q('goals').eq('id', id).eq('org_id', orgId)
      .update({ deleted_at: new Date().toISOString() });
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TIMESHEET — табель
  // ══════════════════════════════════════════════════════════════════════════

  async function getTimesheet(orgId, date) {
    return _q('timesheet_entries')
      .select('*,employees(name,position)')
      .eq('org_id', orgId)
      .eq('work_date', date)
      .get();
  }

  // Пара (сотрудник, дата) уникальна — повторное сохранение обновляет строку,
  // а не плодит дубли. Правка задним числом разрешена и видна в аудите.
  async function saveTimesheetEntry(orgId, data) {
    const row = {
      org_id:      orgId,
      employee_id: data.employeeId,
      work_date:   data.date,
      status:      data.status || 'worked',
      coefficient: data.coefficient != null ? Number(data.coefficient) : 1,
      note:        data.note || null
    };
    if (!row.employee_id) throw new Error('Не указан сотрудник');
    if (!row.work_date)   throw new Error('Не указана дата');

    const r = await _q('timesheet_entries').upsert(row, 'employee_id,work_date');
    return Array.isArray(r) ? r[0] : r;
  }

  // «Подтвердить день» — закрывает день целиком, дальше он учитывается в зарплате
  async function confirmTimesheetDay(orgId, date, userId) {
    return _q('timesheet_entries')
      .eq('org_id', orgId).eq('work_date', date)
      .update({ confirmed: true, confirmed_by: userId || null });
  }

  // Неподтверждённые дни за период — предупреждение при расчёте зарплаты
  async function getUnconfirmedDays(orgId, from, to) {
    const rows = await _q('timesheet_entries')
      .select('work_date')
      .eq('org_id', orgId)
      .gte('work_date', from)
      .lte('work_date', to)
      .eq('confirmed', false)
      .get();
    return [...new Set(rows.map(r => r.work_date))].sort();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SALARY — расчёт зарплаты
  // ══════════════════════════════════════════════════════════════════════════

  // Сколько оплачиваемых дней набралось по табелю.
  // Полный день = 1, полдня = 0.5, выходной и прогул = 0.
  // Больничный и отпуск не оплачиваются — решение фиксируется здесь.
  // Коэффициент домножается сверху: 0.75 при нестандартной частичной оплате.
  function salaryUnits(entries) {
    const WEIGHT = { worked: 1, half_day: 0.5, day_off: 0, sick: 0, absent: 0, vacation: 0 };
    return (entries || []).reduce((sum, e) => {
      const base = WEIGHT[e.status] != null ? WEIGHT[e.status] : 0;
      const k    = e.coefficient != null ? Number(e.coefficient) : 1;
      return sum + base * k;
    }, 0);
  }

  async function getSalaryCalculations(orgId, periodStart) {
    const q = _q('salary_calculations')
      .select('*,employees(name,position)')
      .eq('org_id', orgId)
      .order('created_at', true);
    if (periodStart) q.eq('period_start', periodStart);
    return q.get();
  }

  // Считает зарплату по табелю за период.
  // Авансы собираются автоматически из транзакций с этим сотрудником.
  // Если аванс превысил заработок — к выплате ноль, а не минус:
  // разница переносится на следующий месяц.
  async function calculateSalary(orgId, employeeId, from, to) {
    const [employee, entries, advances] = await Promise.all([
      _q('employees').select('*').eq('id', employeeId).eq('org_id', orgId).one(),
      _q('timesheet_entries').select('status,coefficient')
        .eq('org_id', orgId).eq('employee_id', employeeId)
        .gte('work_date', from).lte('work_date', to).get(),
      _q('transactions').select('amount_kopecks')
        .eq('org_id', orgId).eq('employee_id', employeeId)
        .eq('type', 'expense')
        .gte('date', from).lte('date', to)
        .is('deleted_at', 'null').get()
    ]);
    if (!employee) throw new Error('Сотрудник не найден');

    const units = salaryUnits(entries);
    const rate  = employee.rate_kopecks || employee.salary_kopecks || 0;
    const gross = Math.round(units * rate);
    const adv   = advances.reduce((s, t) => s + (t.amount_kopecks || 0), 0);
    const net   = Math.max(0, gross - adv);

    return {
      employee_id:      employeeId,
      employee_name:    employee.name,
      period_start:     from,
      period_end:       to,
      units,
      rate_kopecks:     rate,
      gross_kopecks:    gross,
      advances_kopecks: adv,
      net_kopecks:      net,
      // сколько аванса не покрылось заработком — переносится на следующий период
      carry_over_kopecks: Math.max(0, adv - gross)
    };
  }

  // Сохранить расчёт как черновик, чтобы вернуться к нему позже
  async function saveSalaryCalculation(orgId, calc) {
    const row = {
      org_id:             orgId,
      employee_id:        calc.employee_id,
      period_start:       calc.period_start,
      period_end:         calc.period_end,
      gross_kopecks:      calc.gross_kopecks,
      advances_kopecks:   calc.advances_kopecks,
      deductions_kopecks: calc.deductions_kopecks || 0,
      net_kopecks:        calc.net_kopecks,
      status:             'draft'
    };
    const r = await _q('salary_calculations').upsert(row, 'employee_id,period_start,period_end');
    return Array.isArray(r) ? r[0] : r;
  }

  // Выплатить: сумма редактируемая — бухгалтер может поправить руками.
  // Создаёт расход и связывает его с расчётом.
  async function paySalary(orgId, calcId, data) {
    const calc = await _q('salary_calculations').select('*').eq('id', calcId).eq('org_id', orgId).one();
    if (!calc) throw new Error('Расчёт не найден');
    if (calc.status === 'paid') throw new Error('Эта зарплата уже выплачена');

    const amount = data && data.amount != null ? kopecks(data.amount) : calc.net_kopecks;
    if (!amount) throw new Error('Сумма к выплате нулевая');

    const tx = await saveTransaction(orgId, {
      type:       'expense',
      amount:     rub(amount),
      accountId:  data && data.accountId,
      categoryId: data && data.categoryId,
      employeeId: calc.employee_id,
      date:       (data && data.date) || new Date().toISOString().slice(0, 10),
      comment:    'Зарплата за ' + calc.period_start + ' — ' + calc.period_end
    });

    const [r] = await _q('salary_calculations')
      .eq('id', calcId).eq('org_id', orgId)
      .update({
        status:         'paid',
        paid_at:        new Date().toISOString(),
        net_kopecks:    amount,
        transaction_id: tx && tx.id ? tx.id : null
      });
    return r;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC
  // ══════════════════════════════════════════════════════════════════════════

  // ── Офлайн-очередь: досылка накопленных операций при возврате связи ──────────
  function _queueSender(op) {
    return _req(op.method, op.path, op.body).catch(err => {
      // операция уже применена ранее (дубль по client_uuid) — считаем успехом
      if (/duplicate|already exists|23505|unique/i.test(String(err && err.message))) return null;
      throw err;
    });
  }
  function _flushQueue() {
    if (window.OfflineQueue) window.OfflineQueue.flush(_queueSender);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', _flushQueue);
    window.addEventListener('load',   _flushQueue);
  }

  window.API = {
    getOrgs, createOrg,
    flushQueue: _flushQueue,
    getAccounts, saveAccount, deleteAccount, adjustBalance,
    getCategories, saveCategory, deleteCategory,
    getEmployees, saveEmployee, deleteEmployee,
    saveTransaction, saveTransfer, deleteTransaction, getTransactions, searchTransactions,
    getHomeSummary,
    saveShift, getShifts, cancelShift,
    getShiftWithdrawals, saveShiftWithdrawal, cancelShiftWithdrawal, shiftDiscrepancy,
    getCounterparties, saveCounterparty,
    getDebts, getDebtEntries, saveDebtEntry, deleteDebtEntry,
    getPurchaseOrders, savePurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
    getGoals, saveGoal, contributeToGoal, deleteGoal, goalProgress: _withGoalProgress,
    getTimesheet, saveTimesheetEntry, confirmTimesheetDay, getUnconfirmedDays,
    getSalaryCalculations, calculateSalary, saveSalaryCalculation, paySalary, salaryUnits,
    getAnalytics, getCashierAnalytics, getHeatmap,
    uploadReceipt,
    getSetting, setSetting,
    kopecks, rub, rubInt, uuid, periodRange
  };
})();
