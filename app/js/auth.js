(() => {
  'use strict';

  // Авторизация Auron.
  //
  // Соответствует docs/03-SCREENS.md (Экраны 0а, 0б) и docs/05-ARCHITECTURE.md.
  //
  // Основной путь входа — телефон + SMS-код (один раз в жизни), дальше PIN
  // или биометрия. Email+пароль сохранён как запасной путь: пока на сервере
  // не подключён SMS-провайдер, регистрация по телефону работать не будет.

  // ── Ключи хранилища ────────────────────────────────────────────────
  const SESSION_KEY   = 'auron_session_v3';
  const PIN_KEY       = 'auron_pin_hash';
  const ATTEMPTS_KEY  = 'auron_pin_attempts';
  const COOLDOWN_KEY  = 'auron_pin_cooldown_until';
  const BLOCKED_KEY   = 'auron_pin_blocked';
  const BIOMETRIC_KEY = 'auron_biometric_id';
  const LOCK_CFG_KEY  = 'auron_lock_seconds';
  const ORGS_KEY      = 'auron_orgs';
  const CURRENT_ORG_KEY = 'auron_current_org';

  // Лестница защиты от перебора PIN (03-SCREENS.md, Экран 0б).
  // Попытки 1–5 без ограничений, 6–10 пауза 30 сек, 11–15 пауза 5 мин,
  // с 16-й — блокировка до SMS-восстановления.
  const COOLDOWN_AFTER   = 5;
  const COOLDOWN_SHORT   = 30;
  const COOLDOWN_LONG    = 300;
  const LONG_AFTER       = 10;
  const BLOCK_AFTER      = 16;

  // ── Состояние ──────────────────────────────────────────────────────
  let _session    = null;  // только в памяти, пока приложение разблокировано
  let _lockTimer  = null;
  let _orgs       = [];    // организации пользователя
  let _currentOrg = null;  // активная организация

  // ── Вспомогательное ────────────────────────────────────────────────
  function _base() { return window.SUPABASE_URL + '/auth/v1'; }
  function _key()  { return window.SUPABASE_ANON_KEY; }

  function _lockSeconds() {
    return parseInt(localStorage.getItem(LOCK_CFG_KEY) || '60', 10);
  }

  function _now() { return Math.floor(Date.now() / 1000); }

  // Российский номер → E.164
  function formatPhone(raw) {
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    if (d.length === 10) return '+7' + d;
    throw new Error('Введите российский номер телефона (10 или 11 цифр)');
  }

  // Хэш PIN через Web Crypto
  async function _hashPIN(pin) {
    const data = new TextEncoder().encode('auron:v1:' + pin);
    const buf  = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Запрос к Supabase Auth REST API
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

  // Сохранить сессию
  function _persist(data) {
    _session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    _now() + (data.expires_in || 3600),
      user:          data.user || null
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(_session)); } catch (_) {}
  }

  // Восстановить сессию из localStorage (обновить если истекла)
  async function _restoreSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved?.access_token) return false;

      if (saved.expires_at && _now() < saved.expires_at - 60) {
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

  // ── Автоблокировка ─────────────────────────────────────────────────
  function _resetTimer() {
    clearTimeout(_lockTimer);
    const secs = _lockSeconds();
    if (secs > 0) _lockTimer = setTimeout(_doLock, secs * 1000);
  }

  function _onActivity() { if (_session) _resetTimer(); }

  const ACTIVITY_EVENTS = ['touchstart', 'click', 'keydown', 'scroll'];

  function _attachListeners() {
    ACTIVITY_EVENTS.forEach(e => document.addEventListener(e, _onActivity, { passive: true }));
  }

  function _detachListeners() {
    ACTIVITY_EVENTS.forEach(e => document.removeEventListener(e, _onActivity));
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

  // ── Вход по телефону + SMS-код ─────────────────────────────────────
  //
  // Требует SMS-провайдера, настроенного на сервере Supabase Auth.
  // Пока провайдер не подключён, requestCode вернёт ошибку сервера.

  // Шаг 1: отправить код на номер.
  async function requestCode(rawPhone) {
    const phone = formatPhone(rawPhone);
    await _post('/otp', { phone, create_user: true });
    return phone;
  }

  // Шаг 2: проверить код из SMS. Успех — сессия создана.
  async function verifyCode(rawPhone, code) {
    const phone = formatPhone(rawPhone);
    if (!/^\d{4,8}$/.test(String(code))) throw new Error('Код из SMS введён неверно');
    const data = await _post('/verify', { type: 'sms', phone, token: String(code) });
    _persist(data);
    await _loadOrgs();
    return data;
  }

  // ── Запасной путь: email + пароль ──────────────────────────────────

  async function signIn(email, password) {
    const data = await _post('/token?grant_type=password', { email, password });
    _persist(data);
    await _loadOrgs();
    return data;
  }

  async function signUp(email, password) {
    const data = await _post('/signup', { email, password });
    // на сервере включено автоподтверждение — сессия приходит сразу
    if (data.access_token) {
      _persist(data);
      await _loadOrgs();
    }
    return data;
  }

  // ── Мультимагазинность ─────────────────────────────────────────────
  //
  // Один человек работает в нескольких организациях (05-ARCHITECTURE.md,
  // таблица org_members). Список и активная организация кэшируются,
  // чтобы Главная открывалась без ожидания сети.

  function _cacheOrgs() {
    try {
      localStorage.setItem(ORGS_KEY, JSON.stringify(_orgs));
      if (_currentOrg) localStorage.setItem(CURRENT_ORG_KEY, _currentOrg.org_id);
    } catch (_) {}
  }

  function _restoreOrgs() {
    try {
      _orgs = JSON.parse(localStorage.getItem(ORGS_KEY) || '[]');
      const savedId = localStorage.getItem(CURRENT_ORG_KEY);
      _currentOrg = _orgs.find(o => o.org_id === savedId) || _orgs[0] || null;
    } catch (_) {
      _orgs = [];
      _currentOrg = null;
    }
  }

  // Загрузить организации пользователя с сервера.
  // Сетевая ошибка не роняет вход — остаётся кэш.
  async function _loadOrgs() {
    if (!_session) return [];
    try {
      const url = window.SUPABASE_URL
        + '/rest/v1/org_members'
        + '?select=org_id,role_id,status,organizations(id,name,slug,settings),roles(id,name,is_system)'
        + '&status=eq.active';
      const res = await fetch(url, {
        headers: { apikey: _key(), Authorization: 'Bearer ' + _session.access_token }
      });
      if (!res.ok) throw new Error('Ошибка ' + res.status);
      const rows = await res.json();

      _orgs = rows.map(r => ({
        org_id:   r.org_id,
        name:     r.organizations?.name || 'Без названия',
        slug:     r.organizations?.slug || null,
        settings: r.organizations?.settings || {},
        role:     r.roles?.name || null,
        role_id:  r.role_id
      }));

      const savedId = localStorage.getItem(CURRENT_ORG_KEY);
      _currentOrg = _orgs.find(o => o.org_id === savedId) || _orgs[0] || null;
      _cacheOrgs();
      window.dispatchEvent(new CustomEvent('auron:orgs-loaded', { detail: _orgs }));
    } catch (e) {
      console.warn('[auth] orgs:', e.message);
      if (!_orgs.length) _restoreOrgs();
    }
    return _orgs;
  }

  function getOrgs()       { return _orgs; }
  function getCurrentOrg() { return _currentOrg; }
  function hasMultipleOrgs() { return _orgs.length > 1; }

  // Переключить активный магазин. Экраны перечитывают данные по событию.
  function setCurrentOrg(orgId) {
    const org = _orgs.find(o => o.org_id === orgId);
    if (!org) throw new Error('Магазин не найден');
    _currentOrg = org;
    _cacheOrgs();
    window.dispatchEvent(new CustomEvent('auron:org-changed', { detail: org }));
    return org;
  }

  // ── PIN ────────────────────────────────────────────────────────────

  function hasPIN()    { return !!localStorage.getItem(PIN_KEY); }
  function isBlocked() { return localStorage.getItem(BLOCKED_KEY) === '1'; }

  function _attempts() { return parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0', 10); }

  // Сколько секунд ждать до следующей попытки. 0 — можно вводить сейчас.
  function cooldownLeft() {
    const until = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0', 10);
    const left  = until - _now();
    return left > 0 ? left : 0;
  }

  // Пауза после неудачной попытки по лестнице из 03-SCREENS.md
  function _cooldownFor(attempts) {
    if (attempts <= COOLDOWN_AFTER) return 0;
    if (attempts <= LONG_AFTER)     return COOLDOWN_SHORT;
    return COOLDOWN_LONG;
  }

  async function setupPIN(pin) {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN должен быть 4 цифры');
    localStorage.setItem(PIN_KEY, await _hashPIN(pin));
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(COOLDOWN_KEY);
    localStorage.removeItem(BLOCKED_KEY);
  }

  // Успех — true. Иначе бросает:
  //   'BLOCKED'      — нужен вход по SMS
  //   'COOLDOWN:N'   — ждать N секунд
  //   'WRONG:N'      — неверно, N попыток до следующей паузы
  async function verifyPIN(pin) {
    if (isBlocked()) throw new Error('BLOCKED');

    const wait = cooldownLeft();
    if (wait > 0) throw new Error('COOLDOWN:' + wait);

    const stored = localStorage.getItem(PIN_KEY);
    if (!stored) throw new Error('PIN не установлен');

    const hash = await _hashPIN(pin);
    if (hash !== stored) {
      const attempts = _attempts() + 1;
      localStorage.setItem(ATTEMPTS_KEY, String(attempts));

      if (attempts >= BLOCK_AFTER) {
        localStorage.setItem(BLOCKED_KEY, '1');
        throw new Error('BLOCKED');
      }

      const cooldown = _cooldownFor(attempts);
      if (cooldown > 0) {
        localStorage.setItem(COOLDOWN_KEY, String(_now() + cooldown));
        throw new Error('COOLDOWN:' + cooldown);
      }

      throw new Error('WRONG:' + (COOLDOWN_AFTER - attempts));
    }

    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(COOLDOWN_KEY);

    const ok = await _restoreSession();
    if (!ok) throw new Error('SESSION_EXPIRED');
    _afterUnlock();
    _loadOrgs();
    return true;
  }

  // ── Биометрия (WebAuthn) ───────────────────────────────────────────

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
    _loadOrgs();
    return true;
  }

  // ── Публичный интерфейс ────────────────────────────────────────────

  // Вызывается при старте приложения.
  // Возвращает 'locked' | 'session' | 'new_user'.
  async function init() {
    _restoreOrgs();
    if (hasPIN()) return 'locked';
    const ok = await _restoreSession();
    if (ok) {
      _afterUnlock();
      _loadOrgs();
      return 'session';
    }
    return 'new_user';
  }

  function lock() { _doLock(); }

  // Снять блокировку после успешного восстановления по SMS
  function unblock() {
    localStorage.removeItem(BLOCKED_KEY);
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(COOLDOWN_KEY);
  }

  function setLockSeconds(secs) {
    localStorage.setItem(LOCK_CFG_KEY, String(secs));
    if (_session) _resetTimer();
  }

  function getLockSeconds() { return _lockSeconds(); }

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
    [SESSION_KEY, PIN_KEY, ATTEMPTS_KEY, COOLDOWN_KEY, BLOCKED_KEY,
     BIOMETRIC_KEY, ORGS_KEY, CURRENT_ORG_KEY].forEach(k => localStorage.removeItem(k));
    _orgs = [];
    _currentOrg = null;
  }

  function isSignedIn() { return !!_session; }
  function getToken()   { if (!_session) throw new Error('Сессия заблокирована'); return _session.access_token; }
  function getUser()    { return _session?.user ?? null; }

  window.AUTH = {
    init, signOut,
    // телефон + SMS
    requestCode, verifyCode, formatPhone,
    // запасной путь
    signIn, signUp,
    // PIN
    setupPIN, verifyPIN, hasPIN, isBlocked, unblock, cooldownLeft,
    // биометрия
    setupBiometrics, verifyBiometrics, hasBiometrics, biometricAvailable,
    // магазины
    getOrgs, getCurrentOrg, setCurrentOrg, hasMultipleOrgs, reloadOrgs: _loadOrgs,
    // сессия и блокировка
    lock, setLockSeconds, getLockSeconds, isSignedIn, getToken, getUser
  };
})();
