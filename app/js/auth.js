(() => {
  'use strict';

  const SESSION_KEY = 'auron_v2_session';
  let _session = null;
  let _client  = null;

  // ── helpers ──────────────────────────────────────────────────────
  function _base() { return (window.SUPABASE_PROXY_URL || window.SUPABASE_URL) + '/auth/v1'; }
  function _key()  { return window.SUPABASE_ANON_KEY; }

  // Extract payload from JWT without verification (for user info only)
  function _parseJwt(tok) {
    try {
      return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch(_) { return {}; }
  }

  async function _post(path, body) {
    let res, data;
    try {
      res = await fetch(_base() + path, {
        method:  'POST',
        headers: { apikey: _key(), Authorization: 'Bearer ' + _key(), 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      data = await res.json();
    } catch(e) {
      throw new Error('Нет соединения с сервером (' + e.message + ')');
    }
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || data.error || ('HTTP ' + res.status));
    }
    return data;
  }

  function _mkClient(token) {
    const url = window.SUPABASE_PROXY_URL || window.SUPABASE_URL;
    return window.supabase.createClient(url, _key(), {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth:   { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  function _save(data) {
    // Supabase sometimes omits 'user' from the token response — fall back to JWT payload
    let user = data.user;
    if (!user && data.access_token) {
      const p = _parseJwt(data.access_token);
      if (p.sub) user = { id: p.sub, email: p.email || '', role: p.role || 'authenticated', aud: p.aud || 'authenticated' };
    }
    _session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user:          user
    };
    _client = _mkClient(_session.access_token);
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(_session)); } catch(_) {}
  }

  // ── public API ───────────────────────────────────────────────────
  async function init() {
    // Remove old Supabase-JS sessions (Google OAuth or old format)
    try {
      Object.keys(localStorage).forEach(k => {
        if (k === SESSION_KEY) return;
        if (k.includes('supabase') || k.includes('-auth-token') || k.includes('auron_token')) {
          try { localStorage.removeItem(k); } catch(_) {}
        }
      });
    } catch(_) {}

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved.access_token) return false;

      const now = Math.floor(Date.now() / 1000);

      // Token still valid?
      if (saved.expires_at && now < saved.expires_at - 300) {
        _session = saved;
        _client  = _mkClient(saved.access_token);
        return true;
      }

      // Try refresh
      if (saved.refresh_token) {
        const data = await _post('/token?grant_type=refresh_token', { refresh_token: saved.refresh_token });
        _save(data);
        return true;
      }
    } catch(e) {
      console.warn('[auth] restore failed:', e.message);
      try { localStorage.removeItem(SESSION_KEY); } catch(_) {}
    }
    return false;
  }

  async function signInEmail(email, password) {
    const data = await _post('/token?grant_type=password', { email, password });
    _save(data);
    return data;
  }

  async function signUpEmail(email, password) {
    return await _post('/signup', { email, password });
  }

  async function resetPassword(email) {
    await _post('/recover', { email, redirect_to: window.location.href.split('#')[0] });
  }

  async function signOut() {
    try {
      if (_session?.access_token) {
        await fetch(_base() + '/logout', {
          method: 'POST', headers: { apikey: _key(), Authorization: 'Bearer ' + _session.access_token }
        });
      }
    } catch(_) {}
    _session = null;
    _client  = null;
    try { localStorage.removeItem(SESSION_KEY); } catch(_) {}
  }

  function isSignedIn()  { return !!_session; }
  function getToken()    { if (!_session) throw new Error('Session expired'); return _session.access_token; }
  function getUser()     { return _session && _session.user; }
  function client()      { return _client; }
  async function tryAutoSignIn() { return _session?.access_token || null; }

  window.AUTH = { init, signInEmail, signUpEmail, resetPassword, signOut, isSignedIn, getToken, getUser, client, tryAutoSignIn };
})();
