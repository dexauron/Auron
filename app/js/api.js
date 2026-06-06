'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AURON FINANCE — Supabase API Client  v2
   ═══════════════════════════════════════════════════════════════════ */

const API = (() => {

  function sb()  { return AUTH.client(); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }
  function s(v)  { return String(v || '').trim().slice(0, 500); }
  function n(v)  { return Math.round(Number(v) || 0); }

  // ── localStorage helpers ──────────────────────────────────────
  function lsGet(key, def) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : def; } catch(_) { return def; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(_) {}
  }

  // ── Облачное хранилище ключ-значение (app_kv) с кэшем в localStorage ──
  // Читает из Supabase (синхронизация между устройствами); при недоступности
  // сети возвращает локальный кэш. legacyKey — старый localStorage-ключ для
  // одноразовой миграции существующих данных в облако.
  async function _kvGet(orgId, key, def, legacyKey) {
    const cacheKey = 'auron_kv_' + orgId + '_' + key;
    try {
      const { data } = await sb().from('app_kv').select('value').eq('org_id', orgId).eq('key', key).maybeSingle();
      if (data && data.value !== null && data.value !== undefined) {
        lsSet(cacheKey, data.value);
        return data.value;
      }
      // Нет записи в облаке — мигрируем из старого localStorage-ключа, если есть
      if (legacyKey) {
        const legacy = lsGet(legacyKey, undefined);
        if (legacy !== undefined) { await _kvSet(orgId, key, legacy); return legacy; }
      }
    } catch(_) {
      // офлайн — отдаём кэш
      const cached = lsGet(cacheKey, undefined);
      if (cached !== undefined) return cached;
      if (legacyKey) { const legacy = lsGet(legacyKey, undefined); if (legacy !== undefined) return legacy; }
    }
    return def;
  }
  async function _kvSet(orgId, key, val) {
    lsSet('auron_kv_' + orgId + '_' + key, val); // оптимистичный кэш
    try { await sb().from('app_kv').upsert({ org_id: orgId, key, value: val, updated_at: new Date().toISOString() }); } catch(_) {}
  }

  // ── TX formatter ──────────────────────────────────────────────
  function fmtTx(r) {
    if (!r) return null;
    return {
      id: r.id, uuid: r.uuid, date: r.date, type: r.type,
      category: r.category || '', amount: r.amount,
      accountId: r.account_id, employee: r.employee || '',
      comment: r.comment || '', receiptUrl: r.receipt_url || '',
      shiftId: r.shift_id || '', locked: !!r.locked, shiftNum: r.shift_num || 0,
      createdAt: r.created_at
    };
  }

  async function _balanceDelta(accountId, type, amount) {
    if (!accountId) return;
    const delta = type === 'Доход' ? n(amount) : type === 'Расход' ? -n(amount) : n(amount);
    if (delta === 0) return;
    await sb().rpc('update_account_balance', { p_account_id: accountId, p_delta: delta });
  }

  async function _err(fn) {
    try { return await fn(); }
    catch (e) { return { __error: e.message }; }
  }

  // Get account ID by name
  async function _accId(orgId, name) {
    if (!name) return null;
    const { data } = await sb().from('accounts').select('id').eq('org_id', orgId).eq('name', name).maybeSingle();
    return data ? data.id : null;
  }

  // ── Auth / Init ────────────────────────────────────────────────

  async function initUserApp(p) {
    const user = AUTH.getUser();
    if (!user) return { isNew: true, noSession: true };
    try {
      const { data: orgs } = await sb().from('orgs').select('*').eq('user_id', user.id).order('created_at');
      if (!orgs || !orgs.length) return { isNew: true, profile: _profile(user) };
      return { isNew: false, profile: _profile(user), orgs: orgs.map(o => ({ id: o.id, name: o.name, ssId: o.id })) };
    } catch (e) {
      throw new Error('Нет соединения с сервером. Проверьте интернет.');
    }
  }

  function _profile(user) {
    return { name: (user.user_metadata && user.user_metadata.full_name) || user.email || '', email: user.email || '', phone: '' };
  }

  async function registerUser(p) { return _err(async () => {
    const user = AUTH.getUser();
    if (!user) return { __error: 'Not signed in' };
    const orgName = s(p.orgName) || s(p.company && p.company.name) || 'Мой магазин';
    const { data: existing } = await sb().from('orgs').select('*').eq('user_id', user.id).order('created_at').limit(1);
    if (existing && existing.length) return { ssId: existing[0].id, orgName: existing[0].name };
    const { data: org, error } = await sb().from('orgs').insert({ name: orgName, user_id: user.id }).select().single();
    if (error) return { __error: error.message };
    await _createDefaultAccounts(org.id);
    return { ssId: org.id, orgName: org.name };
  }); }

  async function _createDefaultAccounts(orgId) {
    await sb().from('accounts').insert([
      { org_id: orgId, name: 'Наличные', icon: '💵', color: '#10B981', sort_order: 0 },
      { org_id: orgId, name: 'Карта',    icon: '💳', color: '#6366F1', sort_order: 1 },
      { org_id: orgId, name: 'СБП',      icon: '📱', color: '#8B5CF6', sort_order: 2 },
    ]);
  }

  async function createOrg(p) { return _err(async () => {
    const user = AUTH.getUser();
    if (!user) return { __error: 'Not signed in' };
    const { data: org, error } = await sb().from('orgs').insert({ name: s(p.name), user_id: user.id }).select().single();
    if (error) return { __error: error.message };
    await _createDefaultAccounts(org.id);
    return { id: org.id, name: org.name, ssId: org.id };
  }); }

  async function deleteOrg(p) { return _err(async () => {
    const { error } = await sb().from('orgs').delete().eq('id', p.orgId);
    if (error) return { __error: error.message };
    return { ok: true };
  }); }

  async function logoutUser() { AUTH.signOut(); return { ok: true }; }

  // ── Settings ──────────────────────────────────────────────────

  async function getSettings(p) { return _err(async () => {
    const [catsR, empsR, recR] = await Promise.all([
      sb().from('categories').select('*').eq('org_id', p.orgId).order('name'),
      sb().from('employees').select('*').eq('org_id', p.orgId).order('name'),
      sb().from('recurring').select('*').eq('org_id', p.orgId).order('name')
    ]);

    const extra = await _kvGet(p.orgId, 'ui', {}, 'auron_ui_' + p.orgId);

    return {
      cats:         (catsR.data||[]).map(c => c.name),
      categories:   (catsR.data||[]).map(c => ({ id: c.id, name: c.name, type: c.type })),
      employees:    (empsR.data||[]).map(e => ({ id: e.id, name: e.name, rate: e.rate, status: e.status, dailySalary: e.rate })),
      recurring:    (recR.data||[]).map(r => ({ id: r.id, name: r.name, category: r.category, amount: r.amount, account: '', accountId: r.account_id, day: r.day_of_month, active: r.active })),
      cashiers:     extra.cashiers    || [],
      payTypes:     extra.payTypes    || ['Наличные','Карта','СБП','Безналичный'],
      repStatuses:  extra.repStatuses || ['✅ Оплачено','❌ Не оплачено','⛔ Отменён','🔄 Перенесён','❓ Не пришёл'],
      shifts:       extra.shifts      || ['Смена 1','Смена 2'],
      suppliers:    extra.suppliers   || [],
      catMeta:      extra.catMeta     || {},
      accent:       extra.accent      || '#5E5CE6',
      theme:        extra.theme       || 'dark',
      showKassaBalance: extra.showKassaBalance !== undefined ? extra.showKassaBalance : true
    };
  }); }

  async function saveSettings(p) { return _err(async () => {
    // Save categories to DB
    if (p.cats !== undefined) {
      const cats = (p.cats || []).filter(Boolean);
      await sb().from('categories').delete().eq('org_id', p.orgId);
      if (cats.length) {
        await sb().from('categories').insert(cats.map(c => ({ org_id: p.orgId, name: s(typeof c === 'object' ? c.name : c), type: (typeof c === 'object' ? c.type : null) || 'expense' })));
      }
    }

    // Save employees to DB
    if (p.employees !== undefined) {
      for (const e of (p.employees || [])) {
        const name = s(typeof e === 'object' ? e.name : e);
        if (!name) continue;
        const { data: ex } = await sb().from('employees').select('id').eq('org_id', p.orgId).eq('name', name).maybeSingle();
        const rate = n(e.rate || e.dailySalary || 0);
        if (ex) await sb().from('employees').update({ rate, status: e.status || 'active' }).eq('id', ex.id);
        else    await sb().from('employees').insert({ org_id: p.orgId, name, rate, status: e.status || 'active' });
      }
    }

    // Store UI/personalization settings in cloud (app_kv) with local cache
    const uiKeys = ['cashiers','payTypes','repStatuses','shifts','suppliers','showKassaBalance','catMeta','accent','theme'];
    const existing = await _kvGet(p.orgId, 'ui', {}, 'auron_ui_' + p.orgId);
    uiKeys.forEach(k => { if (p[k] !== undefined) existing[k] = p[k]; });
    await _kvSet(p.orgId, 'ui', existing);

    return { ok: true };
  }); }

  // ── Accounts ──────────────────────────────────────────────────

  async function getAccounts(p) { return _err(async () => {
    const { data, error } = await sb().from('accounts').select('*').eq('org_id', p.orgId).order('sort_order').order('created_at');
    if (error) return { __error: error.message };
    return (data || []).map(r => ({ id: r.id, name: r.name, balance: r.balance, status: r.status, icon: r.icon, color: r.color }));
  }); }

  const getAccountsAll = getAccounts;

  async function saveAccount(p) { return _err(async () => {
    if (p.id) {
      const { data, error } = await sb().from('accounts').update({ name: s(p.name), icon: s(p.icon)||'💵', color: s(p.color)||'#10B981' }).eq('id', p.id).eq('org_id', p.orgId).select().single();
      if (error) return { __error: error.message };
      return { id: data.id, name: data.name, balance: data.balance, status: data.status, icon: data.icon, color: data.color };
    }
    const { data, error } = await sb().from('accounts').insert({ org_id: p.orgId, name: s(p.name)||'Счёт', icon: s(p.icon)||'💵', color: s(p.color)||'#10B981' }).select().single();
    if (error) return { __error: error.message };
    return { id: data.id, name: data.name, balance: 0, status: 'active', icon: data.icon, color: data.color };
  }); }

  async function deleteAccount(p) { return _err(async () => {
    await sb().from('accounts').update({ status: 'archived' }).eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  async function toggleAccountVisibility(p) { return _err(async () => {
    await sb().from('accounts').update({ status: p.visible ? 'active' : 'hidden' }).eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  async function adjustBalance(p) { return _err(async () => {
    const accountId = p.accountId || await _accId(p.orgId, p.account);
    const { error } = await sb().from('transactions').insert({
      uuid: uid(), org_id: p.orgId, date: s(p.date) || new Date().toISOString().slice(0,10),
      type: 'Корректировка', category: 'Корректировка', amount: n(p.amount),
      account_id: accountId, comment: s(p.comment)
    });
    if (error) return { __error: error.message };
    await _balanceDelta(accountId, 'Корректировка', n(p.amount));
    return { ok: true };
  }); }

  // ── Transactions ──────────────────────────────────────────────

  async function saveQuickEntry(p) { return _err(async () => {
    const accountId = p.accountId || await _accId(p.orgId, p.account);
    if (p.uuid) {
      const { data: dup } = await sb().from('transactions').select('*').eq('uuid', p.uuid).eq('org_id', p.orgId).maybeSingle();
      if (dup) return fmtTx(dup);
    }
    const row = {
      uuid: s(p.uuid) || uid(), org_id: p.orgId,
      date: s(p.date), type: s(p.type), category: s(p.category),
      amount: n(p.amount), account_id: accountId || null,
      employee: s(p.employee), comment: s(p.comment),
      receipt_url: s(p.receiptUrl), shift_id: s(p.shiftId),
      locked: !!p.locked, shift_num: n(p.shiftNum)
    };
    const { data, error } = await sb().from('transactions').insert(row).select().single();
    if (error) return { __error: error.message };
    await _balanceDelta(accountId, p.type, p.amount);
    return fmtTx(data);
  }); }

  async function saveTransfer(p) { return _err(async () => {
    const refId = s(p.uuid) || uid();
    const fromId = p.fromAccountId || await _accId(p.orgId, p.fromAccount);
    const toId   = p.toAccountId   || await _accId(p.orgId, p.toAccount);
    const { data: dup } = await sb().from('transactions').select('id').eq('uuid', refId+'_out').eq('org_id', p.orgId).maybeSingle();
    if (dup) return { ok: true };
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const amt  = n(p.amount);
    await sb().from('transactions').insert([
      { uuid: refId+'_out', org_id: p.orgId, date, type: 'Расход', category: 'Перевод', amount: amt, account_id: fromId, comment: s(p.comment), shift_id: refId },
      { uuid: refId+'_in',  org_id: p.orgId, date, type: 'Доход',  category: 'Перевод', amount: amt, account_id: toId,   comment: s(p.comment), shift_id: refId }
    ]);
    await _balanceDelta(fromId, 'Расход', amt);
    await _balanceDelta(toId,   'Доход',  amt);
    return { ok: true };
  }); }

  async function deleteTransaction(p) { return _err(async () => {
    const { data: tx } = await sb().from('transactions').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!tx) return { __error: 'Not found' };
    await sb().from('trash').insert({ org_id: p.orgId, original_data: tx });
    const reverseType = tx.type === 'Доход' ? 'Расход' : tx.type === 'Расход' ? 'Доход' : 'Корректировка';
    await _balanceDelta(tx.account_id, reverseType, tx.type === 'Корректировка' ? -tx.amount : tx.amount);
    await sb().from('transactions').delete().eq('id', p.id);
    return { ok: true };
  }); }

  async function editTransaction(p) { return _err(async () => {
    const { data: old } = await sb().from('transactions').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!old) return { __error: 'Not found' };
    const reverseType = old.type === 'Доход' ? 'Расход' : old.type === 'Расход' ? 'Доход' : 'Корректировка';
    await _balanceDelta(old.account_id, reverseType, old.type === 'Корректировка' ? -old.amount : old.amount);
    const accountId = p.accountId || (p.account ? await _accId(p.orgId, p.account) : old.account_id);
    const upd = {
      date: s(p.date) || old.date, type: p.type !== undefined ? s(p.type) : old.type,
      category: p.category !== undefined ? s(p.category) : old.category,
      amount: p.amount !== undefined ? n(p.amount) : old.amount,
      account_id: accountId !== undefined ? (accountId || null) : old.account_id,
      employee: p.employee !== undefined ? s(p.employee) : old.employee,
      comment: p.comment !== undefined ? s(p.comment) : old.comment,
    };
    const { data, error } = await sb().from('transactions').update(upd).eq('id', p.id).select().single();
    if (error) return { __error: error.message };
    await _balanceDelta(upd.account_id, upd.type, upd.amount);
    return fmtTx(data);
  }); }

  async function getAllTransactions(p) { return _err(async () => {
    let q = sb().from('transactions').select('*').eq('org_id', p.orgId);
    if (p.type)   q = q.eq('type', p.type);
    if (p.search || p.query) {
      const like = '%' + (p.search || p.query) + '%';
      q = q.or(`comment.ilike.${like},category.ilike.${like}`);
    } else {
      const { from, to } = _periodDates(p.period);
      if (p.from || from) q = q.gte('date', p.from || from);
      if (p.to   || to)   q = q.lte('date', p.to   || to);
    }
    q = q.order('date', { ascending: false }).order('created_at', { ascending: false });
    if (p.limit) q = q.limit(n(p.limit));
    const { data, error } = await q;
    if (error) return { __error: error.message };
    return (data || []).map(fmtTx);
  }); }

  const searchTransactions = p => getAllTransactions({ ...p, search: p.query });

  async function exportTransactions(p) { return _err(async () => {
    const period = p.period || 'month';
    const { from, to } = _periodDates(period);
    let q = sb().from('transactions').select('*').eq('org_id', p.orgId);
    if (p.from || from) q = q.gte('date', p.from || from);
    if (p.to   || to)   q = q.lte('date', p.to   || to);
    q = q.order('date', { ascending: false });
    const { data } = await q;
    const header = ['Дата','Тип','Категория','Сумма (₽)','Сотрудник','Комментарий','Чек','Заблокировано'];
    const rows = (data||[]).map(t => [
      t.date, t.type, t.category||'', t.amount,
      t.employee||'', t.comment||'', t.receipt_url||'',
      t.locked ? 'Да' : 'Нет'
    ]);
    const csv = [header, ...rows].map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
    return { csv };
  }); }

  function _periodDates(period) {
    const today = new Date();
    const pad = x => String(x).padStart(2,'0');
    const iso  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    // 'all' / unknown → very wide range so unconditional .gte/.lte calls never break
    const ALL = { from: '1970-01-01', to: '2999-12-31' };
    if (!period || period === 'all') return ALL;
    if (period === 'today') { const d = iso(today); return { from: d, to: d }; }
    if (period === 'week') {
      const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay()+6)%7));
      return { from: iso(mon), to: iso(today) };
    }
    if (period === 'month') return { from: `${today.getFullYear()}-${pad(today.getMonth()+1)}-01`, to: iso(today) };
    if (period === 'year')  return { from: `${today.getFullYear()}-01-01`, to: iso(today) };
    if (period === 'prev_month') {
      const pm = new Date(today.getFullYear(), today.getMonth()-1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: iso(pm), to: iso(last) };
    }
    if (period && period.startsWith('custom:')) { const pts = period.split(':'); return { from: pts[1] || ALL.from, to: pts[2] || ALL.to }; }
    return ALL;
  }

  // ── Trash ─────────────────────────────────────────────────────

  async function getTrash(p) { return _err(async () => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const { data } = await sb().from('trash').select('*').eq('org_id', p.orgId).gte('deleted_at', cutoff.toISOString()).order('deleted_at', { ascending: false });
    return (data || []).map(r => ({ id: r.id, deletedAt: r.deleted_at, ...fmtTx(r.original_data) }));
  }); }

  async function restoreFromTrash(p) { return _err(async () => {
    const { data: item } = await sb().from('trash').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!item) return { __error: 'Not found' };
    const tx = item.original_data;
    await sb().from('transactions').upsert({ ...tx, org_id: p.orgId });
    await _balanceDelta(tx.account_id, tx.type, tx.amount);
    await sb().from('trash').delete().eq('id', p.id);
    return { ok: true };
  }); }

  async function cleanTrash(p) { return _err(async () => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    await sb().from('trash').delete().eq('org_id', p.orgId).lt('deleted_at', cutoff.toISOString());
    return { ok: true };
  }); }

  // ── Home ──────────────────────────────────────────────────────

  async function getHomeSummary(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'today');
    const [accsR, txsR] = await Promise.all([
      sb().from('accounts').select('*').eq('org_id', p.orgId).neq('status','archived').order('sort_order'),
      sb().from('transactions').select('*').eq('org_id', p.orgId)
        .gte('date', from).lte('date', to)
        .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(50)
    ]);
    const txs = (txsR.data || []).map(fmtTx);
    const income  = txs.filter(t => t.type === 'Доход').reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter(t => t.type === 'Расход').reduce((s, t) => s + t.amount, 0);
    return {
      accounts: (accsR.data || []).map(r => ({ id: r.id, name: r.name, balance: r.balance, status: r.status, icon: r.icon, color: r.color })),
      transactions: txs,
      summary: { income, expense }
    };
  }); }

  // ── Shifts / Kassa ────────────────────────────────────────────

  async function saveKassa(p) { return _err(async () => {
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const shift = s(p.shift) || 'Смена 1';
    const rows  = Array.isArray(p.rows) ? p.rows : [];
    const wds   = Array.isArray(p.wyplatas) ? p.wyplatas : [];

    // Map account names to z/fact columns
    const acc2type = (name) => {
      const n = (name||'').toLowerCase();
      if (n.includes('нал') || n.includes('cash')) return 'cash';
      if (n.includes('карт') || n.includes('card')) return 'card';
      if (n.includes('сбп') || n.includes('sbp'))   return 'sbp';
      return 'cash';
    };
    let zCash=0, zCard=0, zSbp=0, fCash=0, fCard=0, fSbp=0;
    rows.forEach(r => {
      const t = acc2type(r.account);
      if (t==='cash') { zCash+=n(r.zAmount); fCash+=n(r.factAmount); }
      else if(t==='card') { zCard+=n(r.zAmount); fCard+=n(r.factAmount); }
      else                { zSbp +=n(r.zAmount); fSbp +=n(r.factAmount); }
    });
    const zTotal = zCash+zCard+zSbp;
    const fTotal = fCash+fCard+fSbp;
    const discrepancy = fTotal - zTotal;

    // Parse shift number from name
    const shiftNum = parseInt((shift.match(/\d+/) || ['1'])[0]) || 1;

    const { data: shiftRec, error } = await sb().from('shifts').insert({
      org_id: p.orgId, date, shift_num: shiftNum, cashier: s(p.cashier),
      z_cash: zCash, z_card: zCard, z_sbp: zSbp, z_total: zTotal,
      fact_cash: fCash, fact_card: fCard, fact_sbp: fSbp,
      withdrawals: wds, discrepancy
    }).select().single();
    if (error) return { __error: error.message };

    // Save income transactions from z-report
    for (const row of rows) {
      if (!row.zAmount && !row.factAmount) continue;
      const accId = await _accId(p.orgId, row.account);
      if (row.zAmount > 0) {
        await sb().from('transactions').insert({
          uuid: uid(), org_id: p.orgId, date, type: 'Доход', category: 'Z-отчёт',
          amount: n(row.zAmount), account_id: accId, shift_id: shiftRec.id, locked: true, shift_num: shiftNum
        });
        await _balanceDelta(accId, 'Доход', n(row.zAmount));
      }
    }

    // Save withdrawals
    for (const w of wds) {
      if (!w.amount) continue;
      const accId = await _accId(p.orgId, w.account);
      await sb().from('transactions').insert({
        uuid: uid(), org_id: p.orgId, date, type: 'Расход',
        category: s(w.desc) || 'Инкассация',
        amount: n(w.amount), account_id: accId, shift_id: shiftRec.id, locked: true, shift_num: shiftNum
      });
      await _balanceDelta(accId, 'Расход', n(w.amount));
    }

    return { id: shiftRec.id, date: shiftRec.date, cashier: shiftRec.cashier, shift, zTotal, discrepancy };
  }); }

  async function getShifts(p) { return _err(async () => {
    let q = sb().from('shifts').select('*').eq('org_id', p.orgId);
    if (p.from)    q = q.gte('date', p.from);
    if (p.to)      q = q.lte('date', p.to);
    if (p.cashier) q = q.eq('cashier', p.cashier);
    q = q.order('date', { ascending: false });
    if (p.limit)   q = q.limit(n(p.limit));
    const { data } = await q;
    return (data||[]).map(r => ({
      id: r.id, date: r.date, cashier: r.cashier,
      shift: 'Смена ' + (r.shift_num||1), shiftNum: r.shift_num,
      zCash: r.z_cash, zCard: r.z_card, zSbp: r.z_sbp, zTotal: r.z_total,
      factCash: r.fact_cash, factCard: r.fact_card, factSbp: r.fact_sbp,
      withdrawals: r.withdrawals||[], discrepancy: r.discrepancy,
      revenue: r.z_total
    }));
  }); }

  async function cancelShift(p) { return _err(async () => {
    const { data: txs } = await sb().from('transactions').select('*').eq('shift_id', p.id).eq('org_id', p.orgId).eq('locked', true);
    for (const tx of (txs||[])) {
      await _balanceDelta(tx.account_id, tx.type === 'Расход' ? 'Доход' : 'Расход', tx.amount);
      await sb().from('transactions').delete().eq('id', tx.id);
    }
    await sb().from('shifts').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  // ── Shift Analytics ───────────────────────────────────────────

  async function getShiftAnalytics(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    let q = sb().from('shifts').select('*').eq('org_id', p.orgId);
    if (from) q = q.gte('date', from);
    if (to)   q = q.lte('date', to);
    const { data } = await q.order('date', { ascending: true });
    const shifts = data || [];
    const byShiftMap = {};
    let total = 0, totalDisc = 0;
    const byDayMap = {};
    shifts.forEach(s => {
      const name = 'Смена ' + (s.shift_num||1);
      if (!byShiftMap[name]) byShiftMap[name] = { name, count: 0, revenue: 0, discrepancy: 0 };
      byShiftMap[name].count++;
      byShiftMap[name].revenue += s.z_total||0;
      byShiftMap[name].discrepancy += s.discrepancy||0;
      total += s.z_total||0;
      totalDisc += s.discrepancy||0;
      const d = s.date ? s.date.slice(0,10) : '';
      if (d) { byDayMap[d] = (byDayMap[d]||0) + (s.z_total||0); }
    });
    const byShift = Object.values(byShiftMap).map(s => ({ ...s, avgRevenue: s.count ? Math.round(s.revenue/s.count) : 0 })).sort((a,b) => b.revenue - a.revenue);
    const byDay = Object.keys(byDayMap).sort().slice(-30).map(d => ({ label: d.slice(5), revenue: byDayMap[d] }));
    return { byShift, total, totalDisc, byDay };
  }); }

  // ── Supplier Analytics ────────────────────────────────────────

  async function getSupplierAnalytics(p) { return _err(async () => {
    const { data: debts } = await sb().from('debts').select('*').eq('org_id', p.orgId);
    const repMap = {};
    (debts||[]).forEach(d => {
      if (!repMap[d.rep_name]) repMap[d.rep_name] = { name: d.rep_name, id: d.rep_name, totalBuy: 0, totalPay: 0, txCount: 0, debt: 0 };
      const r = repMap[d.rep_name];
      r.txCount++;
      if (d.amount > 0) r.totalBuy += d.amount;
      else r.totalPay += Math.abs(d.amount);
      r.debt += d.amount;
    });
    const suppliers = Object.values(repMap).map(r => ({ ...r, payRatio: r.totalBuy > 0 ? Math.round(r.totalPay/r.totalBuy*100) : 0 })).sort((a,b) => b.totalBuy - a.totalBuy);
    const totalBuy  = suppliers.reduce((s,r) => s + r.totalBuy,  0);
    const totalPay  = suppliers.reduce((s,r) => s + r.totalPay,  0);
    const totalDebt = suppliers.reduce((s,r) => s + r.debt, 0);
    return { suppliers, totalBuy, totalPay, totalDebt };
  }); }

  // ── Account Flow ──────────────────────────────────────────────

  async function getAccountFlow(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const [txsR, accsR] = await Promise.all([
      sb().from('transactions').select('type,amount,account_id').eq('org_id', p.orgId).gte('date', from).lte('date', to),
      sb().from('accounts').select('id,name,icon,color').eq('org_id', p.orgId).neq('status','archived')
    ]);
    const accMap = Object.fromEntries((accsR.data||[]).map(a => [a.id, a]));
    const flowMap = {};
    (txsR.data||[]).forEach(t => {
      const a = accMap[t.account_id];
      if (!a) return;
      if (!flowMap[a.id]) flowMap[a.id] = { name: a.name, icon: a.icon, income: 0, expense: 0, txCount: 0 };
      flowMap[a.id].txCount++;
      if (t.type === 'Доход')  flowMap[a.id].income  += t.amount;
      if (t.type === 'Расход') flowMap[a.id].expense += t.amount;
    });
    const accounts = Object.values(flowMap).map(a => ({ ...a, net: a.income - a.expense })).sort((a,b) => b.income - a.income);
    return { accounts };
  }); }

  // ── Growth Data ───────────────────────────────────────────────

  async function getGrowthData(p) { return _err(async () => {
    const pad = x => String(x).padStart(2,'0');
    const iso  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const now  = new Date();

    const curMonFrom  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    const curMonTo    = iso(now);
    const prevMonFrom = iso(new Date(now.getFullYear(), now.getMonth()-1, 1));
    const prevMonTo   = iso(new Date(now.getFullYear(), now.getMonth(), 0));
    const curWkFrom   = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay()+6)%7)));
    const prevWkFrom  = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay()+6)%7) - 7));
    const prevWkTo    = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay()+6)%7) - 1));

    const sum = rows => ({
      income:  rows.filter(t=>t.type==='Доход').reduce((s,t)=>s+t.amount,0),
      expense: rows.filter(t=>t.type==='Расход').reduce((s,t)=>s+t.amount,0)
    });
    const pct = (cur, prev) => prev ? Math.round((cur-prev)/prev*100) : 0;

    const [cmR, pmR, cwR, pwR, shiftsR] = await Promise.all([
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', curMonFrom).lte('date', curMonTo),
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', prevMonFrom).lte('date', prevMonTo),
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', curWkFrom).lte('date', curMonTo),
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', prevWkFrom).lte('date', prevWkTo),
      sb().from('shifts').select('cashier,z_total').eq('org_id', p.orgId).gte('date', curMonFrom).lte('date', curMonTo)
    ]);
    const cm = sum(cmR.data||[]), pm = sum(pmR.data||[]);
    const cw = sum(cwR.data||[]), pw = sum(pwR.data||[]);

    const cashierMap = {};
    (shiftsR.data||[]).forEach(s => {
      if (!cashierMap[s.cashier]) cashierMap[s.cashier] = { name: s.cashier, revenue: 0, shifts: 0 };
      cashierMap[s.cashier].revenue += s.z_total||0;
      cashierMap[s.cashier].shifts++;
    });
    const topCashier = Object.values(cashierMap).sort((a,b) => b.revenue-a.revenue)[0] || null;

    return {
      month: { income: cm.income, prevIncome: pm.income, incomeChange: pct(cm.income, pm.income), expense: cm.expense, prevExpense: pm.expense, expenseChange: pct(cm.expense, pm.expense), profit: cm.income-cm.expense, prevProfit: pm.income-pm.expense, profitChange: pct(cm.income-cm.expense, pm.income-pm.expense) },
      week:  { income: cw.income, prevIncome: pw.income, incomeChange: pct(cw.income, pw.income), expense: cw.expense, prevExpense: pw.expense, expenseChange: pct(cw.expense, pw.expense) },
      topCashier
    };
  }); }

  // ── Analytics ─────────────────────────────────────────────────

  async function getAnalytics(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const [txsR, shiftsR, debtsR, accsR] = await Promise.all([
      sb().from('transactions').select('type,category,amount,account_id').eq('org_id', p.orgId).gte('date', from).lte('date', to),
      sb().from('shifts').select('cashier,z_total,discrepancy').eq('org_id', p.orgId).gte('date', from).lte('date', to),
      sb().from('debts').select('rep_name,amount').eq('org_id', p.orgId),
      sb().from('accounts').select('id,name').eq('org_id', p.orgId)
    ]);
    const txs    = txsR.data   || [];
    const shifts = shiftsR.data|| [];
    const debts  = debtsR.data || [];
    const accs   = Object.fromEntries((accsR.data||[]).map(a => [a.id, a.name]));
    let income = 0, expense = 0;
    const catMap = {}, accMap = {};
    txs.forEach(t => {
      if (t.type === 'Доход')  income  += t.amount;
      if (t.type === 'Расход') expense += t.amount;
      if (t.type === 'Доход' || t.type === 'Расход') {
        const k = (t.category||'Прочее')+'_'+t.type;
        catMap[k] = catMap[k] || { name: t.category||'Прочее', type: t.type, amount: 0 };
        catMap[k].amount += t.amount;
        const an = accs[t.account_id]||'';
        if (!accMap[an]) accMap[an] = { name: an, income: 0, expense: 0 };
        if (t.type==='Доход')  accMap[an].income  += t.amount;
        if (t.type==='Расход') accMap[an].expense += t.amount;
      }
    });
    const cashierMap = {};
    shifts.forEach(s => {
      cashierMap[s.cashier] = cashierMap[s.cashier] || { name: s.cashier, revenue: 0, shifts: 0, discrepancy: 0 };
      cashierMap[s.cashier].revenue     += s.z_total||0;
      cashierMap[s.cashier].shifts      += 1;
      cashierMap[s.cashier].discrepancy += Math.abs(s.discrepancy||0);
    });
    const debtMap = {};
    debts.forEach(d => { debtMap[d.rep_name] = (debtMap[d.rep_name]||0) + d.amount; });
    const debtTotal = Object.values(debtMap).reduce((s,v) => s+v, 0);
    return {
      pl: { income, expense, profit: income-expense },
      byCategory: Object.values(catMap).sort((a,b) => b.amount-a.amount),
      byAccount:  Object.values(accMap).sort((a,b) => b.income-a.income),
      cashiers:   Object.values(cashierMap).sort((a,b) => b.revenue-a.revenue),
      debtSummary: { total: debtTotal, reps: Object.entries(debtMap).map(([name,balance]) => ({ name, balance })) }
    };
  }); }

  async function getTrendData(p)        { return getGrowthData(p); }
  async function getCashierAnalytics(p) { return getAnalytics(p); }
  async function getDebtAnalytics(p)    { return getAnalytics(p); }

  async function getCashierShifts(p) { return _err(async () => {
    const { data } = await sb().from('shifts').select('*').eq('org_id', p.orgId).eq('cashier', p.cashierName).order('date', { ascending: false });
    return (data||[]).map(r => ({ id: r.id, date: r.date, cashier: r.cashier, shiftNum: r.shift_num, shift: 'Смена '+(r.shift_num||1), zTotal: r.z_total, revenue: r.z_total, discrepancy: r.discrepancy }));
  }); }

  async function getHeatmap(p) { return _err(async () => {
    const { data } = await sb().from('transactions').select('date,type,amount').eq('org_id', p.orgId).eq('type', 'Доход');
    const dowMap = Array.from({length:7}, (_,i) => ({ day: i, revenue: 0 }));
    (data||[]).forEach(t => { const d = new Date(t.date+'T00:00:00').getDay(); dowMap[d].revenue += t.amount; });
    return { byDayOfWeek: dowMap, byHour: [] };
  }); }

  async function payEmployeeSalary(p) { return saveQuickEntry({ ...p, type: 'Расход', category: 'ЗП' }); }

  // ── Budget ────────────────────────────────────────────────────

  async function getBudget(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const budgetMap = await _kvGet(p.orgId, 'budget', {}, 'auron_budget_' + p.orgId);
    const { data: txs } = await sb().from('transactions').select('category,amount').eq('org_id', p.orgId).eq('type','Расход').gte('date', from).lte('date', to);
    const actualMap = {};
    (txs||[]).forEach(t => { actualMap[t.category] = (actualMap[t.category]||0) + t.amount; });
    const cats = Array.from(new Set([...Object.keys(budgetMap), ...Object.keys(actualMap)])).filter(Boolean);
    const items = cats.map(cat => {
      const planned = budgetMap[cat]||0;
      const actual  = actualMap[cat]||0;
      return { category: cat, planned, actual, over: planned > 0 && actual > planned };
    }).sort((a,b) => b.actual - a.actual);
    return { budgetMap, items };
  }); }

  async function saveBudget(p) { return _err(async () => {
    const existing = await _kvGet(p.orgId, 'budget', {}, 'auron_budget_' + p.orgId);
    const merged = Object.assign(existing, p.budgetMap || {});
    await _kvSet(p.orgId, 'budget', merged);
    return { ok: true };
  }); }

  // ── Debts ─────────────────────────────────────────────────────

  async function getDebts(p) { return _err(async () => {
    const { data } = await sb().from('debts').select('*').eq('org_id', p.orgId).order('date', { ascending: false });
    const byRep = {};
    for (const d of (data||[])) {
      if (!byRep[d.rep_name]) byRep[d.rep_name] = { name: d.rep_name, id: d.rep_name, balance: 0, entries: [] };
      byRep[d.rep_name].balance += d.amount;
      byRep[d.rep_name].entries.push({ id: d.id, type: d.type, amount: d.amount, date: d.date, status: d.status, accountId: d.account_id, comment: d.comment, invoice: d.invoice, repName: d.rep_name });
    }
    return { reps: Object.values(byRep) };
  }); }

  async function saveRep(p) { return { ok: true }; }

  async function saveDebtEntry(p) { return _err(async () => {
    const type = s(p.type);
    const repId = p.repId || p.repName;
    const repName = s(p.repName || p.repId);
    const amt = (type === 'oplata' || type === 'Оплата') ? -Math.abs(n(p.amount)) : n(p.amount);
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const accountId = p.accountId || (p.account ? await _accId(p.orgId, p.account) : null);
    const debtType = type === 'oplata' ? 'Оплата' : type === 'zakupka' ? 'Закупка' : type;
    const { data, error } = await sb().from('debts').insert({
      org_id: p.orgId, rep_name: repName, type: debtType, amount: amt,
      date, account_id: accountId, comment: s(p.comment), invoice: s(p.invoice)
    }).select().single();
    if (error) return { __error: error.message };
    if ((type === 'oplata' || type === 'Оплата') && accountId) {
      await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date, type: 'Расход', category: 'Долг ТП', amount: Math.abs(amt), account_id: accountId, comment: s(p.comment)||`Оплата ${repName}` });
      await _balanceDelta(accountId, 'Расход', Math.abs(amt));
    }
    return { id: data.id, type: data.type, amount: data.amount, date: data.date, status: data.status, accountId: data.account_id, comment: data.comment, repName: data.rep_name };
  }); }

  async function updateDebtEntry(p) { return _err(async () => {
    const { data, error } = await sb().from('debts').update({ rep_name: s(p.repName), type: s(p.type), amount: n(p.amount), date: s(p.date), account_id: p.accountId||null, comment: s(p.comment), invoice: s(p.invoice) }).eq('id', p.id).eq('org_id', p.orgId).select().single();
    if (error) return { __error: error.message };
    return { id: data.id, type: data.type, amount: data.amount, date: data.date };
  }); }

  async function deleteDebtEntry(p) { return _err(async () => {
    await sb().from('debts').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  async function getRepDebt(p) { return _err(async () => {
    const repId = p.repId || p.repName;
    const { data } = await sb().from('debts').select('*').eq('org_id', p.orgId).eq('rep_name', repId).order('date', { ascending: false });
    const balance = (data||[]).reduce((s,d) => s+d.amount, 0);
    return { repName: repId, balance, entries: (data||[]).map(d => ({ id: d.id, type: d.type, amount: d.amount, date: d.date, status: d.status, accountId: d.account_id, comment: d.comment, invoice: d.invoice })) };
  }); }

  async function updateDebtStatus(p) { return _err(async () => {
    await sb().from('debts').update({ status: s(p.status) }).eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  // ── Scheduled Payments ────────────────────────────────────────
  // Stored in localStorage per org

  async function _getPayments(orgId) { return _kvGet(orgId, 'payments', [], 'auron_payments_' + orgId); }
  async function _setPayments(orgId, list) { return _kvSet(orgId, 'payments', list); }

  async function savePayment(p) { return _err(async () => {
    const list = await _getPayments(p.orgId);
    if (p.id) {
      const idx = list.findIndex(x => x.id === p.id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...p, orgId: undefined }; }
      else list.push({ ...p, id: p.id || uid() });
    } else {
      list.push({ id: uid(), payee: s(p.payee), title: s(p.title), amount: n(p.amount), date: s(p.date), comment: s(p.comment), status: 'open' });
    }
    await _setPayments(p.orgId, list);
    return { ok: true };
  }); }

  async function getPayments(p) { return _err(async () => {
    return await _getPayments(p.orgId);
  }); }

  async function updatePayment(p) { return _err(async () => {
    const list = await _getPayments(p.orgId);
    const idx = list.findIndex(x => x.id === p.id);
    if (idx < 0) return { __error: 'Not found' };
    if (p.action === 'pay') {
      list[idx].status = 'paid';
      list[idx].paidAt = new Date().toISOString().slice(0,10);
      list[idx].account = p.account;
      if (p.amount && p.account) {
        const accountId = await _accId(p.orgId, p.account);
        await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date: list[idx].paidAt, type: 'Расход', category: list[idx].title||'Платёж', amount: n(p.amount||list[idx].amount), account_id: accountId, comment: s(p.comment) });
        await _balanceDelta(accountId, 'Расход', n(p.amount||list[idx].amount));
      }
    } else if (p.action === 'postpone') {
      list[idx].date = s(p.date); list[idx].status = 'open'; list[idx].comment = s(p.comment);
    } else if (p.action === 'cancel') {
      list[idx].status = 'cancelled';
    } else if (p.action === 'restore') {
      list[idx].status = 'open';
    }
    await _setPayments(p.orgId, list);
    return { ok: true };
  }); }

  async function deletePayment(p) { return _err(async () => {
    const list = (await _getPayments(p.orgId)).filter(x => x.id !== p.id);
    await _setPayments(p.orgId, list);
    return { ok: true };
  }); }

  async function markPaymentPaid(p) { return updatePayment({ ...p, action: 'pay' }); }
  async function savePayments(p)    { return savePayment(p); }

  // ── Recurring ─────────────────────────────────────────────────

  async function saveRecurring(p) { return _err(async () => {
    const accountId = p.accountId || (p.account ? await _accId(p.orgId, p.account) : null);
    const { data, error } = await sb().from('recurring').insert({ org_id: p.orgId, name: s(p.name)||'Платёж', category: s(p.category), amount: n(p.amount), account_id: accountId, day_of_month: n(p.day||p.dayOfMonth)||1 }).select().single();
    if (error) return { __error: error.message };
    return { id: data.id, name: data.name, amount: data.amount };
  }); }

  async function getRecurring(p) { return _err(async () => {
    const { data } = await sb().from('recurring').select('*').eq('org_id', p.orgId).order('name');
    return (data||[]).map(r => ({ id: r.id, name: r.name, category: r.category, amount: r.amount, account: '', accountId: r.account_id, day: r.day_of_month, dayOfMonth: r.day_of_month, active: r.active }));
  }); }

  async function deleteRecurring(p) { return _err(async () => {
    await sb().from('recurring').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  async function applyRecurring(p) { return _err(async () => {
    const { data: recs } = await sb().from('recurring').select('*').eq('org_id', p.orgId).eq('active', true);
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    let applied = 0;
    for (const r of (recs||[])) {
      if (n(r.day_of_month) !== today.getDate()) continue;
      const existing = await sb().from('transactions').select('id').eq('org_id', p.orgId).eq('date', date).eq('category', r.category).eq('comment', 'Авто: '+r.name).maybeSingle();
      if (existing.data) continue;
      await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date, type: 'Расход', category: r.category||r.name, amount: n(r.amount), account_id: r.account_id, comment: 'Авто: '+r.name });
      await _balanceDelta(r.account_id, 'Расход', n(r.amount));
      applied++;
    }
    return { ok: true, applied };
  }); }

  // ── Timesheet ─────────────────────────────────────────────────
  // Stored in localStorage

  async function getTimesheetMonth(p) { return _err(async () => {
    const kkey = `ts_${p.year}_${p.month}`;
    return await _kvGet(p.orgId, kkey, { days: [] }, `auron_ts_${p.orgId}_${p.year}_${p.month}`);
  }); }

  async function saveTimesheetEntry(p) { return _err(async () => {
    const kkey = `ts_${p.year}_${p.month}`;
    const data = await _kvGet(p.orgId, kkey, { days: [] }, `auron_ts_${p.orgId}_${p.year}_${p.month}`);
    if (!data.days) data.days = [];
    const idx = data.days.findIndex(d => d.day === p.day && d.employee === p.employee);
    const entry = { day: p.day, employee: s(p.employee), status: s(p.status)||'П', timeIn: s(p.timeIn), timeOut: s(p.timeOut), rate: n(p.rate) };
    if (idx >= 0) data.days[idx] = entry;
    else data.days.push(entry);
    await _kvSet(p.orgId, kkey, data);
    return { ok: true };
  }); }

  async function getTimesheet(p)  { return getTimesheetMonth(p); }
  async function saveTimesheet(p) { return saveTimesheetEntry(p); }

  // ── Salary Calculation (Phase 2) ──────────────────────────────

  async function getSalaryCalc(p) { return _err(async () => {
    const year = p.year || new Date().getFullYear();
    const month = p.month || (new Date().getMonth() + 1);
    const tsData = await _kvGet(p.orgId, `ts_${year}_${month}`, { days: [] }, `auron_ts_${p.orgId}_${year}_${month}`);
    const days = tsData.days || [];

    // Load employees from the DB (employees table); rate = daily salary
    const { data: empRows } = await sb().from('employees').select('*').eq('org_id', p.orgId);
    const employees = (empRows || []).map(e => ({ name: e.name, dailySalary: e.rate, salaryType: 'daily' }));

    // Load advances and penalties for this month
    const apData = await _kvGet(p.orgId, `ap_${year}_${month}`, { advances: [], penalties: [] }, `auron_ap_${p.orgId}_${year}_${month}`);

    const empMap = {};
    employees.forEach(e => { empMap[e.name] = e; });

    // Group timesheet by employee
    const byEmp = {};
    days.forEach(d => {
      if (!d.employee) return;
      if (!byEmp[d.employee]) byEmp[d.employee] = { name: d.employee, daysP: 0, daysO: 0, daysB: 0, daysOt: 0, daysV: 0, totalHours: 0, workedDays: 0 };
      const e = byEmp[d.employee];
      const st = d.status || 'П';
      if (st === 'П') { e.daysP++; e.workedDays++; }
      else if (st === 'О') { e.daysO++; e.workedDays++; }
      else if (st === 'Б') e.daysB++;
      else if (st === 'Отп') e.daysOt++;
      else if (st === 'В') e.daysV++;
      e.totalHours += (d.hours || 0);
    });

    const results = Object.values(byEmp).map(e => {
      const cfg = empMap[e.name] || {};
      let baseSalary = 0;
      const salaryType = cfg.salaryType || 'daily';
      if (salaryType === 'daily') {
        baseSalary = (cfg.dailySalary || 0) * e.workedDays;
      } else if (salaryType === 'monthly') {
        baseSalary = cfg.monthlySalary || 0;
      } else if (salaryType === 'hourly') {
        baseSalary = (cfg.hourlyRate || 0) * e.totalHours;
      }
      const advances = (apData.advances || []).filter(a => a.employee === e.name).reduce((s,a) => s + a.amount, 0);
      const penalties = (apData.penalties || []).filter(pen => pen.employee === e.name).reduce((s,pen) => s + pen.amount, 0);
      const toPay = Math.max(0, baseSalary - advances - penalties);
      return {
        name: e.name, daysP: e.daysP, daysO: e.daysO, daysB: e.daysB, daysOt: e.daysOt, daysV: e.daysV,
        totalHours: e.totalHours, workedDays: e.workedDays, salaryType, baseSalary,
        advances, penalties, toPay,
        advanceList: (apData.advances||[]).filter(a=>a.employee===e.name),
        penaltyList: (apData.penalties||[]).filter(pen=>pen.employee===e.name)
      };
    });

    const totalToPay = results.reduce((s,r) => s + r.toPay, 0);
    return { year, month, employees: results, totalToPay };
  }); }

  async function saveAdvance(p) { return _err(async () => {
    const year = p.year || new Date().getFullYear();
    const month = p.month || (new Date().getMonth() + 1);
    const kkey = `ap_${year}_${month}`;
    const data = await _kvGet(p.orgId, kkey, { advances: [], penalties: [] }, `auron_ap_${p.orgId}_${year}_${month}`);
    if(!data.advances)data.advances=[]; if(!data.penalties)data.penalties=[];
    data.advances.push({ id: uid(), employee: s(p.employee), amount: n(p.amount), date: s(p.date)||new Date().toISOString().slice(0,10), comment: s(p.comment) });
    await _kvSet(p.orgId, kkey, data);
    // Also save as transaction if account specified
    if (p.account || p.accountId) {
      const accountId = p.accountId || await _accId(p.orgId, p.account);
      await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date: s(p.date)||new Date().toISOString().slice(0,10), type: 'Расход', category: 'ЗП', amount: n(p.amount), account_id: accountId, comment: `Аванс: ${s(p.employee)}`, employee: s(p.employee) });
      await _balanceDelta(accountId, 'Расход', n(p.amount));
    }
    return { ok: true };
  }); }

  async function savePenalty(p) { return _err(async () => {
    const year = p.year || new Date().getFullYear();
    const month = p.month || (new Date().getMonth() + 1);
    const kkey = `ap_${year}_${month}`;
    const data = await _kvGet(p.orgId, kkey, { advances: [], penalties: [] }, `auron_ap_${p.orgId}_${year}_${month}`);
    if(!data.advances)data.advances=[]; if(!data.penalties)data.penalties=[];
    data.penalties.push({ id: uid(), employee: s(p.employee), amount: n(p.amount), date: s(p.date)||new Date().toISOString().slice(0,10), reason: s(p.reason||p.comment) });
    await _kvSet(p.orgId, kkey, data);
    return { ok: true };
  }); }

  async function deleteAdvance(p) { return _err(async () => {
    const kkey = `ap_${p.year}_${p.month}`;
    const data = await _kvGet(p.orgId, kkey, { advances: [], penalties: [] }, `auron_ap_${p.orgId}_${p.year}_${p.month}`);
    if(!data.advances)data.advances=[];
    data.advances = data.advances.filter(a => a.id !== p.id);
    await _kvSet(p.orgId, kkey, data);
    return { ok: true };
  }); }

  async function deletePenalty(p) { return _err(async () => {
    const kkey = `ap_${p.year}_${p.month}`;
    const data = await _kvGet(p.orgId, kkey, { advances: [], penalties: [] }, `auron_ap_${p.orgId}_${p.year}_${p.month}`);
    if(!data.penalties)data.penalties=[];
    data.penalties = data.penalties.filter(a => a.id !== p.id);
    await _kvSet(p.orgId, kkey, data);
    return { ok: true };
  }); }

  async function paySalaryAll(p) { return _err(async () => {
    const calc = await getSalaryCalc(p);
    const accountId = p.accountId || (p.account ? await _accId(p.orgId, p.account) : null);
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const toInsert = [];
    for (const e of (calc.employees || [])) {
      if (e.toPay <= 0) continue;
      toInsert.push({ uuid: uid(), org_id: p.orgId, date, type: 'Расход', category: 'ЗП', amount: e.toPay, account_id: accountId, comment: `ЗП: ${e.name} (${p.month}/${p.year})`, employee: e.name });
      if (accountId) await _balanceDelta(accountId, 'Расход', e.toPay);
    }
    if (toInsert.length) await sb().from('transactions').insert(toInsert);
    return { paid: toInsert.length, total: calc.totalToPay };
  }); }

  // ── ABC Analysis (Phase 5) ────────────────────────────────────

  async function getAbcAnalysis(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const { data } = await sb().from('transactions').select('category,amount,type').eq('org_id', p.orgId).gte('date', from).lte('date', to);
    const catMap = {};
    (data||[]).forEach(t => {
      if (!t.category) return;
      if (!catMap[t.category]) catMap[t.category] = { income: 0, expense: 0 };
      if (t.type === 'Доход') catMap[t.category].income += t.amount;
      else catMap[t.category].expense += t.amount;
    });
    const items = Object.entries(catMap).map(([cat, v]) => ({ category: cat, income: v.income, expense: v.expense, total: v.income + v.expense })).sort((a,b) => b.expense - a.expense);
    const totalExp = items.reduce((s,i) => s + i.expense, 0);
    let cumulative = 0;
    const withAbc = items.map(i => {
      cumulative += i.expense;
      const pct = totalExp > 0 ? cumulative / totalExp : 0;
      return { ...i, abc: pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C', share: totalExp > 0 ? i.expense / totalExp : 0 };
    });
    return { items: withAbc, totalExpense: totalExp, period: { from, to } };
  }); }

  // ── Cash Flow Forecast (Phase 5) ──────────────────────────────

  async function getCashFlowForecast(p) { return _err(async () => {
    const days = p.days || 30;
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);

    // Get last 90 days avg daily income/expense
    const past = new Date(today); past.setDate(today.getDate() - 90);
    const pastStr = past.toISOString().slice(0,10);
    const { data: txs } = await sb().from('transactions').select('date,type,amount').eq('org_id', p.orgId).gte('date', pastStr).lte('date', todayStr);

    const dayMap = {};
    (txs||[]).forEach(t => {
      if (!dayMap[t.date]) dayMap[t.date] = { income: 0, expense: 0 };
      if (t.type === 'Доход') dayMap[t.date].income += t.amount;
      else if (t.type === 'Расход') dayMap[t.date].expense += t.amount;
    });
    const dayVals = Object.values(dayMap);
    const avgIncome  = dayVals.length ? dayVals.reduce((s,d) => s + d.income, 0) / 90 : 0;
    const avgExpense = dayVals.length ? dayVals.reduce((s,d) => s + d.expense, 0) / 90 : 0;

    // Get upcoming scheduled payments
    const payments = (await _getPayments(p.orgId)).filter(pay => pay.status === 'open' && pay.date >= todayStr);
    const payMap = {};
    payments.forEach(pay => { payMap[pay.date] = (payMap[pay.date]||0) + pay.amount; });

    // Get current balance
    const { data: accs } = await sb().from('accounts').select('balance').eq('org_id', p.orgId).eq('status','active');
    let currentBalance = (accs||[]).reduce((s,a) => s + (a.balance||0), 0);

    const forecast = [];
    let runningBalance = currentBalance;
    for (let i = 1; i <= days; i++) {
      const dt = new Date(today); dt.setDate(today.getDate() + i);
      const dateStr = dt.toISOString().slice(0,10);
      const scheduled = payMap[dateStr] || 0;
      const projected = avgIncome - avgExpense - scheduled;
      runningBalance += projected;
      forecast.push({ date: dateStr, projectedIncome: Math.round(avgIncome), projectedExpense: Math.round(avgExpense + scheduled), scheduledPayments: scheduled, balance: Math.round(runningBalance) });
    }

    const gapDays = forecast.filter(f => f.balance < 0);
    return { currentBalance, avgDailyIncome: Math.round(avgIncome), avgDailyExpense: Math.round(avgExpense), forecast, cashGap: gapDays.length > 0, gapFirstDate: gapDays.length ? gapDays[0].date : null };
  }); }

  // ── Inventory (Phase 7) ────────────────────────────────────────
  // Stored in localStorage as simple item list

  async function _getInventory(orgId) { return _kvGet(orgId, 'inv', [], 'auron_inv_' + orgId); }
  async function _setInventory(orgId, list) { return _kvSet(orgId, 'inv', list); }

  async function getInventory(p) { return _err(async () => {
    const items = await _getInventory(p.orgId);
    return { items, totalValue: items.reduce((s,i) => s + (i.qty||0) * (i.costPrice||0), 0) };
  }); }

  async function saveInventoryItem(p) { return _err(async () => {
    const list = await _getInventory(p.orgId);
    if (p.id) {
      const idx = list.findIndex(x => x.id === p.id);
      if (idx >= 0) list[idx] = { ...list[idx], name: s(p.name), qty: n(p.qty), unit: s(p.unit)||'шт', costPrice: n(p.costPrice), sellPrice: n(p.sellPrice), category: s(p.category), minQty: n(p.minQty) };
      else list.push({ id: p.id, name: s(p.name), qty: n(p.qty), unit: s(p.unit)||'шт', costPrice: n(p.costPrice), sellPrice: n(p.sellPrice), category: s(p.category), minQty: n(p.minQty) });
    } else {
      list.push({ id: uid(), name: s(p.name), qty: n(p.qty), unit: s(p.unit)||'шт', costPrice: n(p.costPrice), sellPrice: n(p.sellPrice), category: s(p.category), minQty: n(p.minQty), created: new Date().toISOString().slice(0,10) });
    }
    await _setInventory(p.orgId, list);
    return { ok: true };
  }); }

  async function deleteInventoryItem(p) { return _err(async () => {
    await _setInventory(p.orgId, (await _getInventory(p.orgId)).filter(x => x.id !== p.id));
    return { ok: true };
  }); }

  async function adjustInventoryQty(p) { return _err(async () => {
    const list = await _getInventory(p.orgId);
    const idx = list.findIndex(x => x.id === p.id);
    if (idx < 0) return { __error: 'Item not found' };
    list[idx].qty = Math.max(0, (list[idx].qty||0) + n(p.delta));
    await _setInventory(p.orgId, list);
    // Record as transaction if requested
    if (p.saveTransaction && p.accountId) {
      const cost = Math.abs(n(p.delta)) * (list[idx].costPrice||0);
      if (cost > 0) {
        await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date: new Date().toISOString().slice(0,10), type: n(p.delta) > 0 ? 'Расход' : 'Доход', category: 'Закупка', amount: cost, account_id: p.accountId, comment: `${list[idx].name}: ${n(p.delta)>0?'+':''} ${n(p.delta)} ${list[idx].unit}` });
        await _balanceDelta(p.accountId, n(p.delta) > 0 ? 'Расход' : 'Доход', cost);
      }
    }
    return { ok: true, newQty: list[idx].qty };
  }); }

  // ── Expense Approvals (Phase 8) ───────────────────────────────
  // Stored in localStorage

  async function _getApprovals(orgId) { return _kvGet(orgId, 'approv', [], 'auron_approv_' + orgId); }
  async function _setApprovals(orgId, list) { return _kvSet(orgId, 'approv', list); }

  async function getApprovals(p) { return _err(async () => {
    let list = await _getApprovals(p.orgId);
    if (p.status) list = list.filter(a => a.status === p.status);
    return { items: list };
  }); }

  async function saveApprovalRequest(p) { return _err(async () => {
    const list = await _getApprovals(p.orgId);
    const item = { id: uid(), title: s(p.title), amount: n(p.amount), category: s(p.category), requestedBy: s(p.requestedBy||p.employee), comment: s(p.comment), date: s(p.date)||new Date().toISOString().slice(0,10), status: 'pending', accountId: p.accountId||null };
    list.unshift(item);
    await _setApprovals(p.orgId, list);
    return { id: item.id };
  }); }

  async function approveRequest(p) { return _err(async () => {
    const list = await _getApprovals(p.orgId);
    const idx = list.findIndex(x => x.id === p.id);
    if (idx < 0) return { __error: 'Not found' };
    list[idx].status = p.action === 'approve' ? 'approved' : 'rejected';
    list[idx].approvedBy = s(p.approvedBy);
    list[idx].approvedAt = new Date().toISOString().slice(0,10);
    list[idx].approvalComment = s(p.comment);
    await _setApprovals(p.orgId, list);
    // If approved, save transaction
    if (p.action === 'approve' && list[idx].accountId && list[idx].amount > 0) {
      await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date: list[idx].approvedAt, type: 'Расход', category: list[idx].category||'Прочий расход', amount: list[idx].amount, account_id: list[idx].accountId, comment: `Утверждено: ${list[idx].title}` });
      await _balanceDelta(list[idx].accountId, 'Расход', list[idx].amount);
    }
    return { ok: true };
  }); }

  async function deleteApprovalRequest(p) { return _err(async () => {
    await _setApprovals(p.orgId, (await _getApprovals(p.orgId)).filter(x => x.id !== p.id));
    return { ok: true };
  }); }

  // ── Seed Demo Data ────────────────────────────────────────────

  async function seedDemoData(p) { return _err(async () => {
    const { data: accs } = await sb().from('accounts').select('id,name').eq('org_id', p.orgId);
    if (!accs || !accs.length) return { txCount: 0 };
    const accByName = Object.fromEntries(accs.map(a => [a.name, a.id]));
    const cash = accByName['Наличные'] || accs[0].id;
    const card = accByName['Карта']    || accs[0].id;
    const sbp  = accByName['СБП']      || accs[0].id;

    const now = new Date();
    const pad = x => String(x).padStart(2,'0');
    const d = (daysAgo) => {
      const dt = new Date(now); dt.setDate(now.getDate()-daysAgo);
      return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    };

    const txs = [
      { date: d(0),  type:'Доход',  category:'Z-отчёт',      amount:54000, account_id:cash   },
      { date: d(0),  type:'Доход',  category:'Z-отчёт',      amount:28000, account_id:card   },
      { date: d(0),  type:'Расход', category:'Закупка',       amount:15000, account_id:cash   },
      { date: d(1),  type:'Доход',  category:'Z-отчёт',      amount:61500, account_id:cash   },
      { date: d(1),  type:'Доход',  category:'Z-отчёт',      amount:19000, account_id:sbp    },
      { date: d(1),  type:'Расход', category:'ЗП',            amount:12000, account_id:cash   },
      { date: d(2),  type:'Доход',  category:'Z-отчёт',      amount:48000, account_id:card   },
      { date: d(2),  type:'Расход', category:'Аренда',        amount:35000, account_id:cash   },
      { date: d(3),  type:'Доход',  category:'Z-отчёт',      amount:72000, account_id:cash   },
      { date: d(3),  type:'Расход', category:'Хозрасходы',   amount:3500,  account_id:cash   },
      { date: d(4),  type:'Доход',  category:'Z-отчёт',      amount:55000, account_id:cash   },
      { date: d(4),  type:'Расход', category:'Закупка',       amount:22000, account_id:card   },
      { date: d(5),  type:'Доход',  category:'Z-отчёт',      amount:38000, account_id:sbp    },
      { date: d(5),  type:'Расход', category:'Коммуналка',   amount:8000,  account_id:cash   },
      { date: d(6),  type:'Доход',  category:'Z-отчёт',      amount:65000, account_id:cash   },
      { date: d(7),  type:'Расход', category:'Закупка',       amount:18000, account_id:cash   },
      { date: d(8),  type:'Доход',  category:'Z-отчёт',      amount:49000, account_id:card   },
      { date: d(10), type:'Расход', category:'ЗП',            amount:15000, account_id:cash   },
      { date: d(12), type:'Доход',  category:'Z-отчёт',      amount:58000, account_id:cash   },
      { date: d(14), type:'Расход', category:'Реклама',       amount:5000,  account_id:card   },
    ];

    const rows = txs.map(t => ({ uuid: uid(), org_id: p.orgId, ...t }));
    await sb().from('transactions').insert(rows);

    // Reset + set balances
    for (const acc of accs) {
      const related = rows.filter(t => t.account_id === acc.id);
      const bal = related.reduce((s,t) => s + (t.type==='Доход' ? t.amount : -t.amount), 0);
      await sb().from('accounts').update({ balance: bal }).eq('id', acc.id);
    }

    return { txCount: rows.length };
  }); }

  // ── Org Info ──────────────────────────────────────────────────

  async function getOrgInfo(p) { return _err(async () => {
    const { data } = await sb().from('orgs').select('*').eq('id', p.orgId).single();
    return data ? { id: data.id, name: data.name } : { __error: 'Not found' };
  }); }

  async function saveOrgInfo(p) { return _err(async () => {
    await sb().from('orgs').update({ name: s(p.name) }).eq('id', p.orgId);
    return { ok: true };
  }); }

  async function uploadReceipt() { return { url: '' }; }

  // ═══════════════════════════════════════════════════════════════
  // RETAIL: товары / партии / импорт чеков / COGS / маржа / P&L
  // (требует supabase/retail_schema.sql)
  // ═══════════════════════════════════════════════════════════════
  function kop(v) { return Math.round((Number(String(v).replace(',', '.')) || 0) * 100); }

  async function getProducts(p) { return _err(async () => {
    const { data, error } = await sb().from('products').select('*').eq('org_id', p.orgId).order('name');
    if (error) return { __error: error.message };
    return (data || []).map(r => ({
      id: r.id, sku: r.sku, barcode: r.barcode || '', name: r.name, category: r.category || '',
      unit: r.unit || 'шт', retailPrice: (r.retail_price || 0) / 100, costMethod: r.cost_method || 'fifo', active: r.is_active
    }));
  }); }

  async function saveProduct(p) { return _err(async () => {
    const row = {
      org_id: p.orgId, sku: s(p.sku), barcode: s(p.barcode), name: s(p.name) || s(p.sku),
      category: s(p.category), unit: s(p.unit) || 'шт', retail_price: kop(p.retailPrice),
      cost_method: (p.costMethod === 'avg' ? 'avg' : 'fifo')
    };
    if (p.id) {
      const { error } = await sb().from('products').update(row).eq('id', p.id).eq('org_id', p.orgId);
      if (error) return { __error: error.message };
      return { id: p.id };
    }
    const { data, error } = await sb().from('products').upsert(row, { onConflict: 'org_id,sku' }).select('id').single();
    if (error) return { __error: error.message };
    return { id: data.id };
  }); }

  async function deleteProduct(p) { return _err(async () => {
    await sb().from('products').update({ is_active: false }).eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  // Поиск/создание товара по SKU — для импорта
  async function _ensureProduct(orgId, sku, name, category) {
    const { data } = await sb().from('products').select('id').eq('org_id', orgId).eq('sku', sku).maybeSingle();
    if (data) return data.id;
    const { data: ins } = await sb().from('products')
      .insert({ org_id: orgId, sku, name: name || sku, category: category || '' }).select('id').single();
    return ins ? ins.id : null;
  }

  // Приход партии (закупка). qty + unit_cost (в рублях)
  async function receiveBatch(p) { return _err(async () => {
    const productId = p.productId || await _ensureProduct(p.orgId, s(p.sku), s(p.name), s(p.category));
    if (!productId) return { __error: 'Товар не найден' };
    let supplierId = p.supplierId || null;
    if (!supplierId && p.supplier) {
      const { data: cp } = await sb().from('counterparties')
        .upsert({ org_id: p.orgId, name: s(p.supplier), kind: 'supplier' }, { onConflict: 'org_id,name,kind' })
        .select('id').single();
      supplierId = cp ? cp.id : null;
    }
    const qty = Number(p.qty) || 0;
    const { error } = await sb().from('batches').insert({
      org_id: p.orgId, product_id: productId, supplier_id: supplierId,
      received_at: p.date ? new Date(p.date).toISOString() : new Date().toISOString(),
      qty_received: qty, qty_remaining: qty, unit_cost: kop(p.unitCost)
    });
    if (error) return { __error: error.message };
    return { ok: true };
  }); }

  // Импорт продаж: p.rows = [{ts,receipt_id,register,cashier,op_type,sku,qty,price,discount,name,category}]
  async function importSales(p) { return _err(async () => {
    const rows = Array.isArray(p.rows) ? p.rows : [];
    if (!rows.length) return { __error: 'Нет строк для импорта' };
    // группируем по чеку
    const groups = {};
    rows.forEach(r => {
      const rid = String(r.receipt_id || r.receiptId || (r.ts + '_' + (r.register || '')));
      (groups[rid] = groups[rid] || { head: r, items: [] }).items.push(r);
    });
    let imported = 0, skipped = 0, errors = 0;
    for (const rid of Object.keys(groups)) {
      const g = groups[rid], h = g.head;
      // идемпотентность
      const { data: ex } = await sb().from('receipts').select('id').eq('org_id', p.orgId).eq('external_id', rid).maybeSingle();
      if (ex) { skipped++; continue; }
      const op = (h.op_type || h.opType || 'sale').toString().trim();
      let total = 0;
      g.items.forEach(it => { total += Math.round((Number(it.qty) || 0) * kop(it.price || it.price_rub) - kop(it.discount || it.discount_rub || 0)); });
      const { data: rec, error: rErr } = await sb().from('receipts').insert({
        org_id: p.orgId, external_id: rid,
        ts: h.ts ? new Date(h.ts).toISOString() : new Date().toISOString(),
        register_id: s(h.register || h.register_id), cashier: s(h.cashier),
        op_type: ['sale', 'refund', 'void', 'storno'].includes(op) ? op : 'sale',
        total, manual_discount: kop(h.manual_discount || 0)
      }).select('id').single();
      if (rErr) { errors++; continue; }
      for (const it of g.items) {
        const pid = await _ensureProduct(p.orgId, s(it.sku), s(it.name), s(it.category));
        const qty = Number(it.qty) || 0;
        const line = Math.round(qty * kop(it.price || it.price_rub) - kop(it.discount || it.discount_rub || 0));
        const { data: ri } = await sb().from('receipt_items').insert({
          receipt_id: rec.id, product_id: pid, qty, unit_price: kop(it.price || it.price_rub),
          discount: kop(it.discount || it.discount_rub || 0), line_total: line
        }).select('id').single();
        // списание себестоимости (FIFO/средняя) для продаж; реверс — для возвратов
        if (ri) {
          try {
            if (op === 'sale')        await sb().rpc('fifo_issue',  { p_receipt_item_id: ri.id });
            else if (op === 'refund') await sb().rpc('fifo_return', { p_receipt_item_id: ri.id });
          } catch (_) {}
        }
      }
      imported++;
    }
    return { ok: true, imported, skipped, errors };
  }); }

  async function getInventoryValue(p) { return _err(async () => {
    const { data, error } = await sb().from('v_inventory_value').select('*').eq('org_id', p.orgId);
    if (error) return { __error: error.message };
    const items = (data || []).map(r => ({ sku: r.sku, name: r.name, category: r.category, qty: Number(r.qty_on_hand), value: (r.stock_value_cost || 0) / 100 }));
    const total = items.reduce((sum, x) => sum + x.value, 0);
    return { items, total };
  }); }

  async function getGrossMargin(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const { data, error } = await sb().from('v_gross_margin').select('*')
      .eq('org_id', p.orgId).gte('date', from).lte('date', to);
    if (error) return { __error: error.message };
    const bySku = {};
    (data || []).forEach(r => {
      const k = r.sku || r.product_id;
      const o = bySku[k] || (bySku[k] = { sku: r.sku, name: r.name, category: r.category, revenue: 0, cogs: 0, gross: 0, qty: 0 });
      const sgn = r.op_type === 'refund' ? -1 : 1;
      o.revenue += sgn * (r.revenue || 0); o.cogs += sgn * (r.cogs || 0);
      o.gross += sgn * (r.gross_profit || 0); o.qty += sgn * Number(r.qty || 0);
    });
    const items = Object.values(bySku).map(o => ({
      sku: o.sku, name: o.name, category: o.category, qty: o.qty,
      revenue: o.revenue / 100, cogs: o.cogs / 100, gross: o.gross / 100,
      marginPct: o.revenue ? Math.round(100 * o.gross / o.revenue) : 0
    })).sort((a, b) => b.gross - a.gross);
    const tot = items.reduce((s, x) => ({ revenue: s.revenue + x.revenue, cogs: s.cogs + x.cogs, gross: s.gross + x.gross }), { revenue: 0, cogs: 0, gross: 0 });
    return { items, total: tot };
  }); }

  async function getPnL(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    // Валовая прибыль из чеков/COGS
    const { data: gm } = await sb().from('v_gross_margin').select('revenue,cogs,gross_profit,op_type')
      .eq('org_id', p.orgId).gte('date', from).lte('date', to);
    let revenue = 0, cogs = 0;
    (gm || []).forEach(r => { const sgn = r.op_type === 'refund' ? -1 : 1; revenue += sgn * (r.revenue || 0); cogs += sgn * (r.cogs || 0); });
    const gross = revenue - cogs;
    // Операционные расходы из существующих транзакций (тип Расход, кроме Закупка/Перевод)
    const { data: tx } = await sb().from('transactions').select('category,amount,type')
      .eq('org_id', p.orgId).eq('type', 'Расход').gte('date', from).lte('date', to);
    const opexByCat = {};
    let opex = 0;
    (tx || []).forEach(t => {
      if (t.category === 'Закупка' || t.category === 'Перевод') return;
      opexByCat[t.category || 'Прочее'] = (opexByCat[t.category || 'Прочее'] || 0) + t.amount;
      opex += t.amount;
    });
    return {
      revenue: revenue / 100, cogs: cogs / 100, gross: gross / 100,
      opex: opex / 100, net: (gross - opex) / 100,
      grossPct: revenue ? Math.round(100 * gross / revenue) : 0,
      opexByCat: Object.keys(opexByCat).map(k => ({ category: k, amount: opexByCat[k] / 100 })).sort((a, b) => b.amount - a.amount)
    };
  }); }

  async function getLossControl(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const { data, error } = await sb().from('v_loss_control').select('*')
      .eq('org_id', p.orgId).gte('date', from).lte('date', to).limit(200);
    if (error) return { __error: error.message };
    return (data || []).map(r => ({
      date: r.date, cashier: r.cashier, register: r.register_id, opType: r.op_type,
      manualDiscount: (r.manual_discount || 0) / 100, total: (r.total || 0) / 100, receiptId: r.external_id
    }));
  }); }

  // Дашборд дня: выручка, трафик по часам, средний чек, потери
  async function getDailyDashboard(p) { return _err(async () => {
    const date = p.date || new Date().toISOString().slice(0, 10);
    const { data: recs, error } = await sb().from('receipts')
      .select('ts,op_type,total').eq('org_id', p.orgId)
      .gte('ts', date + 'T00:00:00').lte('ts', date + 'T23:59:59.999');
    if (error) return { __error: error.message };
    const hours = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
    let revenue = 0, sales = 0, refundSum = 0, refundCnt = 0, voidCnt = 0;
    (recs || []).forEach(r => {
      const h = new Date(r.ts).getHours();
      if (r.op_type === 'sale') {
        revenue += r.total || 0; sales++;
        hours[h].count++; hours[h].revenue += r.total || 0;
      } else if (r.op_type === 'refund') { refundSum += r.total || 0; refundCnt++; }
      else if (r.op_type === 'void')     { voidCnt++; }
    });
    return {
      date, revenue: revenue / 100, traffic: sales,
      avgCheck: sales ? Math.round(revenue / sales) / 100 : 0,
      refundSum: refundSum / 100, refundCount: refundCnt, voidCount: voidCnt,
      byHour: hours.map((h, i) => ({ hour: i, count: h.count, revenue: h.revenue / 100 }))
    };
  }); }

  // ABC/XYZ-анализ ассортимента (ABC — по выручке, XYZ — по стабильности спроса)
  async function getAbcXyz(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'month');
    const { data, error } = await sb().from('v_gross_margin').select('date,sku,name,qty,revenue,op_type')
      .eq('org_id', p.orgId).gte('date', from).lte('date', to);
    if (error) return { __error: error.message };
    const sku = {};
    (data || []).forEach(r => {
      if (r.op_type !== 'sale') return;
      const o = sku[r.sku] || (sku[r.sku] = { sku: r.sku, name: r.name, revenue: 0, weeks: {} });
      o.revenue += r.revenue || 0;
      const wk = _isoWeek(r.date);
      o.weeks[wk] = (o.weeks[wk] || 0) + Number(r.qty || 0);
    });
    const list = Object.values(sku);
    const totalRev = list.reduce((s, x) => s + x.revenue, 0) || 1;
    list.sort((a, b) => b.revenue - a.revenue);
    let cum = 0;
    list.forEach(x => {
      cum += x.revenue;
      const share = cum / totalRev;
      x.abc = share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C';
      const vals = Object.values(x.weeks);
      const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
      const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length || 1);
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      x.cv = Math.round(cv * 100);
      x.xyz = cv <= 0.1 ? 'X' : cv <= 0.25 ? 'Y' : 'Z';
      x.revenueRub = x.revenue / 100;
    });
    return { items: list.map(x => ({ sku: x.sku, name: x.name, revenue: x.revenueRub, abc: x.abc, xyz: x.xyz, cv: x.cv })) };
  }); }

  function _isoWeek(dStr) {
    const d = new Date(dStr + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day + 3);
    const firstThu = new Date(d.getFullYear(), 0, 4);
    return d.getFullYear() + '-' + (1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7));
  }

  // ═══════════════════════════════════════════════════════════════
  // ОБЯЗАТЕЛЬСТВА + ПЛАТЁЖНЫЙ КАЛЕНДАРЬ (таблица obligations)
  // ═══════════════════════════════════════════════════════════════
  async function _ensureCounterparty(orgId, name, kind) {
    if (!name) return null;
    const { data } = await sb().from('counterparties')
      .upsert({ org_id: orgId, name: s(name), kind: kind || 'supplier' }, { onConflict: 'org_id,name,kind' })
      .select('id').single();
    return data ? data.id : null;
  }

  async function getObligations(p) { return _err(async () => {
    const { data, error } = await sb().from('obligations')
      .select('*, counterparties(name,phone)').eq('org_id', p.orgId).order('due_date', { nullsFirst: false });
    if (error) return { __error: error.message };
    const today = new Date().toISOString().slice(0, 10);
    const items = (data || []).map(r => {
      const left = Math.max((r.amount || 0) - (r.paid || 0), 0);
      const overdue = r.due_date && r.due_date < today && left > 0 && r.status !== 'closed';
      return {
        id: r.id, kind: r.kind, name: (r.counterparties && r.counterparties.name) || '',
        phone: (r.counterparties && r.counterparties.phone) || '',
        amount: (r.amount || 0) / 100, paid: (r.paid || 0) / 100, left: left / 100,
        dueDate: r.due_date, status: overdue ? 'overdue' : r.status
      };
    });
    const payable = items.filter(x => x.kind === 'payable' && x.left > 0);
    const receivable = items.filter(x => x.kind === 'receivable' && x.left > 0);
    return {
      items,
      totalPayable: payable.reduce((s, x) => s + x.left, 0),
      totalReceivable: receivable.reduce((s, x) => s + x.left, 0),
      overdueCount: items.filter(x => x.status === 'overdue').length
    };
  }); }

  async function saveObligation(p) { return _err(async () => {
    const cpId = p.counterpartyId || await _ensureCounterparty(p.orgId, p.name, p.kind === 'receivable' ? 'customer' : 'supplier');
    const row = {
      org_id: p.orgId, counterparty_id: cpId, kind: p.kind === 'receivable' ? 'receivable' : 'payable',
      amount: kop(p.amount), due_date: p.dueDate || null
    };
    if (p.id) {
      const { error } = await sb().from('obligations').update(row).eq('id', p.id).eq('org_id', p.orgId);
      if (error) return { __error: error.message };
      return { id: p.id };
    }
    const { data, error } = await sb().from('obligations').insert(row).select('id').single();
    if (error) return { __error: error.message };
    return { id: data.id };
  }); }

  async function payObligation(p) { return _err(async () => {
    const { data: o } = await sb().from('obligations').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!o) return { __error: 'Не найдено' };
    const add = kop(p.amount);
    const paid = (o.paid || 0) + add;
    const status = paid >= o.amount ? 'closed' : (paid > 0 ? 'partial' : 'open');
    const { error } = await sb().from('obligations').update({ paid, status }).eq('id', p.id);
    if (error) return { __error: error.message };
    // отразить оплату как расход/доход по счёту (если указан)
    if (p.account) {
      const accountId = await _accId(p.orgId, p.account);
      const type = o.kind === 'payable' ? 'Расход' : 'Доход';
      await sb().from('transactions').insert({
        uuid: uid(), org_id: p.orgId, date: new Date().toISOString().slice(0, 10),
        type, category: o.kind === 'payable' ? 'Оплата поставщику' : 'Оплата от клиента',
        amount: add, account_id: accountId, comment: s(p.comment)
      });
      await _balanceDelta(accountId, type, add);
    }
    return { ok: true };
  }); }

  async function deleteObligation(p) { return _err(async () => {
    await sb().from('obligations').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  // Прогноз остатка денег по платёжному календарю (на N дней вперёд)
  async function getPaymentForecast(p) { return _err(async () => {
    const days = p.days || 30;
    const [accR, oblR] = await Promise.all([
      sb().from('accounts').select('balance').eq('org_id', p.orgId).neq('status', 'archived'),
      sb().from('obligations').select('kind,amount,paid,due_date,status').eq('org_id', p.orgId).neq('status', 'closed')
    ]);
    let balance = (accR.data || []).reduce((s, a) => s + (a.balance || 0), 0);
    const today = new Date();
    const horizon = new Date(today.getTime() + days * 86400000).toISOString().slice(0, 10);
    const flows = (oblR.data || [])
      .filter(o => o.due_date && o.due_date <= horizon)
      .map(o => ({ date: o.due_date, delta: (o.kind === 'payable' ? -1 : 1) * Math.max((o.amount || 0) - (o.paid || 0), 0) }))
      .sort((a, b) => a.date < b.date ? -1 : 1);
    let running = balance, minBal = balance, minDate = null;
    const timeline = flows.map(f => {
      running += f.delta;
      if (running < minBal) { minBal = running; minDate = f.date; }
      return { date: f.date, delta: f.delta / 100, balance: running / 100 };
    });
    return { startBalance: balance / 100, endBalance: running / 100, minBalance: minBal / 100, minDate, timeline };
  }); }

  // ── Public API ─────────────────────────────────────────────────
  return {
    initUserApp, registerUser, createOrg, deleteOrg, logoutUser,
    getAccounts, getAccountsAll, saveAccount, deleteAccount, toggleAccountVisibility, adjustBalance,
    saveQuickEntry, saveTransfer, deleteTransaction, editTransaction,
    getAllTransactions, searchTransactions, exportTransactions,
    getTrash, cleanTrash, restoreFromTrash,
    saveKassa, getShifts, cancelShift,
    getShiftAnalytics, getSupplierAnalytics, getAccountFlow, getGrowthData,
    getDebts, saveRep, saveDebtEntry, updateDebtEntry, deleteDebtEntry, getRepDebt, updateDebtStatus,
    getAnalytics, getTrendData, getCashierAnalytics, getCashierShifts, getHeatmap, getDebtAnalytics, payEmployeeSalary,
    getBudget, saveBudget,
    getSettings, saveSettings, saveCategories: saveSettings, saveEmployees: saveSettings,
    savePayment, savePayments, getPayments, updatePayment, deletePayment, markPaymentPaid,
    saveRecurring, getRecurring, deleteRecurring, applyRecurring,
    getTimesheet, saveTimesheet, getTimesheetMonth, saveTimesheetEntry,
    getSalaryCalc, saveAdvance, savePenalty, deleteAdvance, deletePenalty, paySalaryAll,
    getAbcAnalysis, getCashFlowForecast,
    getInventory, saveInventoryItem, deleteInventoryItem, adjustInventoryQty,
    getApprovals, saveApprovalRequest, approveRequest, deleteApprovalRequest,
    getHomeSummary, uploadReceipt, getOrgInfo, saveOrgInfo, seedDemoData,
    getProducts, saveProduct, deleteProduct, receiveBatch, importSales,
    getInventoryValue, getGrossMargin, getPnL, getLossControl,
    getObligations, saveObligation, payObligation, deleteObligation, getPaymentForecast,
    getDailyDashboard, getAbcXyz
  };
})();

window.API = API;
