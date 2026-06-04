(() => {
  'use strict';

  const KEY_TOKEN  = 'auron_token';
  const KEY_EXPIRY = 'auron_expiry';
  const KEY_SSID   = 'auron_ssid';
  const KEY_OB     = 'auron_ob';
  const KEY_PROFILE= 'auron_profile';

  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

  let _tokenClient  = null;
  let _resolveToken = null;
  let _rejectToken  = null;

  // Load GIS script dynamically
  function _loadGIS() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
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
          const err = new Error(resp.error_description || resp.error);
          if (_rejectToken) { _rejectToken(err); _rejectToken = null; _resolveToken = null; }
          return;
        }
        // Store token
        localStorage.setItem(KEY_TOKEN, resp.access_token);
        const exp = Date.now() + (parseInt(resp.expires_in || 3600) - 120) * 1000;
        localStorage.setItem(KEY_EXPIRY, String(exp));
        if (_resolveToken) { _resolveToken(resp.access_token); _resolveToken = null; _rejectToken = null; }
      },
      error_callback: (err) => {
        const e = new Error((err && err.message) || 'Auth cancelled');
        if (_rejectToken) { _rejectToken(e); _rejectToken = null; _resolveToken = null; }
      }
    });
  }

  // Show Google sign-in popup — returns Promise<token>
  async function signIn() {
    await _loadGIS();
    _initTokenClient();
    return new Promise((resolve, reject) => {
      _resolveToken = resolve;
      _rejectToken  = reject;
      _tokenClient.requestAccessToken({ prompt: 'select_account consent' });
    });
  }

  // Get a valid token (from cache only — expired token requires explicit re-sign-in)
  async function getToken() {
    const token  = localStorage.getItem(KEY_TOKEN);
    const expiry = localStorage.getItem(KEY_EXPIRY);

    if (token && expiry && Date.now() < Number(expiry)) return token;

    // Token expired — clear stale data so the caller sees a clean Session expired error
    [KEY_TOKEN, KEY_EXPIRY].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    throw new Error('Session expired');
  }

  // Check if we have a valid non-expired token
  function isSignedIn() {
    const token  = localStorage.getItem(KEY_TOKEN);
    const expiry = localStorage.getItem(KEY_EXPIRY);
    return !!(token && expiry && Date.now() < Number(expiry));
  }

  function signOut() {
    const token = localStorage.getItem(KEY_TOKEN);
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token, () => {}); } catch (_) {}
    }
    [KEY_TOKEN, KEY_EXPIRY, KEY_SSID, KEY_OB, KEY_PROFILE].forEach(k => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
  }

  // No-op: GIS uses popup, not redirect
  async function handleCallback() { return false; }

  window.AUTH = { signIn, handleCallback, getToken, isSignedIn, signOut };
})();
