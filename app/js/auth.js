(() => {
  'use strict';

  // ── Storage keys ───────────────────────────────────────────────────
  const SESSION_KEY  = 'auron_session_v3';
  const PIN_KEY      = 'auron_pin_hash';
  const ATTEMPTS_KEY = 'auron_pin_attempts';
  const BLOCKED_KEY  = 'auron_pin_blocked';
  const BIOMETRIC_KEY= 'auron_biometric_id';
  const LOCK_CFG_KEY = 'auron_lock_seconds';

  const MAX_ATTEMPTS = 5;

  // ── State ──────────────────────────────────────────────────────────
  let _session   = null; // in-memory only when unlocked
  let _lockTimer = null;

  // ── Helpers ────────────────────────────────────────────────────────
  function _base() { return window.SUPABASE_URL + '/auth/v1'; }
  function _key()  { return window.SUPABASE_ANON_KEY; }

  function _lockSeconds() {
    return parseInt(localStorage.getItem(LOCK_CFG_KEY) || '60', 10);
  }

  // Format Russian phone → E.164
  function _formatPhone(raw) {
    const d = raw.replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    if (d.length === 10) return '+7' + d;
    throw new Error('Введите российский номер телефона (10 или 11 цифр)');
  }

  // SHA-256 PIN hash via Web Crypto
  async function _hashPIN(pin) {
    const data = new TextEncoder().encode('auron:v1:' + pin);
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fetch wrapper for Supabase Auth REST API
  async function _post(path, body, token) {
    const headers = { apikey: _key(), 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let res, json;
    try {
      res  = await fetch(_base() + path, { method: 'POST', headers, body: JSON.stringify(body) });
      json = await res.json();
    } catch (e) {
      throw new Error('Нет соединения с сервером');
    }
    if (!res.ok) throw new Error(json.error_description || json.msg || json.error || ('Ошибка ' + res.status));
    return json;
  }

  // Persist session to localStorage
  function _persist(data) {
    _session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user:          data.user || null
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(_session)); } catch (_) {}
  }

  // Try to restore session from localStorage (refresh if expired)
  async function _restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved?.access_token) return false;

      const now = Math.floor(Date.now() / 1000);
      if (saved.expires_at && now < saved.expires_at - 60) {
        _session = saved;
        return true;
      }
      if (saved.refresh_token) {
        const data = await _post('/token?grant_type=refresh_token', { refresh_token: saved.refresh_token });
        _persist(data);
        return true;
      }
    } catch (e) {
      console.warn('[auth] restore:', e.message);
      localStorage.removeItem(SESSION_KEY);
    }
    return false;
  }

  // ── Auto-lock ──────────────────────────────────────────────────────
  function _resetTimer() {
    clearTimeout(_lockTimer);
    const secs = _lockSeconds();
    if (secs > 0) _lockTimer = setTimeout(_doLock, secs * 1000);
  }

  function _onActivity() { if (_session) _resetTimer(); }

  function _attachListeners() {
    ['touchstart', 'click', 'keydown', 'scroll'].forEach(e =>
      document.addEventListener(e, _onActivity, { passive: true })
    );
  }

  function _detachListeners() {
    ['touchstart', 'click', 'keydown', 'scroll'].forEach(e =>
      document.removeEventListener(e, _onActivity)
    );
  }

  function _doLock() {
    _detachListeners();
    clearTimeout(_lockTimer);
    _session = null;
    window.dispatchEvent(new CustomEvent('auron:locked'));
  }

  function _afterUnlock() {
    _attachListeners();
    _resetTimer();
    window.dispatchEvent(new CustomEvent('auron:unlocked'));
  }

  // ── Email + Password ───────────────────────────────────────────────

  async function signIn(email, password) {
    const data = await _post('/token?grant_type=password', { email, password });
    _persist(data);
    return data;
  }

  async function signUp(email, password) {
    const data = await _post('/signup', { email, password });
    // auto-confirm enabled on server, session returned immediately
    if (data.access_token) _persist(data);
    return data;
  }

  // ── PIN ────────────────────────────────────────────────────────────

  function hasPIN()    { return !!localStorage.getItem(PIN_KEY); }
  function isBlocked() { return localStorage.getItem(BLOCKED_KEY) === '1'; }

  async function setupPIN(pin) {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN должен быть 4 цифры');
    localStorage.setItem(PIN_KEY, await _hashPIN(pin));
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(BLOCKED_KEY);
  }

  // Returns true on success. Throws 'BLOCKED' or 'WRONG:N' (N = attempts left).
  async function verifyPIN(pin) {
    if (isBlocked()) throw new Error('BLOCKED');

    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) throw new Error('PIN не установлен');

    const hash = await _hashPIN(pin);
    if (hash !== stored) {
      const attempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0') + 1;
      localStorage.setItem(ATTEMPTS_KEY, String(attempts));
      if (attempts >= MAX_ATTEMPTS) {
        localStorage.setItem(BLOCKED_KEY, '1');
        throw new Error('BLOCKED');
      }
      throw new Error('WRONG:' + (MAX_ATTEMPTS - attempts));
    }

    localStorage.removeItem(ATTEMPTS_KEY);
    const ok = await _restoreSession();
    if (!ok) throw new Error('SESSION_EXPIRED');
    _afterUnlock();
    return true;
  }

  // ── Biometrics (WebAuthn) ──────────────────────────────────────────

  function biometricAvailable() { return typeof PublicKeyCredential !== 'undefined'; }
  function hasBiometrics()      { return biometricAvailable() && !!localStorage.getItem(BIOMETRIC_KEY); }

  async function setupBiometrics() {
    if (!biometricAvailable()) throw new Error('Браузер не поддерживает биометрию');
    if (!_session) throw new Error('Сначала войдите в аккаунт');

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId    = new TextEncoder().encode(_session.user?.id || 'auron');

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp:   { name: 'Auron Finance', id: location.hostname },
        user: { id: userId, name: 'auron', displayName: 'Auron Finance' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   }, // ES256
          { type: 'public-key', alg: -257 }  // RS256
        ],
        authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000
      }
    });
    localStorage.setItem(BIOMETRIC_KEY, cred.id);
    return true;
  }

  async function verifyBiometrics() {
    if (!hasBiometrics()) throw new Error('Биометрия не настроена');

    const credId    = localStorage.getItem(BIOMETRIC_KEY);
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    function b64u(str) {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    }

    await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: b64u(credId) }],
        userVerification: 'required',
        timeout: 60000
      }
    });

    const ok = await _restoreSession();
    if (!ok) throw new Error('SESSION_EXPIRED');
    _afterUnlock();
    return true;
  }

  // ── Public API ─────────────────────────────────────────────────────

  // Call on app start. Returns 'locked' | 'new_user'.
  async function init() {
    return hasPIN() ? 'locked' : 'new_user';
  }

  function lock() { _doLock(); }

  // Unblock after email recovery link
  function unblock() {
    localStorage.removeItem(BLOCKED_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
  }

  function setLockSeconds(secs) {
    localStorage.setItem(LOCK_CFG_KEY, String(secs));
    if (_session) _resetTimer();
  }

  async function signOut() {
    _doLock();
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved?.access_token) {
        await fetch(_base() + '/logout', {
          method: 'POST',
          headers: { apikey: _key(), Authorization: 'Bearer ' + saved.access_token }
        });
      }
    } catch (_) {}
    [SESSION_KEY, PIN_KEY, ATTEMPTS_KEY, BLOCKED_KEY, BIOMETRIC_KEY].forEach(k =>
      localStorage.removeItem(k)
    );
  }

  function isSignedIn() { return !!_session; }
  function getToken()   { if (!_session) throw new Error('Сессия заблокирована'); return _session.access_token; }
  function getUser()    { return _session?.user ?? null; }

  window.AUTH = {
    init, signIn, signUp,
    setupPIN, verifyPIN, hasPIN, isBlocked, unblock,
    setupBiometrics, verifyBiometrics, hasBiometrics, biometricAvailable,
    lock, setLockSeconds, signOut, isSignedIn, getToken, getUser
  };
})();
