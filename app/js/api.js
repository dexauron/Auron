'use strict';
/* ═══════════════════════════════════════════════════════════════════
   AURON FINANCE — REST API Client
   All data lives on the Auron server (SQLite).
   ═══════════════════════════════════════════════════════════════════ */

const API = (() => {

  // ── HTTP helper ──────────────────────────────────────────────────

  async function _fetch(path, opts = {}) {
    const jwt = localStorage.getItem('auron_jwt');
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (jwt) headers['Authorization'] = 'Bearer ' + jwt;

    const resp = await fetch(path, Object.assign({}, opts, { headers }));

    if (resp.status === 401) {
      try { localStorage.removeItem('auron_jwt'); } catch (_) {}
      throw new Error('Session expired');
    }

    const text = await resp.text();
    const data = text ? JSON.parse(text) : null;

    if (!resp.ok) {
      throw new Error((data && data.error) || 'HTTP ' + resp.status);
    }

    return data;
  }

  function _get(path)        { return _fetch(path); }
  function _post(path, body) { return _fetch(path, { method: 'POST',   body: JSON.stringify(body) }); }
  function _put(path, body)  { return _fetch(path, { method: 'PUT',    body: JSON.stringify(body) }); }
  function _patch(path, body){ return _fetch(path, { method: 'PATCH',  body: JSON.stringify(body) }); }
  function _del(path)        { return _fetch(path, { method: 'DELETE' }); }

  function _s(v) { return String(v || '').replace(/[<>"'`]/g, '').trim().slice(0, 500); }

  // ── Auth / Init ──────────────────────────────────────────────────

  async function initUserApp() {
    try {
      return await _get('/api/init');
    } catch (e) {
      return { isNew: true };
    }
  }

  async function registerUser(p) {
    try {
      return await _post('/api/register', {
        name: _s(p.name), phone: _s(p.phone), orgName: _s(p.orgName || 'Мой магазин')
      });
    } catch (e) { return { __error: e.message }; }
  }

  async function createOrg(name) {
    try { return await _post('/api/orgs', { name: _s(name) }); }
    catch (e) { return { __error: e.message }; }
  }

  async function deleteOrg(orgId) {
    try { return await _del(`/api/orgs/${orgId}`); }
    catch (e) { return { __error: e.message }; }
  }

  async function logoutUser() {
    AUTH.signOut();
    return { ok: true };
  }

  // ── Accounts ─────────────────────────────────────────────────────

  async function getAccounts(p) {
    try { return await _get(`/api/orgs/${p.orgId}/accounts`); }
    catch (e) { return { __error: e.message }; }
  }

  async function getAccountsAll(p) {
    try { return await _get(`/api/orgs/${p.orgId}/accounts`); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveAccount(p) {
    try { return await _post(`/api/orgs/${p.orgId}/accounts`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function deleteAccount(p) {
    try { return await _del(`/api/orgs/${p.orgId}/accounts/${p.id}`); }
    catch (e) { return { __error: e.message }; }
  }

  async function toggleAccountVisibility(p) {
    try { return await _patch(`/api/orgs/${p.orgId}/accounts/${p.id}/visibility`, { visible: p.visible }); }
    catch (e) { return { __error: e.message }; }
  }

  async function adjustBalance(p) {
    try { return await _post(`/api/orgs/${p.orgId}/accounts/${p.accountId}/adjust`, p); }
    catch (e) { return { __error: e.message }; }
  }

  // ── Transactions ─────────────────────────────────────────────────

  async function saveQuickEntry(p) {
    try { return await _post(`/api/orgs/${p.orgId}/transactions`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveTransfer(p) {
    try { return await _post(`/api/orgs/${p.orgId}/transfers`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function deleteTransaction(p) {
    try { return await _del(`/api/orgs/${p.orgId}/transactions/${p.id}`); }
    catch (e) { return { __error: e.message }; }
  }

  async function editTransaction(p) {
    try { return await _put(`/api/orgs/${p.orgId}/transactions/${p.id}`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function getAllTransactions(p) {
    try {
      const q = new URLSearchParams();
      if (p.period) q.set('period', p.period);
      if (p.from)   q.set('from', p.from);
      if (p.to)     q.set('to', p.to);
      if (p.type)   q.set('type', p.type);
      if (p.limit)  q.set('limit', p.limit);
      return await _get(`/api/orgs/${p.orgId}/transactions?${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function searchTransactions(p) {
    try {
      return await _get(`/api/orgs/${p.orgId}/transactions?search=${encodeURIComponent(p.query || '')}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function getTrash(p) {
    try { return await _get(`/api/orgs/${p.orgId}/trash`); }
    catch (e) { return { __error: e.message }; }
  }

  async function cleanTrash(p) {
    try { return await _del(`/api/orgs/${p.orgId}/trash`); }
    catch (e) { return { __error: e.message }; }
  }

  async function restoreFromTrash(p) {
    try { return await _post(`/api/orgs/${p.orgId}/trash/${p.id}/restore`, {}); }
    catch (e) { return { __error: e.message }; }
  }

  // ── Home ─────────────────────────────────────────────────────────

  async function getHomeSummary(p) {
    try {
      const q = p.period ? `?period=${encodeURIComponent(p.period)}` : '';
      return await _get(`/api/orgs/${p.orgId}/home${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  // ── Shifts (Z-report / Касса) ─────────────────────────────────────

  async function saveKassa(p) {
    try { return await _post(`/api/orgs/${p.orgId}/shifts`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function getShifts(p) {
    try {
      const q = new URLSearchParams();
      if (p.from)    q.set('from', p.from);
      if (p.to)      q.set('to', p.to);
      if (p.cashier) q.set('cashier', p.cashier);
      return await _get(`/api/orgs/${p.orgId}/shifts?${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function cancelShift(p) {
    try { return await _del(`/api/orgs/${p.orgId}/shifts/${p.id}`); }
    catch (e) { return { __error: e.message }; }
  }

  // ── Debts / Торговые представители ───────────────────────────────

  async function getDebts(p) {
    try { return await _get(`/api/orgs/${p.orgId}/debts`); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveRep(p) {
    try { return await _post(`/api/orgs/${p.orgId}/reps`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveDebtEntry(p) {
    try { return await _post(`/api/orgs/${p.orgId}/debts`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function updateDebtEntry(p) {
    try { return await _put(`/api/orgs/${p.orgId}/debts/${p.id}`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function deleteDebtEntry(p) {
    try { return await _del(`/api/orgs/${p.orgId}/debts/${p.id}`); }
    catch (e) { return { __error: e.message }; }
  }

  async function getRepDebt(p) {
    try {
      return await _get(`/api/orgs/${p.orgId}/reps/${encodeURIComponent(p.repName)}/debts`);
    } catch (e) { return { __error: e.message }; }
  }

  async function updateDebtStatus(p) {
    try { return await _patch(`/api/orgs/${p.orgId}/debts/${p.id}/status`, { status: p.status }); }
    catch (e) { return { __error: e.message }; }
  }

  // ── Analytics ────────────────────────────────────────────────────

  async function getAnalytics(p) {
    try {
      const q = p.period ? `?period=${encodeURIComponent(p.period)}` : '';
      return await _get(`/api/orgs/${p.orgId}/analytics${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function getTrendData(p) {
    try { return await _get(`/api/orgs/${p.orgId}/trends`); }
    catch (e) { return { __error: e.message }; }
  }

  async function getCashierAnalytics(p) {
    try {
      const q = p.period ? `?period=${encodeURIComponent(p.period)}` : '';
      return await _get(`/api/orgs/${p.orgId}/analytics${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function getCashierShifts(p) {
    try {
      return await _get(`/api/orgs/${p.orgId}/cashier-shifts/${encodeURIComponent(p.cashierName)}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function getHeatmap(p) {
    try { return await _get(`/api/orgs/${p.orgId}/heatmap`); }
    catch (e) { return { __error: e.message }; }
  }

  async function getDebtAnalytics(p) {
    try {
      const q = p.period ? `?period=${encodeURIComponent(p.period)}` : '';
      return await _get(`/api/orgs/${p.orgId}/analytics${q}`);
    } catch (e) { return { __error: e.message }; }
  }

  async function payEmployeeSalary(p) {
    try {
      return await _post(`/api/orgs/${p.orgId}/transactions`,
        Object.assign({}, p, { type: 'Расход', category: 'ЗП' }));
    } catch (e) { return { __error: e.message }; }
  }

  // ── Settings ─────────────────────────────────────────────────────

  async function getSettings(p) {
    try { return await _get(`/api/orgs/${p.orgId}/settings`); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveCategories(p) {
    try { return await _post(`/api/orgs/${p.orgId}/settings/categories`, { categories: p.categories }); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveEmployees(p) {
    try { return await _post(`/api/orgs/${p.orgId}/settings/employees`, { employees: p.employees }); }
    catch (e) { return { __error: e.message }; }
  }

  async function savePayments(p) {
    try { return await _post(`/api/orgs/${p.orgId}/transactions`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function getPayments(p) {
    try { return await _get(`/api/orgs/${p.orgId}/transactions?type=${encodeURIComponent('Выплата')}`); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveRecurring(p) {
    try { return await _post(`/api/orgs/${p.orgId}/recurring`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function getRecurring(p) {
    try {
      const s = await _get(`/api/orgs/${p.orgId}/settings`);
      return (s && s.recurring) ? s.recurring : [];
    } catch (e) { return { __error: e.message }; }
  }

  async function getTimesheet(p) {
    try { return await _get(`/api/orgs/${p.orgId}/timesheet`); }
    catch (e) { return []; }
  }

  async function saveTimesheet(p) {
    try { return await _post(`/api/orgs/${p.orgId}/timesheet`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function uploadReceipt(p) {
    try { return await _post(`/api/orgs/${p.orgId}/receipts`, p); }
    catch (e) { return { __error: e.message }; }
  }

  async function getOrgInfo(p) {
    try { return await _get(`/api/orgs/${p.orgId}/info`); }
    catch (e) { return { __error: e.message }; }
  }

  async function saveOrgInfo(p) {
    try { return await _put(`/api/orgs/${p.orgId}/info`, p); }
    catch (e) { return { __error: e.message }; }
  }

  // ── Public API ───────────────────────────────────────────────────
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
