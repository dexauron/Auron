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
    try {
      const { data: { user } } = await sb().auth.getUser();
      if (!user) return { isNew: true };
      const { data: orgs } = await sb().from('orgs').select('*').order('created_at');
      if (!orgs || !orgs.length) return { isNew: true, profile: _profile(user) };
      return { isNew: false, profile: _profile(user), orgs: orgs.map(o => ({ id: o.id, name: o.name, ssId: o.id })) };
    } catch (e) { return { isNew: true }; }
  }

  function _profile(user) {
    return { name: (user.user_metadata && user.user_metadata.full_name) || user.email || '', email: user.email || '', phone: '' };
  }

  async function registerUser(p) { return _err(async () => {
    const { data: { user } } = await sb().auth.getUser();
    if (!user) return { __error: 'Not signed in' };
    const orgName = s(p.orgName) || s(p.company && p.company.name) || 'Мой магазин';
    const { data: existing } = await sb().from('orgs').select('*').order('created_at').limit(1);
    if (existing && existing.length) return { ssId: existing[0].id, orgName: existing[0].name };
    const { data: org, error } = await sb().from('orgs').insert({ name: orgName }).select().single();
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
    const { data: org, error } = await sb().from('orgs').insert({ name: s(p.name) }).select().single();
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

    const extra = lsGet('auron_ui_' + p.orgId, {});

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

    // Store UI settings in localStorage
    const uiKeys = ['cashiers','payTypes','repStatuses','shifts','suppliers','showKassaBalance'];
    const existing = lsGet('auron_ui_' + p.orgId, {});
    uiKeys.forEach(k => { if (p[k] !== undefined) existing[k] = p[k]; });
    lsSet('auron_ui_' + p.orgId, existing);

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
      type: 'Корректировка', category: 'Корректировка', amount: Math.abs(n(p.amount)),
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
    if (!period || period === 'all') return { from: null, to: null };
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
    if (period && period.startsWith('custom:')) { const pts = period.split(':'); return { from: pts[1], to: pts[2] }; }
    return { from: null, to: null };
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
    const budgetMap = lsGet('auron_budget_' + p.orgId, {});
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
    const existing = lsGet('auron_budget_' + p.orgId, {});
    const merged = Object.assign(existing, p.budgetMap || {});
    lsSet('auron_budget_' + p.orgId, merged);
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

  function _getPayments(orgId) { return lsGet('auron_payments_' + orgId, []); }
  function _setPayments(orgId, list) { lsSet('auron_payments_' + orgId, list); }

  async function savePayment(p) { return _err(async () => {
    const list = _getPayments(p.orgId);
    if (p.id) {
      const idx = list.findIndex(x => x.id === p.id);
      if (idx >= 0) { list[idx] = { ...list[idx], ...p, orgId: undefined }; }
      else list.push({ ...p, id: p.id || uid() });
    } else {
      list.push({ id: uid(), payee: s(p.payee), title: s(p.title), amount: n(p.amount), date: s(p.date), comment: s(p.comment), status: 'open' });
    }
    _setPayments(p.orgId, list);
    return { ok: true };
  }); }

  async function getPayments(p) { return _err(async () => {
    return _getPayments(p.orgId);
  }); }

  async function updatePayment(p) { return _err(async () => {
    const list = _getPayments(p.orgId);
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
    _setPayments(p.orgId, list);
    return { ok: true };
  }); }

  async function deletePayment(p) { return _err(async () => {
    const list = _getPayments(p.orgId).filter(x => x.id !== p.id);
    _setPayments(p.orgId, list);
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
    const key = `auron_ts_${p.orgId}_${p.year}_${p.month}`;
    const data = lsGet(key, { days: [] });
    return data;
  }); }

  async function saveTimesheetEntry(p) { return _err(async () => {
    const key = `auron_ts_${p.orgId}_${p.year}_${p.month}`;
    const data = lsGet(key, { days: [] });
    const idx = data.days.findIndex(d => d.day === p.day && d.employee === p.employee);
    const entry = { day: p.day, employee: s(p.employee), status: s(p.status)||'П', timeIn: s(p.timeIn), timeOut: s(p.timeOut), rate: n(p.rate) };
    if (idx >= 0) data.days[idx] = entry;
    else data.days.push(entry);
    lsSet(key, data);
    return { ok: true };
  }); }

  async function getTimesheet(p)  { return getTimesheetMonth(p); }
  async function saveTimesheet(p) { return saveTimesheetEntry(p); }

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
    getHomeSummary, uploadReceipt, getOrgInfo, saveOrgInfo, seedDemoData
  };
})();

window.API = API;
