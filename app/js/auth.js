(() => {
  'use strict';

  const KEY_JWT    = 'auron_jwt';
  const KEY_OB     = 'auron_ob';
  const SCOPES     = 'openid email profile';

  let _tokenClient  = null;
  let _resolveToken = null;
  let _rejectToken  = null;

  function _loadGIS() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Не удалось загрузить Google Identity Services'));
      document.head.appendChild(s);
    });
  }

  function _initTokenClient() {
    if (_tokenClient) return;
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          const e = new Error(resp.error_description || resp.error);
          if (_rejectToken) { _rejectToken(e); _resolveToken = null; _rejectToken = null; }
          return;
        }
        if (_resolveToken) { _resolveToken(resp.access_token); _resolveToken = null; _rejectToken = null; }
      },
      error_callback: (err) => {
        const e = new Error((err && err.message) || 'Auth cancelled');
        if (_rejectToken) { _rejectToken(e); _resolveToken = null; _rejectToken = null; }
      }
    });
  }

  async function _getGoogleToken(prompt) {
    await _loadGIS();
    _initTokenClient();
    return new Promise((resolve, reject) => {
      _resolveToken = resolve;
      _rejectToken  = reject;
      _tokenClient.requestAccessToken({ prompt });
    });
  }

  async function _exchangeForJWT(googleToken) {
    const r = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleToken })
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || 'Ошибка сервера при входе');
    }
    const data = await r.json();
    localStorage.setItem(KEY_JWT, data.jwt);
    return data.jwt;
  }

  async function signIn() {
    const googleToken = await _getGoogleToken('select_account consent');
    return _exchangeForJWT(googleToken);
  }

  async function tryAutoSignIn() {
    try {
      // If JWT is still valid — no action needed
      if (isSignedIn()) return localStorage.getItem(KEY_JWT);
      // JWT expired — try silent Google token refresh
      const googleToken = await _getGoogleToken('');
      if (!googleToken) return null;
      return await _exchangeForJWT(googleToken);
    } catch (e) {
      return null;
    }
  }

  function isSignedIn() {
    const jwt = localStorage.getItem(KEY_JWT);
    if (!jwt) return false;
    try {
      const payload = JSON.parse(atob(jwt.split('.')[1]));
      return payload.exp * 1000 > Date.now() + 60000; // 1 min buffer
    } catch (_) {
      return false;
    }
  }

  function getToken() {
    if (!isSignedIn()) throw new Error('Session expired');
    return localStorage.getItem(KEY_JWT);
  }

  function signOut() {
    try {
      const jwt = localStorage.getItem(KEY_JWT);
      if (jwt && window.google && google.accounts && google.accounts.oauth2) {
        // No Google token to revoke (we only exchanged for JWT)
      }
    } catch (_) {}
    [KEY_JWT, KEY_OB, 'auron_ssid', 'auron_token', 'auron_expiry', 'auron_profile',
     'auron_user_name', 'auron_ob'].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  window.AUTH = { signIn, tryAutoSignIn, isSignedIn, getToken, signOut };
})();
