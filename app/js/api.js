'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AURON FINANCE — Supabase API Client
   Данные хранятся в Supabase (PostgreSQL) пользователя.
   ═══════════════════════════════════════════════════════════════════ */

const API = (() => {

  function sb() { return AUTH.client(); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2); }
  function s(v)  { return String(v || '').trim().slice(0, 500); }
  function n(v)  { return Math.round(Number(v) || 0); }

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

  // ── Auth / Init ────────────────────────────────────────────────

  async function initUserApp() {
    try {
      const { data: { user } } = await sb().auth.getUser();
      if (!user) return { isNew: true };

      const { data: orgs } = await sb().from('orgs').select('*').order('created_at');
      if (!orgs || !orgs.length) return { isNew: true, profile: _profile(user) };

      return {
        isNew: false,
        profile: _profile(user),
        orgs: orgs.map(o => ({ id: o.id, name: o.name, ssId: o.id }))
      };
    } catch (e) { return { isNew: true }; }
  }

  function _profile(user) {
    return {
      name:  (user.user_metadata && user.user_metadata.full_name) || user.email || '',
      email: user.email || '',
      phone: ''
    };
  }

  async function registerUser(p) { return _err(async () => {
    const { data: { user } } = await sb().auth.getUser();
    if (!user) return { __error: 'Not signed in' };

    const orgName = s(p.orgName) || 'Мой магазин';

    // Idempotent: return existing org if any
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

  async function createOrg(name) { return _err(async () => {
    const { data: org, error } = await sb().from('orgs').insert({ name: s(name) }).select().single();
    if (error) return { __error: error.message };
    await _createDefaultAccounts(org.id);
    return { id: org.id, name: org.name, ssId: org.id };
  }); }

  async function deleteOrg(orgId) { return _err(async () => {
    const { error } = await sb().from('orgs').delete().eq('id', orgId);
    if (error) return { __error: error.message };
    return { ok: true };
  }); }

  async function logoutUser() { AUTH.signOut(); return { ok: true }; }

  // ── Accounts ──────────────────────────────────────────────────

  async function getAccounts(p) { return _err(async () => {
    const { data, error } = await sb().from('accounts').select('*').eq('org_id', p.orgId).order('sort_order').order('created_at');
    if (error) return { __error: error.message };
    return (data || []).map(r => ({ id: r.id, name: r.name, balance: r.balance, status: r.status, icon: r.icon, color: r.color }));
  }); }

  const getAccountsAll = getAccounts;

  async function saveAccount(p) { return _err(async () => {
    if (p.id) {
      const { data, error } = await sb().from('accounts').upsert({ id: p.id, org_id: p.orgId, name: s(p.name), icon: s(p.icon) || '💵', color: s(p.color) || '#10B981' }).select().single();
      if (error) return { __error: error.message };
      return { id: data.id, name: data.name, balance: data.balance, status: data.status, icon: data.icon, color: data.color };
    }
    const { data, error } = await sb().from('accounts').insert({ org_id: p.orgId, name: s(p.name) || 'Счёт', icon: s(p.icon) || '💵', color: s(p.color) || '#10B981' }).select().single();
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
    const { error } = await sb().from('transactions').insert({
      uuid: uid(), org_id: p.orgId, date: s(p.date) || new Date().toISOString().slice(0,10),
      type: 'Корректировка', category: 'Корректировка', amount: Math.abs(n(p.amount)),
      account_id: p.accountId, comment: s(p.comment)
    });
    if (error) return { __error: error.message };
    await _balanceDelta(p.accountId, 'Корректировка', n(p.amount));
    return { ok: true };
  }); }

  // ── Transactions ──────────────────────────────────────────────

  async function saveQuickEntry(p) { return _err(async () => {
    if (p.uuid) {
      const { data: dup } = await sb().from('transactions').select('*').eq('uuid', p.uuid).eq('org_id', p.orgId).maybeSingle();
      if (dup) return fmtTx(dup);
    }
    const row = {
      uuid: s(p.uuid) || uid(), org_id: p.orgId,
      date: s(p.date), type: s(p.type), category: s(p.category),
      amount: n(p.amount), account_id: p.accountId || null,
      employee: s(p.employee), comment: s(p.comment),
      receipt_url: s(p.receiptUrl), shift_id: s(p.shiftId),
      locked: !!p.locked, shift_num: n(p.shiftNum)
    };
    const { data, error } = await sb().from('transactions').insert(row).select().single();
    if (error) return { __error: error.message };
    await _balanceDelta(p.accountId, p.type, p.amount);
    return fmtTx(data);
  }); }

  async function saveTransfer(p) { return _err(async () => {
    const refId = s(p.uuid) || uid();
    const { data: dup } = await sb().from('transactions').select('id').eq('uuid', refId + '_out').eq('org_id', p.orgId).maybeSingle();
    if (dup) return { ok: true };

    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const amt  = n(p.amount);
    await sb().from('transactions').insert([
      { uuid: refId+'_out', org_id: p.orgId, date, type: 'Расход', category: 'Перевод', amount: amt, account_id: p.fromAccountId, comment: s(p.comment), shift_id: refId },
      { uuid: refId+'_in',  org_id: p.orgId, date, type: 'Доход',  category: 'Перевод', amount: amt, account_id: p.toAccountId,   comment: s(p.comment), shift_id: refId }
    ]);
    await _balanceDelta(p.fromAccountId, 'Расход', amt);
    await _balanceDelta(p.toAccountId,   'Доход',  amt);
    return { ok: true };
  }); }

  async function deleteTransaction(p) { return _err(async () => {
    const { data: tx } = await sb().from('transactions').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!tx) return { __error: 'Not found' };
    await sb().from('trash').insert({ org_id: p.orgId, original_data: tx });
    await _balanceDelta(tx.account_id, tx.type === 'Доход' ? 'Расход' : tx.type === 'Расход' ? 'Доход' : 'Корректировка', tx.type === 'Корректировка' ? -tx.amount : tx.amount);
    await sb().from('transactions').delete().eq('id', p.id);
    return { ok: true };
  }); }

  async function editTransaction(p) { return _err(async () => {
    const { data: old } = await sb().from('transactions').select('*').eq('id', p.id).eq('org_id', p.orgId).single();
    if (!old) return { __error: 'Not found' };
    // Reverse old balance
    await _balanceDelta(old.account_id, old.type === 'Доход' ? 'Расход' : old.type === 'Расход' ? 'Доход' : 'Корректировка', old.type === 'Корректировка' ? -old.amount : old.amount);
    const upd = {
      date: s(p.date) || old.date, type: p.type !== undefined ? s(p.type) : old.type,
      category: p.category !== undefined ? s(p.category) : old.category,
      amount: p.amount !== undefined ? n(p.amount) : old.amount,
      account_id: p.accountId !== undefined ? (p.accountId || null) : old.account_id,
      employee: p.employee !== undefined ? s(p.employee) : old.employee,
      comment: p.comment !== undefined ? s(p.comment) : old.comment,
      shift_num: p.shiftNum !== undefined ? n(p.shiftNum) : old.shift_num
    };
    const { data, error } = await sb().from('transactions').update(upd).eq('id', p.id).select().single();
    if (error) return { __error: error.message };
    await _balanceDelta(upd.account_id, upd.type, upd.amount);
    return fmtTx(data);
  }); }

  async function getAllTransactions(p) { return _err(async () => {
    let q = sb().from('transactions').select('*').eq('org_id', p.orgId);
    if (p.type)   q = q.eq('type', p.type);
    if (p.search) {
      const like = `%${p.search}%`;
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
    if (period.startsWith('custom:')) { const p = period.split(':'); return { from: p[1], to: p[2] }; }
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
    const { error } = await sb().from('trash').delete().eq('org_id', p.orgId).lt('deleted_at', cutoff.toISOString());
    if (error) return { __error: error.message };
    return { ok: true };
  }); }

  // ── Home ──────────────────────────────────────────────────────

  async function getHomeSummary(p) { return _err(async () => {
    const { from, to } = _periodDates(p.period || 'today');
    const [accsR, txsR] = await Promise.all([
      sb().from('accounts').select('*').eq('org_id', p.orgId).neq('status','archived').order('sort_order'),
      sb().from('transactions').select('*').eq('org_id', p.orgId).gte('date', from).lte('date', to).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(50)
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

  // ── Shifts ────────────────────────────────────────────────────

  async function saveKassa(p) { return _err(async () => {
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const wds  = Array.isArray(p.withdrawals) ? p.withdrawals : [];
    const { data: shift, error } = await sb().from('shifts').insert({
      org_id: p.orgId, date, shift_num: n(p.shiftNum)||1, cashier: s(p.cashier),
      z_cash: n(p.zCash), z_card: n(p.zCard), z_sbp: n(p.zSbp), z_total: n(p.zTotal),
      fact_cash: n(p.factCash), fact_card: n(p.factCard), fact_sbp: n(p.factSbp),
      withdrawals: wds, discrepancy: n(p.discrepancy)
    }).select().single();
    if (error) return { __error: error.message };

    for (const w of wds) {
      if (!w.amount) continue;
      await sb().from('transactions').insert({
        uuid: uid(), org_id: p.orgId, date, type: 'Расход', category: s(w.name)||'Инкассация',
        amount: n(w.amount), account_id: w.accountId || null, shift_id: shift.id, locked: true, shift_num: n(p.shiftNum)||1
      });
      await _balanceDelta(w.accountId, 'Расход', n(w.amount));
    }
    return { id: shift.id, date: shift.date, cashier: shift.cashier, shiftNum: shift.shift_num,
      zTotal: shift.z_total, discrepancy: shift.discrepancy };
  }); }

  async function getShifts(p) { return _err(async () => {
    let q = sb().from('shifts').select('*').eq('org_id', p.orgId);
    if (p.from)    q = q.gte('date', p.from);
    if (p.to)      q = q.lte('date', p.to);
    if (p.cashier) q = q.eq('cashier', p.cashier);
    const { data } = await q.order('date', { ascending: false });
    return (data || []).map(r => ({ id: r.id, date: r.date, cashier: r.cashier, shiftNum: r.shift_num,
      zCash: r.z_cash, zCard: r.z_card, zSbp: r.z_sbp, zTotal: r.z_total,
      factCash: r.fact_cash, factCard: r.fact_card, factSbp: r.fact_sbp,
      withdrawals: r.withdrawals || [], discrepancy: r.discrepancy }));
  }); }

  async function cancelShift(p) { return _err(async () => {
    const { data: txs } = await sb().from('transactions').select('*').eq('shift_id', p.id).eq('org_id', p.orgId).eq('locked', true);
    for (const tx of (txs || [])) {
      await _balanceDelta(tx.account_id, tx.type === 'Расход' ? 'Доход' : 'Расход', tx.amount);
      await sb().from('transactions').delete().eq('id', tx.id);
    }
    await sb().from('shifts').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  // ── Debts ─────────────────────────────────────────────────────

  async function getDebts(p) { return _err(async () => {
    const { data } = await sb().from('debts').select('*').eq('org_id', p.orgId).order('date', { ascending: false });
    const byRep = {};
    for (const d of (data || [])) {
      if (!byRep[d.rep_name]) byRep[d.rep_name] = { name: d.rep_name, balance: 0, entries: [] };
      byRep[d.rep_name].balance += d.amount;
      byRep[d.rep_name].entries.push({ id: d.id, type: d.type, amount: d.amount, date: d.date, status: d.status, accountId: d.account_id, comment: d.comment, invoice: d.invoice, repName: d.rep_name });
    }
    return { reps: Object.values(byRep) };
  }); }

  async function saveRep() { return { ok: true }; }

  async function saveDebtEntry(p) { return _err(async () => {
    const type = s(p.type);
    const amt  = type === 'Оплата' ? -Math.abs(n(p.amount)) : n(p.amount);
    const date = s(p.date) || new Date().toISOString().slice(0,10);
    const { data, error } = await sb().from('debts').insert({
      org_id: p.orgId, rep_name: s(p.repName), type, amount: amt,
      date, account_id: p.accountId || null, comment: s(p.comment), invoice: s(p.invoice)
    }).select().single();
    if (error) return { __error: error.message };
    if (type === 'Оплата' && p.accountId) {
      await sb().from('transactions').insert({ uuid: uid(), org_id: p.orgId, date, type: 'Расход', category: 'Долг ТП', amount: Math.abs(amt), account_id: p.accountId, comment: s(p.comment) || `Оплата ${s(p.repName)}` });
      await _balanceDelta(p.accountId, 'Расход', Math.abs(amt));
    }
    return { id: data.id, type: data.type, amount: data.amount, date: data.date, status: data.status, accountId: data.account_id, comment: data.comment, repName: data.rep_name };
  }); }

  async function updateDebtEntry(p) { return _err(async () => {
    const { data, error } = await sb().from('debts').update({ rep_name: s(p.repName), type: s(p.type), amount: n(p.amount), date: s(p.date), account_id: p.accountId||null, comment: s(p.comment), invoice: s(p.invoice) }).eq('id', p.id).eq('org_id', p.orgId).select().single();
    if (error) return { __error: error.message };
    return { id: data.id, type: data.type, amount: data.amount, date: data.date, status: data.status };
  }); }

  async function deleteDebtEntry(p) { return _err(async () => {
    await sb().from('debts').delete().eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
  }); }

  async function getRepDebt(p) { return _err(async () => {
    const { data } = await sb().from('debts').select('*').eq('org_id', p.orgId).eq('rep_name', p.repName).order('date', { ascending: false });
    const balance = (data || []).reduce((s, d) => s + d.amount, 0);
    return { repName: p.repName, balance, entries: (data || []).map(d => ({ id: d.id, type: d.type, amount: d.amount, date: d.date, status: d.status, accountId: d.account_id, comment: d.comment, invoice: d.invoice })) };
  }); }

  async function updateDebtStatus(p) { return _err(async () => {
    await sb().from('debts').update({ status: s(p.status) }).eq('id', p.id).eq('org_id', p.orgId);
    return { ok: true };
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
    const txs    = txsR.data || [];
    const shifts = shiftsR.data || [];
    const debts  = debtsR.data || [];
    const accs   = Object.fromEntries((accsR.data || []).map(a => [a.id, a.name]));

    let income = 0, expense = 0;
    const catMap = {}, accMap = {};
    txs.forEach(t => {
      if (t.type === 'Доход')  { income  += t.amount; }
      if (t.type === 'Расход') { expense += t.amount; }
      if (t.type === 'Доход' || t.type === 'Расход') {
        const k = (t.category||'Прочее') + '_' + t.type;
        catMap[k] = catMap[k] || { name: t.category||'Прочее', type: t.type, amount: 0 };
        catMap[k].amount += t.amount;
        const an = accs[t.account_id] || t.account_id || '';
        if (!accMap[an]) accMap[an] = { name: an, income: 0, expense: 0 };
        if (t.type === 'Доход')  accMap[an].income  += t.amount;
        if (t.type === 'Расход') accMap[an].expense += t.amount;
      }
    });

    const cashierMap = {};
    shifts.forEach(s => {
      cashierMap[s.cashier] = cashierMap[s.cashier] || { name: s.cashier, revenue: 0, shifts: 0, discrepancy: 0 };
      cashierMap[s.cashier].revenue     += s.z_total || 0;
      cashierMap[s.cashier].shifts      += 1;
      cashierMap[s.cashier].discrepancy += Math.abs(s.discrepancy || 0);
    });

    const debtMap = {};
    debts.forEach(d => { debtMap[d.rep_name] = (debtMap[d.rep_name] || 0) + d.amount; });
    const debtTotal = Object.values(debtMap).reduce((s, v) => s + v, 0);

    return {
      pl: { income, expense, profit: income - expense },
      byCategory: Object.values(catMap).sort((a,b) => b.amount - a.amount),
      byAccount:  Object.values(accMap).sort((a,b) => b.income - a.income),
      cashiers:   Object.values(cashierMap).sort((a,b) => b.revenue - a.revenue),
      debtSummary: { total: debtTotal, reps: Object.entries(debtMap).map(([name,balance]) => ({ name, balance })) }
    };
  }); }

  async function getTrendData(p) { return _err(async () => {
    const now  = new Date();
    const pad  = x => String(x).padStart(2,'0');
    const curFrom  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
    const curTo    = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const prevFrom = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const prevTo   = new Date(now.getFullYear(), now.getMonth(), 0);
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

    const [curR, prevR] = await Promise.all([
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', curFrom).lte('date', iso(curTo)),
      sb().from('transactions').select('type,amount').eq('org_id', p.orgId).gte('date', iso(prevFrom)).lte('date', iso(prevTo))
    ]);
    const sum = rows => ({ income: rows.filter(t=>t.type==='Доход').reduce((s,t)=>s+t.amount,0), expense: rows.filter(t=>t.type==='Расход').reduce((s,t)=>s+t.amount,0) });
    const cur = sum(curR.data||[]), prev = sum(prevR.data||[]);
    return { currentMonth: cur, prevMonth: prev,
      momIncome:  prev.income  ? Math.round((cur.income  - prev.income)  / prev.income  * 100) : 0,
      momExpense: prev.expense ? Math.round((cur.expense - prev.expense) / prev.expense * 100) : 0 };
  }); }

  async function getCashierAnalytics(p) { return getAnalytics(p); }

  async function getCashierShifts(p) { return _err(async () => {
    const { data } = await sb().from('shifts').select('*').eq('org_id', p.orgId).eq('cashier', p.cashierName).order('date', { ascending: false });
    return (data||[]).map(r => ({ id: r.id, date: r.date, cashier: r.cashier, shiftNum: r.shift_num, zTotal: r.z_total, discrepancy: r.discrepancy }));
  }); }

  async function getHeatmap(p) { return _err(async () => {
    const { data } = await sb().from('transactions').select('date,type,amount').eq('org_id', p.orgId).eq('type', 'Доход');
    const dowMap = Array.from({length:7}, (_,i) => ({ day: i, revenue: 0 }));
    (data||[]).forEach(t => { const d = new Date(t.date+'T00:00:00').getDay(); dowMap[d].revenue += t.amount; });
    return { byDayOfWeek: dowMap, byHour: [] };
  }); }

  async function getDebtAnalytics(p) { return getAnalytics(p); }

  async function payEmployeeSalary(p) { return saveQuickEntry({ ...p, type: 'Расход', category: 'ЗП' }); }

  // ── Settings ──────────────────────────────────────────────────

  async function getSettings(p) { return _err(async () => {
    const [catsR, empsR, recR] = await Promise.all([
      sb().from('categories').select('*').eq('org_id', p.orgId).order('name'),
      sb().from('employees').select('*').eq('org_id', p.orgId).eq('status','active').order('name'),
      sb().from('recurring').select('*').eq('org_id', p.orgId).order('name')
    ]);
    return {
      categories: (catsR.data||[]).map(c => ({ id: c.id, name: c.name, type: c.type })),
      employees:  (empsR.data||[]).map(e => ({ id: e.id, name: e.name, rate: e.rate, status: e.status })),
      recurring:  (recR.data||[]).map(r  => ({ id: r.id, name: r.name, category: r.category, amount: r.amount, accountId: r.account_id, dayOfMonth: r.day_of_month, active: r.active }))
    };
  }); }

  async function saveCategories(p) { return _err(async () => {
    await sb().from('categories').delete().eq('org_id', p.orgId);
    if (p.categories && p.categories.length)
      await sb().from('categories').insert(p.categories.map(c => ({ org_id: p.orgId, name: s(c.name), type: c.type||'expense' })));
    return { ok: true };
  }); }

  async function saveEmployees(p) { return _err(async () => {
    for (const e of (p.employees||[])) {
      const { data: ex } = await sb().from('employees').select('id').eq('org_id', p.orgId).eq('name', s(e.name)).maybeSingle();
      if (ex) await sb().from('employees').update({ rate: n(e.rate), status: e.status||'active' }).eq('id', ex.id);
      else    await sb().from('employees').insert({ org_id: p.orgId, name: s(e.name), rate: n(e.rate), status: e.status||'active' });
    }
    return { ok: true };
  }); }

  async function savePayments(p)  { return saveQuickEntry(p); }
  async function getPayments(p)   { return getAllTransactions({ ...p, type: 'Выплата' }); }
  async function saveRecurring(p) { return _err(async () => {
    const { data, error } = await sb().from('recurring').insert({ org_id: p.orgId, name: s(p.name)||'Платёж', category: s(p.category), amount: n(p.amount), account_id: p.accountId||null, day_of_month: n(p.dayOfMonth)||1 }).select().single();
    if (error) return { __error: error.message };
    return { id: data.id, name: data.name, amount: data.amount };
  }); }
  async function getRecurring(p)  { return (await getSettings(p)).recurring || []; }
  async function getTimesheet()   { return []; }
  async function saveTimesheet()  { return { ok: true }; }
  async function uploadReceipt()  { return { url: '' }; }

  async function getOrgInfo(p) { return _err(async () => {
    const { data } = await sb().from('orgs').select('*').eq('id', p.orgId).single();
    return data ? { id: data.id, name: data.name } : { __error: 'Not found' };
  }); }

  async function saveOrgInfo(p) { return _err(async () => {
    await sb().from('orgs').update({ name: s(p.name) }).eq('id', p.orgId);
    return { ok: true };
  }); }

  // ── Public API ─────────────────────────────────────────────────
  return {
    initUserApp, registerUser, createOrg, deleteOrg, logoutUser,
    getAccounts, getAccountsAll, saveAccount, deleteAccount, toggleAccountVisibility, adjustBalance,
    saveQuickEntry, saveTransfer, deleteTransaction, editTransaction,
    getAllTransactions, searchTransactions, getTrash, cleanTrash, restoreFromTrash,
    saveKassa, getShifts, cancelShift,
    getDebts, saveRep, saveDebtEntry, updateDebtEntry, deleteDebtEntry, getRepDebt, updateDebtStatus,
    getAnalytics, getTrendData, getCashierAnalytics, getCashierShifts, getHeatmap, getDebtAnalytics, payEmployeeSalary,
    getSettings, saveCategories, saveEmployees, savePayments, getPayments, saveRecurring, getRecurring,
    getTimesheet, saveTimesheet, getHomeSummary, uploadReceipt, getOrgInfo, saveOrgInfo
  };
})();

window.API = API;
